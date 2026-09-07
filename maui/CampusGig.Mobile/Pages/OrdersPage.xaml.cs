using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class OrdersPage : ContentPage, ITabLifecycle
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private bool isLoading;
    private bool hasLoaded;

    private string scope = "client";

    public OrdersPage(CampusGigApi api, SessionService session)
    {
        InitializeComponent();
        this.api = api;
        this.session = session;
        ScopeTabs.IsVisible = session.User?.Roles.Contains("PROVIDER") == true;
    }

    public async Task OnTabAppearingAsync() => await LoadAsync();
    public Task OnTabDisappearingAsync() => Task.CompletedTask;

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await OnTabAppearingAsync();
    }

    private async Task LoadAsync()
    {
        if (isLoading) return;
        isLoading = true;
        LoadingOrders.IsVisible = !hasLoaded;
        OrderList.IsVisible = hasLoaded;
        Exception? loadError = null;
        try
        {
            var response = await api.GetAsync<ApiList<OrderItem>>($"orders?scope={scope}");
            OrderList.ItemsSource = response.Data;
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
        }

        if (loadError is not null)
            await AppDialog.AlertAsync(this, "Unable to load orders", loadError.Message);
    }

    private async void OnRefreshing(object? sender, EventArgs e) => await LoadAsync();

    private async void OnOrderTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not OrderItem order) return;
        if (sender is TapGestureRecognizer { Parent: VisualElement card })
            await PlayTapAsync(card);
        await Navigation.PushModalAsync(new NavigationPage(new OrderWorkspacePage(api, session, order.Id)));
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
        var isDark = Application.Current?.UserAppTheme == AppTheme.Dark;
        var inactive = Color.FromArgb(isDark ? "#71D7B1" : "#0F6B4F");
        ClientScopeButton.TextColor = scope == "client" ? Colors.White : inactive;
        ProviderScopeButton.TextColor = scope == "provider" ? Colors.White : inactive;
        await ScopeIndicator.TranslateToAsync(
            InteractionMotion.SegmentOffset(scope == "provider", 122, 4), 0, 190, Easing.CubicInOut);
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
