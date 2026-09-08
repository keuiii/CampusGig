using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class MessagesPage : ContentPage, ITabLifecycle
{
    private readonly CampusGigApi api;
    private readonly RealtimeService realtime;
    private List<ConversationItem> conversations = [];
    private CancellationTokenSource? refreshCancellation;
    private bool isLoading;
    private bool hasLoaded;
    private bool isOpeningConversation;
    private bool isDeletingConversation;
    private CancellationTokenSource? realtimeRefreshCancellation;

    public event Action<int>? UnreadCountChanged;

    public MessagesPage(CampusGigApi api, RealtimeService realtime)
    {
        InitializeComponent();
        this.api = api;
        this.realtime = realtime;
        realtime.InboxChanged += OnRealtimeInboxChanged;
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

    private async Task LoadAsync(bool showError = true)
    {
        if (isLoading) return;
        isLoading = true;
        LoadingConversations.IsVisible = !hasLoaded;
        ConversationList.IsVisible = hasLoaded;
        Exception? loadError = null;
        try
        {
            var response = await api.GetAsync<ApiList<ConversationItem>>("conversations");
            conversations = response.Data;
            foreach (var item in conversations)
            {
                item.Participant.AvatarUrl = item.Participant.HasAvatar
                    ? $"{api.BaseUrl}/profile/avatar/{item.Participant.Id}?v={item.Participant.AvatarVersion}"
                    : null;
            }
            var unreadCount = conversations.Sum(item => item.UnreadCount);
            UnreadCountLabel.Text = unreadCount.ToString();
            UnreadCountChanged?.Invoke(unreadCount);
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
        }

        if (loadError is not null)
            await AppDialog.AlertAsync(this, "Unable to load messages", loadError.Message);
    }

    private async Task RefreshInBackgroundAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(8));
            while (await timer.WaitForNextTickAsync(cancellationToken))
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

    private async Task RefreshAfterRealtimeEventAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(250, cancellationToken);
            await LoadAsync(false);
        }
        catch (OperationCanceledException) { }
    }

    private async void OnDeleteConversationInvoked(object? sender, EventArgs e)
    {
        if (isDeletingConversation || sender is not SwipeItem { CommandParameter: ConversationItem conversation }) return;

        var confirmed = await AppDialog.ConfirmAsync(
            this,
            "Delete conversation?",
            $"Remove your conversation with {conversation.Participant.DisplayName} from Messages? The order and the other person's copy will not be deleted.",
            "Delete",
            "Keep");
        if (!confirmed) return;

        isDeletingConversation = true;
        try
        {
            await api.DeleteAsync<ApiMessage>($"conversations/{conversation.Id}");
            conversations.RemoveAll(item => item.Id == conversation.Id);
            ApplyFilter();
            UpdateUnreadCount();
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Conversation not deleted", exception.Message, "Try again");
        }
        finally
        {
            isDeletingConversation = false;
        }
    }

    private void UpdateUnreadCount()
    {
        var unreadCount = conversations.Sum(item => item.UnreadCount);
        UnreadCountLabel.Text = unreadCount.ToString();
        UnreadCountChanged?.Invoke(unreadCount);
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
}
