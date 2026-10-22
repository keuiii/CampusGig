using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using Microsoft.Maui.Controls.Shapes;
using Microsoft.Maui.Layouts;

namespace CampusGig.Mobile.Pages;

public sealed class MainTabbedPage : ContentPage
{
    public static MainTabbedPage? Instance { get; private set; }

    public static void ClearInstance()
    {
        if (Instance is not null)
            foreach (var disposable in Instance.pages.Values.OfType<IDisposable>())
                disposable.Dispose();
        Instance = null;
    }

    private readonly Dictionary<string, View> tabViews = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (Image Icon, Label Label, VisualElement Item)> tabButtons = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ContentPage> pages = new(StringComparer.Ordinal);
    private readonly Grid contentArea;
    private readonly MessagesPage messagesPage;
    private readonly OrdersPage ordersPage;
    private readonly Border tabHighlight;
    private Border? messagesBadge;
    private Label? messagesBadgeLabel;
    private IDispatcherTimer? unreadTimer;
    private string activeRoute = "discover";
    private string highlightedRoute = "discover";
    private bool isTabAnimating;
    private readonly HashSet<string> warmedRoutes = ["discover", "messages"];

    public MainTabbedPage(
        HomePage home,
        OrdersPage orders,
        MessagesPage messages,
        ProfilePage profile)
    {
        Instance = this;
        messagesPage = messages;
        ordersPage = orders;
        messagesPage.UnreadCountChanged += UpdateMessagesBadge;
        NavigationPage.SetHasNavigationBar(this, false);
        this.SetAppThemeColor(ContentPage.BackgroundColorProperty, Color.FromArgb("#F3F5F3"), Color.FromArgb("#111713"));

        pages["discover"] = home;
        pages["orders"] = orders;
        pages["messages"] = messages;
        pages["profile"] = profile;

        contentArea = new Grid();

        foreach (var (route, page) in pages)
        {
            try { page.Parent = this; } catch { }
            var view = page.Content;
            page.Content = null;
            // The custom tab host reparents each page's root view. Preserve the
            // page binding context explicitly so bindings do not inherit this host.
            view.BindingContext = page.BindingContext ?? page;
            var isDiscover = route == "discover";
            var keepWarm = route == "messages";
            view.IsVisible = isDiscover || keepWarm;
            view.Opacity = isDiscover ? 1 : 0;
            view.InputTransparent = !isDiscover;
            view.ZIndex = isDiscover ? 1 : -1;
            contentArea.Children.Add(view);
            tabViews[route] = view;
        }

        var navGrid = new Grid
        {
            ColumnDefinitions = new ColumnDefinitionCollection
            {
                new(GridLength.Star),
                new(GridLength.Star),
                new(GridLength.Star),
                new(GridLength.Star),
            }
        };
        var navHost = new AbsoluteLayout();
        AbsoluteLayout.SetLayoutBounds(navGrid, new Rect(0, 0, 1, 1));
        AbsoluteLayout.SetLayoutFlags(navGrid, AbsoluteLayoutFlags.All);

        tabHighlight = new Border
        {
            HeightRequest = 50,
            StrokeThickness = 0,
            StrokeShape = new RoundRectangle { CornerRadius = 16 },
            HorizontalOptions = LayoutOptions.Start,
            VerticalOptions = LayoutOptions.Center,
            InputTransparent = true,
            ZIndex = 0,
        };
        tabHighlight.SetAppThemeColor(
            Border.BackgroundColorProperty,
            Color.FromArgb("#DDF3E9"),
            Color.FromArgb("#294238"));
        AbsoluteLayout.SetLayoutBounds(tabHighlight, new Rect(0, .5, 0, 50));
        AbsoluteLayout.SetLayoutFlags(tabHighlight, AbsoluteLayoutFlags.YProportional);
        navHost.Children.Add(tabHighlight);
        navHost.Children.Add(navGrid);
        navHost.SizeChanged += (_, _) =>
        {
            if (!isTabAnimating) PositionTabHighlight(highlightedRoute);
        };

        var bottomNavBorder = new Border
        {
            HeightRequest = 64,
            StrokeThickness = 1,
            StrokeShape = new RoundRectangle { CornerRadius = 20 },
            Padding = new Thickness(6),
            Margin = new Thickness(16, 5, 16, 8),
            HorizontalOptions = LayoutOptions.Fill,
            VerticalOptions = LayoutOptions.End,
            Content = navHost,
            Shadow = new Shadow
            {
                Brush = Color.FromArgb("#33000000"),
                Offset = new Point(0, 5),
                Radius = 14,
                Opacity = .24f,
            },
        };
        bottomNavBorder.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#F2F7F4"), Color.FromArgb("#E61A241F"));
        bottomNavBorder.SetAppThemeColor(Border.StrokeProperty, Color.FromArgb("#DDE3DF"), Color.FromArgb("#24312A"));

        for (int i = 0; i < MobileNavigation.Tabs.Count; i++)
        {
            var def = MobileNavigation.Tabs[i];
            var itemLayout = new VerticalStackLayout
            {
                HorizontalOptions = LayoutOptions.Fill,
                VerticalOptions = LayoutOptions.Fill,
                Padding = new Thickness(4, 4, 4, 2),
                Spacing = 0,
            };

            var icon = new Image
            {
                Source = def.IconFile,
                WidthRequest = 22,
                HeightRequest = 22,
                Aspect = Aspect.AspectFit,
                HorizontalOptions = LayoutOptions.Center,
                VerticalOptions = LayoutOptions.Center,
            };

            var titleLabel = new Label
            {
                Text = def.Title,
                FontSize = 9,
                FontAttributes = FontAttributes.Bold,
                Margin = new Thickness(0, 1, 0, 0),
                HorizontalTextAlignment = TextAlignment.Center,
            };

            itemLayout.Children.Add(icon);
            itemLayout.Children.Add(titleLabel);

            var route = def.Route;
            var itemContainer = new Grid
            {
                AutomationId = $"Tab{char.ToUpperInvariant(route[0])}{route[1..]}"
            };
            itemContainer.ZIndex = 1;
            itemContainer.Children.Add(itemLayout);
            if (route == "messages")
            {
                messagesBadgeLabel = new Label
                {
                    FontSize = 8,
                    FontAttributes = FontAttributes.Bold,
                    TextColor = Color.FromArgb(UnreadBadgeRules.EmptyForeground),
                    HorizontalTextAlignment = TextAlignment.Center,
                    VerticalTextAlignment = TextAlignment.Center,
                };
                messagesBadge = new Border
                {
                    MinimumWidthRequest = 18,
                    HeightRequest = 18,
                    Padding = new Thickness(4, 0),
                    StrokeThickness = 2,
                    StrokeShape = new RoundRectangle { CornerRadius = 9 },
                    BackgroundColor = Color.FromArgb(UnreadBadgeRules.EmptyBackground),
                    HorizontalOptions = LayoutOptions.End,
                    VerticalOptions = LayoutOptions.Start,
                    Margin = new Thickness(0, 1, 17, 0),
                    IsVisible = false,
                    ZIndex = 3,
                    Content = messagesBadgeLabel,
                };
                messagesBadge.SetAppThemeColor(Border.StrokeProperty, Colors.White, Color.FromArgb("#151D19"));
                itemContainer.Children.Add(messagesBadge);
            }

            var tap = new TapGestureRecognizer();
            tap.Tapped += async (_, _) =>
            {
                _ = PlayTabTapAsync(itemLayout);
                await SelectTabAsync(route);
            };
            itemContainer.GestureRecognizers.Add(tap);

            Grid.SetColumn(itemContainer, i);
            navGrid.Children.Add(itemContainer);

            tabButtons[def.Route] = (icon, titleLabel, itemContainer);
        }

        UpdateNavVisuals();

        var rootGrid = new Grid
        {
            RowDefinitions = new RowDefinitionCollection
            {
                new(GridLength.Star),
                new(GridLength.Auto)
            }
        };

        Grid.SetRow(contentArea, 0);
        Grid.SetRow(bottomNavBorder, 1);
        rootGrid.Children.Add(contentArea);
        rootGrid.Children.Add(bottomNavBorder);

        Content = rootGrid;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        UpdateNavVisuals();
        if (pages.TryGetValue(activeRoute, out var page) && page is ITabLifecycle lifecycle)
            await RunLifecycleSafelyAsync(lifecycle.OnTabAppearingAsync);
        _ = RefreshUnreadCountSafelyAsync();
        unreadTimer ??= Dispatcher.CreateTimer();
        unreadTimer.Interval = TimeSpan.FromSeconds(30);
        unreadTimer.Tick -= OnUnreadTimerTick;
        unreadTimer.Tick += OnUnreadTimerTick;
        unreadTimer.Start();
    }

