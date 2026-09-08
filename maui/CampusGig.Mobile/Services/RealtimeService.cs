using CampusGig.Mobile.Models;
using SocketIOClient;

namespace CampusGig.Mobile.Services;

public sealed class RealtimeService : IAsyncDisposable
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly SemaphoreSlim connectionGate = new(1, 1);
    private SocketIO? socket;
    private string? connectedToken;
    public bool IsConnected => socket?.Connected == true;

    public event Action<string>? InboxChanged;
    public event Action<string>? NotificationsChanged;
    public event Action<string, ConversationMessage>? MessageCreated;
    public event Action<string, string>? ConversationRead;
    public event Action<bool>? ConnectionChanged;

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
            await DisconnectCoreAsync().ConfigureAwait(false);

            var baseUri = new Uri(api.BaseUrl);
            var endpoint = new UriBuilder(baseUri.Scheme, baseUri.Host, baseUri.Port) { Path = "/realtime" }.Uri;
            socket = CreateSocket(endpoint, token);
            connectedToken = token;

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(RealtimeConnectionPolicy.InitialConnectTimeout);
            await socket.ConnectAsync(timeout.Token).ConfigureAwait(false);
        }
        catch
        {
            await DisconnectCoreAsync().ConfigureAwait(false);
            throw;
        }
        finally
        {
            connectionGate.Release();
        }
    }

    public async Task SubscribeAsync(string orderId, CancellationToken cancellationToken = default)
    {
        await ConnectAsync(cancellationToken).ConfigureAwait(false);
        if (socket?.Connected == true)
            await socket.EmitAsync("conversation:subscribe", [new { orderId }]).ConfigureAwait(false);
    }

    public async Task DisconnectAsync()
    {
        await connectionGate.WaitAsync().ConfigureAwait(false);
        try { await DisconnectCoreAsync().ConfigureAwait(false); }
        finally { connectionGate.Release(); }
    }

    private async Task DisconnectCoreAsync()
    {
        if (socket is not null)
        {
            if (socket.Connected) await socket.DisconnectAsync().ConfigureAwait(false);
            socket.Dispose();
        }
        socket = null;
        connectedToken = null;
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
        newSocket.OnConnected += (_, _) => MainThread.BeginInvokeOnMainThread(() => ConnectionChanged?.Invoke(true));
        newSocket.OnDisconnected += (_, _) => MainThread.BeginInvokeOnMainThread(() => ConnectionChanged?.Invoke(false));
        newSocket.OnError += (_, error) => System.Diagnostics.Debug.WriteLine($"CampusGig realtime error: {error}");
        newSocket.On("inbox:changed", response =>
        {
            var envelope = response.GetValue<RealtimeOrderEnvelope>(0);
            if (envelope is not null) MainThread.BeginInvokeOnMainThread(() => InboxChanged?.Invoke(envelope.OrderId));
            return Task.CompletedTask;
        });
        newSocket.On("message:created", response =>
        {
            var envelope = response.GetValue<RealtimeMessageEnvelope>(0);
            if (envelope?.Message is not null)
                MainThread.BeginInvokeOnMainThread(() => MessageCreated?.Invoke(envelope.OrderId, envelope.Message));
            return Task.CompletedTask;
        });
        newSocket.On("notifications:changed", response =>
        {
            var envelope = response.GetValue<RealtimeOrderEnvelope>(0);
            if (envelope is not null) MainThread.BeginInvokeOnMainThread(() => NotificationsChanged?.Invoke(envelope.OrderId));
            return Task.CompletedTask;
        });
        newSocket.On("conversation:read", response =>
        {
            var envelope = response.GetValue<RealtimeReadEnvelope>(0);
            if (envelope is not null) MainThread.BeginInvokeOnMainThread(() => ConversationRead?.Invoke(envelope.OrderId, envelope.UserId));
            return Task.CompletedTask;
        });
        return newSocket;
    }

    public async ValueTask DisposeAsync() => await DisconnectAsync();

    private class RealtimeOrderEnvelope { public string OrderId { get; set; } = ""; }
    private sealed class RealtimeMessageEnvelope : RealtimeOrderEnvelope { public ConversationMessage? Message { get; set; } }
    private sealed class RealtimeReadEnvelope : RealtimeOrderEnvelope { public string UserId { get; set; } = ""; }
}
