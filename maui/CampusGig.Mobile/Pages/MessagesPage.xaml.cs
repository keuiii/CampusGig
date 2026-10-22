using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class MessagesPage : ContentPage, ITabLifecycle, IDisposable
{
    private readonly CampusGigApi api;
    private readonly RealtimeService realtime;
    private List<ConversationItem> conversations = [];
    private CancellationTokenSource? refreshCancellation;
    private bool isLoading;
    private bool hasLoaded;
    private bool isOpeningConversation;
    private bool isUpdatingConversation;
    private bool showArchived;
    private int loadedPageCount = 1;
    private CancellationTokenSource? realtimeRefreshCancellation;

    public event Action<int>? UnreadCountChanged;
    public bool IsRealtimeConnected => realtime.IsConnected;

    public MessagesPage(CampusGigApi api, RealtimeService realtime)
    {
        InitializeComponent();
        this.api = api;
        this.realtime = realtime;
        realtime.InboxChanged += OnRealtimeInboxChanged;
        realtime.ReconciliationRequired += OnRealtimeReconciliationRequired;
    }

    public async Task OnTabAppearingAsync()
    {
        await Task.Yield();
        await LoadAsync();
        _ = ConnectRealtimeSafelyAsync();
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        refreshCancellation = new CancellationTokenSource();
        _ = RefreshInBackgroundAsync(refreshCancellation.Token);
    }

    private async Task ConnectRealtimeSafelyAsync()
    {
        try { await Task.Run(() => realtime.ConnectAsync()); }
        catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
    }

    public Task OnTabDisappearingAsync()
    {
        realtimeRefreshCancellation?.Cancel();
        realtimeRefreshCancellation?.Dispose();
        realtimeRefreshCancellation = null;
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        refreshCancellation = null;
        return Task.CompletedTask;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await OnTabAppearingAsync();
    }

    protected override async void OnDisappearing()
    {
        await OnTabDisappearingAsync();
        base.OnDisappearing();
    }

    private async Task LoadAsync(bool showError = true, bool loadMore = false)
    {
        if (isLoading) return;
        isLoading = true;
        LoadingConversations.IsVisible = !hasLoaded;
        ConversationList.IsVisible = hasLoaded;
        Exception? loadError = null;
        try
        {
            var requestedPages = loadMore ? loadedPageCount + 1 : loadedPageCount;
            var loaded = new List<ConversationItem>();
            string? cursor = null;
            ApiList<ConversationItem>? response = null;
            var pagesFetched = 0;
            var totalUnreadCount = 0;
            for (var page = 0; page < requestedPages; page++)
            {
                var cursorQuery = string.IsNullOrWhiteSpace(cursor)
                    ? ""
                    : $"&cursor={Uri.EscapeDataString(cursor)}";
                response = await api.GetAsync<ApiList<ConversationItem>>(
                    $"conversations?archived={showArchived.ToString().ToLowerInvariant()}&limit=20{cursorQuery}");
                if (page == 0) totalUnreadCount = response.UnreadCount ?? response.Data.Sum(item => item.UnreadCount);
                loaded.AddRange(response.Data);
                pagesFetched++;
                cursor = response.Pagination.NextCursor;
                if (!response.Pagination.HasMore || string.IsNullOrWhiteSpace(cursor)) break;
            }
            loadedPageCount = Math.Max(1, pagesFetched);
            conversations = loaded.DistinctBy(item => item.Id).ToList();
            foreach (var item in conversations)
            {
                item.Participant.AvatarUrl = item.Participant.HasAvatar
                    ? $"{api.BaseUrl}/profile/avatar/{item.Participant.Id}?v={item.Participant.AvatarVersion}"
                    : null;
            }
            RenderUnreadCount(totalUnreadCount);
            if (!showArchived) UnreadCountChanged?.Invoke(totalUnreadCount);
            LoadMoreConversationsButton.IsVisible = response?.Pagination.HasMore == true;
            LoadMoreConversationsButton.IsEnabled = true;
            LoadMoreConversationsButton.Text = "Load more conversations";
            ApplyFilter();
            hasLoaded = true;
            ConversationList.IsVisible = true;
        }
        catch (Exception exception)
        {
            if (showError) loadError = exception;
        }
        finally
        {
            Refresh.IsRefreshing = false;
            LoadingConversations.IsVisible = false;
            isLoading = false;
            LoadMoreConversationsButton.IsEnabled = true;
            LoadMoreConversationsButton.Text = "Load more conversations";
        }

        if (loadError is not null)
            await AppDialog.AlertAsync(this, "Unable to load messages", loadError.Message);
    }

    private async Task RefreshInBackgroundAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
            while (await timer.WaitForNextTickAsync(cancellationToken))
                if (!realtime.IsConnected)
                    await LoadAsync(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
        }
    }

    private async void OnRefreshing(object? sender, EventArgs e) => await LoadAsync();

    private async void OnLoadMoreConversationsClicked(object? sender, EventArgs e)
    {
        if (isLoading) return;
        LoadMoreConversationsButton.IsEnabled = false;
        LoadMoreConversationsButton.Text = "Loading...";
        await LoadAsync(loadMore: true);
    }

    private void OnSearchChanged(object? sender, TextChangedEventArgs e)
    {
        ClearSearchButton.IsVisible = !string.IsNullOrEmpty(e.NewTextValue);
        ApplyFilter();
    }

    private void OnClearSearchClicked(object? sender, EventArgs e)
    {
        MessageSearch.Text = "";
        MessageSearch.Focus();
    }

    private void ApplyFilter()
    {
        var query = MessageSearch.Text?.Trim() ?? "";
        ConversationList.ItemsSource = conversations.Where(item =>
            string.IsNullOrWhiteSpace(query) ||
            $"{item.Participant.DisplayName} {item.Order.OrderNumber} {item.Preview}"
                .Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();
    }

    private async void OnArchiveInboxClicked(object? sender, EventArgs e)
    {
        if (isLoading) return;
        showArchived = !showArchived;
        MessagesTitle.Text = showArchived ? "Archived" : "Messages";
        EmptyConversationsTitle.Text = showArchived ? "No archived conversations" : "No conversations yet";
        EmptyConversationsBody.Text = showArchived
            ? "Swipe a conversation in Messages to archive it."
            : "Your conversations will appear here after a booking is created.";
        ArchiveInboxButton.BackgroundColor = Color.FromArgb(showArchived ? "#DFF2E8" : "#F2EED8");
        SemanticProperties.SetDescription(
            ArchiveInboxButton,
            showArchived ? "Show active conversations" : "Show archived conversations");
        hasLoaded = false;
        loadedPageCount = 1;
        await LoadAsync();
    }

    private async void OnPinConversationTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not ConversationItem conversation) return;
        await UpdateConversationPreferenceAsync(
            conversation,
            new { pinned = !conversation.IsPinned },
            "Conversation not updated");
    }

    private async void OnArchiveConversationTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not ConversationItem conversation) return;
        await UpdateConversationPreferenceAsync(
            conversation,
            new { archived = !conversation.IsArchived },
            "Conversation not updated");
    }

    private async Task UpdateConversationPreferenceAsync(
        ConversationItem conversation,
        object update,
        string failureTitle)
    {
        if (isUpdatingConversation) return;
        isUpdatingConversation = true;
        try
        {
            await api.PatchAsync<ApiResult<ConversationPreferenceState>>(
                $"conversations/{conversation.Id}/preferences",
                update);
            await LoadAsync(false);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, failureTitle, exception.Message, "Try again");
        }
        finally
        {
            isUpdatingConversation = false;
        }
    }

    private async void OnConversationTapped(object? sender, TappedEventArgs e)
    {
        if (isOpeningConversation || e.Parameter is not ConversationItem conversation) return;
        isOpeningConversation = true;
        try
        {
            if (sender is TapGestureRecognizer { Parent: VisualElement card })
                _ = PlayTapAsync(card);
            await Navigation.PushModalAsync(
                new ConversationPage(api, conversation, RefreshAfterConversationAsync, realtime),
                animated: false);
        }
        finally { isOpeningConversation = false; }
    }

    private async Task RefreshAfterConversationAsync() => await LoadAsync(false);

    private void OnRealtimeInboxChanged(string orderId)
    {
        realtimeRefreshCancellation?.Cancel();
        realtimeRefreshCancellation?.Dispose();
        realtimeRefreshCancellation = new CancellationTokenSource();
        _ = RefreshAfterRealtimeEventAsync(realtimeRefreshCancellation.Token);
    }

    private async void OnRealtimeReconciliationRequired()
    {
        while (isLoading) await Task.Delay(50);
        await LoadAsync(false);
    }

    private async Task RefreshAfterRealtimeEventAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(250, cancellationToken);
            await LoadAsync(false);
        }
        catch (OperationCanceledException) { }
    }

    private async void OnDeleteConversationTapped(object? sender, TappedEventArgs e)
    {
        if (isUpdatingConversation || e.Parameter is not ConversationItem conversation) return;

        var confirmed = await AppDialog.ConfirmAsync(
            this,
            "Delete conversation?",
            $"Remove your conversation with {conversation.Participant.DisplayName} from Messages? The order and the other person's copy will not be deleted.",
            "Delete",
            "Keep");
        if (!confirmed) return;

        isUpdatingConversation = true;
        try
        {
            await api.DeleteAsync<ApiMessage>($"conversations/{conversation.Id}");
            await LoadAsync(false);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Conversation not deleted", exception.Message, "Try again");
        }
        finally
        {
            isUpdatingConversation = false;
        }
    }

    private void RenderUnreadCount(int unreadCount)
    {
        UnreadCountBadge.IsVisible = true;
        UnreadCountLabel.Text = UnreadBadgeRules.Label(unreadCount);
        UnreadCountLabel.TextColor = Color.FromArgb(UnreadBadgeRules.Foreground(unreadCount));
        UnreadCountBadge.BackgroundColor = Color.FromArgb(UnreadBadgeRules.Background(unreadCount));
        SemanticProperties.SetDescription(
            UnreadCountBadge,
            unreadCount > 0 ? $"{unreadCount} unread messages" : "No unread messages");
    }

    private static async Task PlayTapAsync(VisualElement element)
    {
        await Task.WhenAll(
            element.ScaleToAsync(0.975, 65, Easing.CubicOut),
            element.FadeToAsync(0.86, 65, Easing.CubicOut));
        await Task.WhenAll(
            element.ScaleToAsync(1, 115, Easing.CubicOut),
            element.FadeToAsync(1, 115, Easing.CubicOut));
    }

    public async Task RefreshTabAsync() => await LoadAsync();
    public async Task RefreshUnreadCountAsync() => await LoadAsync(false);

    public void Dispose()
    {
        realtime.InboxChanged -= OnRealtimeInboxChanged;
        realtime.ReconciliationRequired -= OnRealtimeReconciliationRequired;
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        realtimeRefreshCancellation?.Cancel();
        realtimeRefreshCancellation?.Dispose();
    }
}