    protected override async void OnDisappearing()
    {
        unreadTimer?.Stop();
        if (pages.TryGetValue(activeRoute, out var page) && page is ITabLifecycle lifecycle)
            await RunLifecycleSafelyAsync(lifecycle.OnTabDisappearingAsync);
        base.OnDisappearing();
    }

    public void SelectTab(string route) => _ = SelectTabAsync(route);

    public async Task OpenClientOrderAsync(string orderId)
    {
        await SelectTabAsync("orders");
        await ordersPage.OpenOrderAsync(orderId);
    }

    public void RefreshTheme() => UpdateNavVisuals();

    public Task RefreshActiveTabAsync()
    {
        if (!pages.TryGetValue(activeRoute, out var page) || page is not ITabLifecycle lifecycle)
            return Task.CompletedTask;
        return RunLifecycleSafelyAsync(lifecycle.OnTabAppearingAsync);
    }

    public async Task SelectTabAsync(string route)
    {
        if (!InteractionMotion.CanStartTabTransition(activeRoute == route, tabViews.ContainsKey(route), isTabAnimating)) return;
        isTabAnimating = true;

        var previousRoute = activeRoute;
        if (pages.TryGetValue(previousRoute, out var previousPage) && previousPage is ITabLifecycle prevLifecycle)
            _ = RunLifecycleSafelyAsync(prevLifecycle.OnTabDisappearingAsync);

        activeRoute = route;
        try
        {
            var currentView = tabViews[previousRoute];
            var nextView = tabViews[route];
            if (previousRoute == "messages" && warmedRoutes.Contains("messages"))
            {
                currentView.Opacity = 0;
                currentView.InputTransparent = true;
                currentView.ZIndex = -1;
            }
            else
            {
                currentView.IsVisible = false;
            }
            nextView.IsVisible = true;
            nextView.Opacity = 1;
            nextView.InputTransparent = false;
            nextView.ZIndex = 1;
            nextView.TranslationX = 0;
            warmedRoutes.Add(route);
            UpdateNavVisuals();
            if (pages.TryGetValue(route, out var page) && page is ITabLifecycle nextLifecycle)
                _ = RunLifecycleSafelyAsync(nextLifecycle.OnTabAppearingAsync);
            await MoveTabHighlightAsync(route);
            highlightedRoute = activeRoute;
            PositionTabHighlight(highlightedRoute);
            isTabAnimating = false;
        }
        finally
        {
            highlightedRoute = activeRoute;
            PositionTabHighlight(highlightedRoute);
            isTabAnimating = false;
        }
    }

