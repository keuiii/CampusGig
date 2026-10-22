using CampusGig.Mobile.Models;
using SocketIOClient;

namespace CampusGig.Mobile.Services;

public sealed class RealtimeService : IAsyncDisposable
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly SemaphoreSlim connectionGate = new(1, 1);
    private readonly RealtimeReconciliationGate reconciliationGate = new();
    private readonly object subscriptionLock = new();
    private readonly HashSet<string> conversationSubscriptions = [];
    private readonly HashSet<string> providerSubscriptions = [];
    private SocketIO? socket;
    private string? connectedToken;
    private string? connectedUserId;
    public bool IsConnected => socket?.Connected == true;

    public event Action<string>? InboxChanged;
    public event Action<string>? NotificationsChanged;
    public event Action<string, ConversationMessage>? MessageCreated;
    public event Action<string, string>? ConversationRead;
    public event Action<string>? ProviderStatsChanged;
    public event Action<string>? AccountChanged;
    public event Action<string>? OrderChanged;
    public event Action<string>? PaymentChanged;
    public event Action? MarketplaceChanged;
    public event Action<bool>? ConnectionChanged;
    public event Action? ReconciliationRequired;

    public RealtimeService(CampusGigApi api, SessionService session)
    {
        this.api = api;
        this.session = session;
    }

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        var token = session.AccessToken;
        if (string.IsNullOrWhiteSpace(token)) return;
        if (socket?.Connected == true && connectedToken == token) return;

        await connectionGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (socket?.Connected == true && connectedToken == token) return;
            var preserveSubscriptions =
                !string.IsNullOrWhiteSpace(connectedUserId) &&
                connectedUserId == session.User?.Id;
            await DisconnectCoreAsync(!preserveSubscriptions).ConfigureAwait(false);
            if (preserveSubscriptions) reconciliationGate.MarkDisconnected();

            var baseUri = new Uri(api.BaseUrl);
            var endpoint = new UriBuilder(baseUri.Scheme, baseUri.Host, baseUri.Port) { Path = "/realtime" }.Uri;
            socket = CreateSocket(endpoint, token);
            connectedToken = token;
            connectedUserId = session.User?.Id;

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(RealtimeConnectionPolicy.InitialConnectTimeout);
            await socket.ConnectAsync(timeout.Token).ConfigureAwait(false);
        }
        catch
        {
            await DisconnectCoreAsync(clearSubscriptions: false).ConfigureAwait(false);
            throw;
        }
        finally
        {
            connectionGate.Release();
        }
    }

    public async Task SubscribeAsync(string conversationId, CancellationToken cancellationToken = default)
    {
        await ConnectAsync(cancellationToken).ConfigureAwait(false);
        lock (subscriptionLock) conversationSubscriptions.Add(conversationId);
        if (socket?.Connected == true)
            await socket.EmitAsync("conversation:subscribe", [new { conversationId }]).ConfigureAwait(false);
    }

    public async Task SubscribeProviderAsync(string providerId, CancellationToken cancellationToken = default)
    {
        await ConnectAsync(cancellationToken).ConfigureAwait(false);
        lock (subscriptionLock) providerSubscriptions.Add(providerId);
        if (socket?.Connected == true)
            await socket.EmitAsync("provider:subscribe", [new { providerId }]).ConfigureAwait(false);
    }

    public async Task UnsubscribeProviderAsync(string providerId)
    {
        lock (subscriptionLock) providerSubscriptions.Remove(providerId);
        if (socket?.Connected == true)
            await socket.EmitAsync("provider:unsubscribe", [new { providerId }]).ConfigureAwait(false);
    }

    public async Task DisconnectAsync()
    {
        await connectionGate.WaitAsync().ConfigureAwait(false);
        try { await DisconnectCoreAsync(clearSubscriptions: true).ConfigureAwait(false); }
        finally { connectionGate.Release(); }
    }

    public async Task SuspendAsync()
    {
        await connectionGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (socket is null && string.IsNullOrWhiteSpace(connectedUserId)) return;
            reconciliationGate.MarkDisconnected();
            await DisconnectCoreAsync(clearSubscriptions: false).ConfigureAwait(false);
        }
        finally { connectionGate.Release(); }
    }

    private async Task DisconnectCoreAsync(bool clearSubscriptions)
    {
        if (socket is not null)
        {
            if (socket.Connected) await socket.DisconnectAsync().ConfigureAwait(false);
            socket.Dispose();
        }
        socket = null;
        connectedToken = null;
        if (clearSubscriptions)
        {
            connectedUserId = null;
            reconciliationGate.Reset();
            lock (subscriptionLock)
            {
                conversationSubscriptions.Clear();
                providerSubscriptions.Clear();
            }
        }
    }

    private SocketIO CreateSocket(Uri endpoint, string token)
    {
        var newSocket = new SocketIO(endpoint, new SocketIOOptions
        {
            Auth = new Dictionary<string, string> { ["token"] = token },
            Reconnection = true,
            ReconnectionAttempts = RealtimeConnectionPolicy.ReconnectionAttempts,
            ReconnectionDelayMax = RealtimeConnectionPolicy.MaximumReconnectionDelayMilliseconds,
            ConnectionTimeout = RealtimeConnectionPolicy.InitialConnectTimeout,
            Transport = SocketIOClient.Common.TransportProtocol.WebSocket,
            AutoUpgrade = false,
        });
        newSocket.OnConnected += (_, _) =>
        {
            var shouldReconcile = reconciliationGate.ConsumeReconnect();
            _ = RestoreSubscriptionsAsync(newSocket);
            MainThread.BeginInvokeOnMainThread(() =>
            {
                ConnectionChanged?.Invoke(true);
                if (shouldReconcile) ReconciliationRequired?.Invoke();
            });
        };
        newSocket.OnDisconnected += (_, _) =>
        {
            reconciliationGate.MarkDisconnected();
            MainThread.BeginInvokeOnMainThread(() => ConnectionChanged?.Invoke(false));
        };
        newSocket.OnError += (_, error) => System.Diagnostics.Debug.WriteLine($"CampusGig realtime error: {error}");
        newSocket.On("inbox:changed", response =>
        {
            var envelope = response.GetValue<RealtimeOrderEnvelope>(0);
            if (envelope is not null) MainThread.BeginInvokeOnMainThread(() => InboxChanged?.Invoke(envelope.Key));
            return Task.CompletedTask;
        });
        newSocket.On("message:created", response =>
        {
            var envelope = response.GetValue<RealtimeMessageEnvelope>(0);
            if (envelope?.Message is not null)
                MainThread.BeginInvokeOnMainThread(() => MessageCreated?.Invoke(envelope.Key, envelope.Message));
            return Task.CompletedTask;
        });
        newSocket.On("notifications:changed", response =>
        {
            var envelope = response.GetValue<RealtimeOrderEnvelope>(0);
            if (envelope is not null) MainThread.BeginInvokeOnMainThread(() => NotificationsChanged?.Invoke(envelope.Key));
            return Task.CompletedTask;
        });
        newSocket.On("conversation:read", response =>
        {
            var envelope = response.GetValue<RealtimeReadEnvelope>(0);
            if (envelope is not null) MainThread.BeginInvokeOnMainThread(() => ConversationRead?.Invoke(envelope.Key, envelope.UserId));
            return Task.CompletedTask;
        });
        newSocket.On("provider:stats-changed", response =>
        {
            var envelope = response.GetValue<RealtimeProviderStatsEnvelope>(0);
            if (envelope is not null)
                MainThread.BeginInvokeOnMainThread(() => ProviderStatsChanged?.Invoke(envelope.ProviderId));
            return Task.CompletedTask;
        });
        newSocket.On("account:changed", response =>
        {
            var envelope = response.GetValue<RealtimeAccountEnvelope>(0);
            if (envelope is not null)
                MainThread.BeginInvokeOnMainThread(() => AccountChanged?.Invoke(envelope.Resource));
            return Task.CompletedTask;
        });
        newSocket.On("order:changed", response =>
        {
            var envelope = response.GetValue<RealtimeOrderEnvelope>(0);
            if (!string.IsNullOrWhiteSpace(envelope?.OrderId))
                MainThread.BeginInvokeOnMainThread(() => OrderChanged?.Invoke(envelope.OrderId));
            return Task.CompletedTask;
        });
        newSocket.On("payment:changed", response =>
        {
            var envelope = response.GetValue<RealtimeOrderEnvelope>(0);
            if (!string.IsNullOrWhiteSpace(envelope?.OrderId))
                MainThread.BeginInvokeOnMainThread(() => PaymentChanged?.Invoke(envelope.OrderId));
            return Task.CompletedTask;
        });
        newSocket.On("marketplace:changed", _ =>
        {
            MainThread.BeginInvokeOnMainThread(() => MarketplaceChanged?.Invoke());
            return Task.CompletedTask;
        });
        return newSocket;
    }

    private async Task RestoreSubscriptionsAsync(SocketIO target)
    {
        try
        {
            string[] conversationIds;
            string[] providerIds;
            lock (subscriptionLock)
            {
                conversationIds = [.. conversationSubscriptions];
                providerIds = [.. providerSubscriptions];
            }
            if (!ReferenceEquals(socket, target) || !target.Connected) return;
            foreach (var conversationId in conversationIds)
                await target.EmitAsync("conversation:subscribe", [new { conversationId }]).ConfigureAwait(false);
            foreach (var providerId in providerIds)
                await target.EmitAsync("provider:subscribe", [new { providerId }]).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"CampusGig subscription restore failed: {exception.Message}");
        }
    }

    public async ValueTask DisposeAsync() => await DisconnectAsync();

    private class RealtimeOrderEnvelope
    {
        public string? ConversationId { get; set; }
        public string? OrderId { get; set; }
        public string Key => ConversationId ?? OrderId ?? "";
    }
    private sealed class RealtimeMessageEnvelope : RealtimeOrderEnvelope { public ConversationMessage? Message { get; set; } }
    private sealed class RealtimeReadEnvelope : RealtimeOrderEnvelope { public string UserId { get; set; } = ""; }
    private sealed class RealtimeProviderStatsEnvelope { public string ProviderId { get; set; } = ""; }
    private sealed class RealtimeAccountEnvelope { public string Resource { get; set; } = ""; }
}
