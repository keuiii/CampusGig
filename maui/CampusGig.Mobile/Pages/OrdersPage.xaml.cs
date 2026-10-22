using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class OrdersPage : ContentPage, ITabLifecycle, IDisposable
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly RealtimeService realtime;
    private bool isLoading;
    private bool hasLoaded;
    private bool archivedView;
    private bool isUpdatingVisibility;
    private int loadedPageCount = 1;

    private string scope = "client";

    public OrdersPage(CampusGigApi api, SessionService session, RealtimeService realtime)
    {
        InitializeComponent();
        this.api = api;
        this.session = session;
        this.realtime = realtime;
        realtime.OrderChanged += OnOrderChanged;
        realtime.PaymentChanged += OnOrderChanged;
        realtime.ReconciliationRequired += OnRealtimeReconciliationRequired;
        ScopeTabs.IsVisible = session.User?.Roles.Contains("PROVIDER") == true;
    }

    public async Task OnTabAppearingAsync() => await LoadAsync();
    public Task OnTabDisappearingAsync() => Task.CompletedTask;

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await OnTabAppearingAsync();
    }

    private async Task LoadAsync(bool loadMore = false)
    {
        if (isLoading) return;
        isLoading = true;
        LoadingOrders.IsVisible = !hasLoaded;
        OrderList.IsVisible = hasLoaded;
        Exception? loadError = null;
        try
        {
            var requestedPages = loadMore ? loadedPageCount + 1 : loadedPageCount;
            var orders = new List<OrderItem>();
            string? cursor = null;
            ApiList<OrderItem>? response = null;
            var pagesFetched = 0;
            for (var page = 0; page < requestedPages; page++)
            {
                var cursorQuery = string.IsNullOrWhiteSpace(cursor)
                    ? ""
                    : $"&cursor={Uri.EscapeDataString(cursor)}";
                response = await api.GetAsync<ApiList<OrderItem>>(
                    $"orders?scope={scope}&view={(archivedView ? "archived" : "active")}&limit=20{cursorQuery}");
                foreach (var order in response.Data)
                    PrepareOrder(order);
                orders.AddRange(response.Data);
                pagesFetched++;
                cursor = response.Pagination.NextCursor;
                if (!response.Pagination.HasMore || string.IsNullOrWhiteSpace(cursor)) break;
            }
            loadedPageCount = Math.Max(1, pagesFetched);
            OrderList.ItemsSource = orders.DistinctBy(order => order.Id).ToList();
            LoadMoreOrdersButton.IsVisible = response?.Pagination.HasMore == true;
            LoadMoreOrdersButton.IsEnabled = true;
            LoadMoreOrdersButton.Text = "Load more orders";
            hasLoaded = true;
            OrderList.IsVisible = true;
        }
        catch (Exception exception)
        {
            loadError = exception;
        }
        finally
        {
            isLoading = false;
            LoadingOrders.IsVisible = false;
            Refresh.IsRefreshing = false;
            LoadMoreOrdersButton.IsEnabled = true;
            LoadMoreOrdersButton.Text = "Load more orders";
        }

        if (loadError is not null)
            await AppDialog.AlertAsync(this, "Unable to load orders", loadError.Message);
    }

    private void PrepareOrder(OrderItem order)
    {
        order.Provider.ResolveAvatarUrl(api.BaseUrl);
        order.Client.ResolveAvatarUrl(api.BaseUrl);
        order.IsArchived = archivedView;
        var providerView = scope == "provider";
        order.RelationshipRole = providerView ? "CLIENT" : "VERIFIED PROVIDER";
        order.RelationshipName = providerView
            ? order.Client.DisplayName
            : order.Provider.DisplayName;
        order.RelationshipAvatarUrl = providerView
            ? order.Client.AvatarUrl
            : order.Provider.AvatarUrl;
    }

    private async void OnLoadMoreOrdersClicked(object? sender, EventArgs e)
    {
        if (isLoading) return;
        LoadMoreOrdersButton.IsEnabled = false;
        LoadMoreOrdersButton.Text = "Loading...";
        await LoadAsync(loadMore: true);
    }

    private async void OnRefreshing(object? sender, EventArgs e) => await LoadAsync();

    private static void OnOrderSwipeChanging(object? sender, SwipeChangingEventArgs e)
    {
        if (sender is SwipeView { Content: VisualElement foreground })
            foreground.Opacity = Math.Abs(e.Offset) > 8 ? 0 : 1;
    }

    private static void OnOrderSwipeEnded(object? sender, SwipeEndedEventArgs e)
    {
        if (sender is SwipeView { Content: VisualElement foreground })
            foreground.Opacity = e.IsOpen ? 0 : 1;
    }

    private async void OnArchivedOrdersClicked(object? sender, EventArgs e)
    {
        if (isLoading || isUpdatingVisibility) return;
        archivedView = !archivedView;
        ArchivedOrdersButton.BackgroundColor = Color.FromArgb(archivedView ? "#DFF2E8" : "#F2EED8");
        ArchivedOrdersIcon.Stroke = Color.FromArgb(archivedView ? "#0F6B4F" : "#71663D");
        loadedPageCount = 1;
        hasLoaded = false;
        SemanticProperties.SetDescription(ArchivedOrdersButton, archivedView ? "Show current orders" : "View archived orders");
        EmptyOrdersTitle.Text = archivedView ? "No archived orders" : "No orders yet";
        EmptyOrdersDescription.Text = archivedView
            ? "Completed orders you archive appear here. Swipe one to restore or remove it."
            : "Choose a published student service and send your first project request.";
        BrowseServicesButton.IsVisible = !archivedView;
        await LoadAsync();
    }

    private async void OnArchiveOrderTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is OrderItem order)
            await UpdateVisibilityAsync(order, archivedView ? "restore" : "archive");
    }

    private async void OnRemoveOrderTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not OrderItem order || isUpdatingVisibility) return;
        var confirmed = await AppDialog.ConfirmAsync(this, "Remove order from your list?",
            "This only removes it from your view. Payment, files, messages, and order history remain saved.", "Remove", "Cancel");
        if (confirmed) await UpdateVisibilityAsync(order, "remove");
    }

    private async Task UpdateVisibilityAsync(OrderItem order, string action)
    {
        if (isUpdatingVisibility || !order.IsCompleted) return;
        isUpdatingVisibility = true;
        try
        {
            await api.PostAsync<OrderVisibilityResponse>($"orders/{order.Id}/{action}");
            while (isLoading) await Task.Delay(50);
            await LoadAsync();
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Unable to update order", exception.Message);
        }
        finally
        {
            isUpdatingVisibility = false;
        }
    }

    private sealed class OrderVisibilityResponse
    {
        public string Id { get; set; } = "";
        public string View { get; set; } = "";
    }

    private async void OnOrderTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not OrderItem order) return;
        if (sender is TapGestureRecognizer { Parent: VisualElement card })
            await PlayTapAsync(card);
        await OpenOrderAsync(order.Id);
    }

    public Task OpenOrderAsync(string orderId) =>
        Navigation.PushModalAsync(new NavigationPage(new OrderWorkspacePage(api, session, realtime, orderId)));

    private void OnOrderChanged(string orderId) => _ = LoadAsync();
    private async void OnRealtimeReconciliationRequired()
    {
        while (isLoading) await Task.Delay(50);
        await LoadAsync();
    }

    public void Dispose()
    {
        realtime.OrderChanged -= OnOrderChanged;
        realtime.PaymentChanged -= OnOrderChanged;
        realtime.ReconciliationRequired -= OnRealtimeReconciliationRequired;
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

    private async void OnScopeClicked(object? sender, EventArgs e)
    {
        if (isLoading || sender is not Button button || button.CommandParameter?.ToString() is not string next || next == scope) return;
        await Task.WhenAll(
            OrderList.FadeToAsync(0.2, 75, Easing.CubicIn),
            OrderList.TranslateToAsync(next == "provider" ? -8 : 8, 0, 75, Easing.CubicIn));
        scope = next;
        loadedPageCount = 1;
        var isDark = Application.Current?.UserAppTheme == AppTheme.Dark;
        var inactive = Color.FromArgb(isDark ? "#71D7B1" : "#0F6B4F");
        ClientScopeButton.TextColor = scope == "client" ? Colors.White : inactive;
        ProviderScopeButton.TextColor = scope == "provider" ? Colors.White : inactive;
        await ScopeIndicator.TranslateToAsync(
            InteractionMotion.SegmentOffset(scope == "provider", 110, 4), 0, 190, Easing.CubicInOut);
        hasLoaded = false;
        await LoadAsync();
        OrderList.TranslationX = scope == "provider" ? 8 : -8;
        OrderList.Opacity = 0;
        await Task.WhenAll(
            OrderList.FadeToAsync(1, 150, Easing.CubicOut),
            OrderList.TranslateToAsync(0, 0, 170, Easing.CubicOut));
    }

    private async void OnScopePressed(object? sender, EventArgs e)
    {
        if (sender is VisualElement element)
            await element.ScaleToAsync(0.97, 50, Easing.CubicOut);
    }

    private async void OnScopeReleased(object? sender, EventArgs e)
    {
        if (sender is VisualElement element)
            await element.ScaleToAsync(1, 95, Easing.CubicOut);
    }

    private void OnBrowseClicked(object? sender, EventArgs e)
    {
        MainTabbedPage.Instance?.SelectTab("discover");
    }
}