    private static int TabIndex(string route) =>
        MobileNavigation.Tabs.Select((tab, index) => (tab.Route, index))
            .FirstOrDefault(item => item.Route == route).index;

    private static async Task PlayTabTapAsync(VisualElement item)
    {
        await item.ScaleToAsync(0.97, 25, Easing.CubicOut);
        await item.ScaleToAsync(1, 35, Easing.CubicOut);
    }

    private static async Task RunLifecycleSafelyAsync(Func<Task> action)
    {
        try { await action(); }
        catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
    }

    private Task MoveTabHighlightAsync(string route)
    {
        if (tabHighlight.Parent is not AbsoluteLayout navHost || navHost.Width <= 0)
            return Task.CompletedTask;

        var width = InteractionMotion.TabHighlightWidth(navHost.Width, MobileNavigation.Tabs.Count, 4);
        AbsoluteLayout.SetLayoutBounds(tabHighlight, new Rect(0, .5, width, 56));
        var offset = InteractionMotion.TabHighlightOffset(TabIndex(route), navHost.Width, MobileNavigation.Tabs.Count, 4);
        return tabHighlight.TranslateToAsync(offset, 0, 90, Easing.CubicOut);
    }

    private void PositionTabHighlight(string route)
    {
        if (tabHighlight.Parent is not AbsoluteLayout navHost || navHost.Width <= 0) return;
        var width = InteractionMotion.TabHighlightWidth(navHost.Width, MobileNavigation.Tabs.Count, 4);
        AbsoluteLayout.SetLayoutBounds(tabHighlight, new Rect(0, .5, width, 56));
        var offset = InteractionMotion.TabHighlightOffset(TabIndex(route), navHost.Width, MobileNavigation.Tabs.Count, 4);
        tabHighlight.TranslationX = offset;
    }

    private async void OnUnreadTimerTick(object? sender, EventArgs e)
    {
        if (activeRoute != "messages" && !messagesPage.IsRealtimeConnected)
            await RefreshUnreadCountSafelyAsync();
    }

    private async Task RefreshUnreadCountSafelyAsync()
    {
        try { await messagesPage.RefreshUnreadCountAsync(); }
        catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
    }

    private void UpdateMessagesBadge(int unreadCount)
    {
        if (messagesBadge is null || messagesBadgeLabel is null) return;
        messagesBadge.IsVisible = UnreadBadgeRules.IsVisible(unreadCount);
        messagesBadgeLabel.Text = UnreadBadgeRules.Label(unreadCount);
        messagesBadge.BackgroundColor = Color.FromArgb(UnreadBadgeRules.Background(unreadCount));
        messagesBadgeLabel.TextColor = Color.FromArgb(UnreadBadgeRules.Foreground(unreadCount));
    }

    private void UpdateNavVisuals()
    {
        var isDark = ((App)Application.Current!).UserAppTheme == AppTheme.Dark;
        var activeColor = isDark ? Color.FromArgb("#D9F36A") : Color.FromArgb("#08543D");
        var inactiveColor = isDark ? Color.FromArgb("#7E8A83") : Color.FromArgb("#8A938E");

        foreach (var (route, (icon, label, _)) in tabButtons)
        {
            var isSelected = route == activeRoute;
            icon.Opacity = isSelected ? 1 : .48;
            icon.Scale = isSelected ? 1.08 : 1;
            label.TextColor = isSelected ? activeColor : inactiveColor;
        }
    }
}
