using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using Microsoft.Maui.Controls.Shapes;
using Microsoft.Maui.Layouts;

namespace CampusGig.Mobile.Pages;

public sealed class MainTabbedPage : ContentPage
{
    public static MainTabbedPage? Instance { get; private set; }

    public static void ClearInstance() => Instance = null;

    private readonly Dictionary<string, View> tabViews = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (Label Icon, Label Label, Border Pip, VisualElement Item)> tabButtons = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ContentPage> pages = new(StringComparer.Ordinal);
    private readonly Grid contentArea;
    private readonly MessagesPage messagesPage;
    private readonly Border tabHighlight;
    private Border? messagesBadge;
    private Label? messagesBadgeLabel;
    private IDispatcherTimer? unreadTimer;
    private string activeRoute = "discover";
    private string highlightedRoute = "discover";
    private bool isTabAnimating;

    public MainTabbedPage(
        HomePage home,
        OrdersPage orders,
        MessagesPage messages,
        ProfilePage profile)
    {
        Instance = this;
        messagesPage = messages;
        messagesPage.UnreadCountChanged += UpdateMessagesBadge;
        NavigationPage.SetHasNavigationBar(this, false);
        this.SetAppThemeColor(ContentPage.BackgroundColorProperty, Color.FromArgb("#FFFFFF"), Color.FromArgb("#111713"));

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
            view.IsVisible = route == "discover";
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
            WidthRequest = 20,
            HeightRequest = 3,
            StrokeThickness = 0,
            StrokeShape = new RoundRectangle { CornerRadius = 1.5 },
            HorizontalOptions = LayoutOptions.Start,
            VerticalOptions = LayoutOptions.End,
            InputTransparent = true,
            ZIndex = 0,
            BackgroundColor = Color.FromArgb("#D9F36A"),
        };
        AbsoluteLayout.SetLayoutBounds(tabHighlight, new Rect(0, 1, 20, 3));
        AbsoluteLayout.SetLayoutFlags(tabHighlight, AbsoluteLayoutFlags.YProportional);
        navHost.Children.Add(tabHighlight);
        navHost.Children.Add(navGrid);
        navHost.SizeChanged += (_, _) =>
        {
            if (!isTabAnimating) PositionTabHighlight(highlightedRoute);
        };

        var bottomNavBorder = new Border
        {
            HeightRequest = 77,
            StrokeThickness = 0,
            Padding = new Thickness(7, 4, 7, 5),
            HorizontalOptions = LayoutOptions.Fill,
            VerticalOptions = LayoutOptions.End,
            Content = navHost
        };
        bottomNavBorder.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#FFFFFF"), Color.FromArgb("#151D19"));
        bottomNavBorder.SetAppThemeColor(Border.StrokeProperty, Color.FromArgb("#E4E8E5"), Color.FromArgb("#24312A"));
        // Top border via BoxView inside the grid
        var topDivider = new BoxView { HeightRequest = 1, HorizontalOptions = LayoutOptions.Fill, VerticalOptions = LayoutOptions.Start };
        topDivider.SetAppThemeColor(BoxView.ColorProperty, Color.FromArgb("#E4E8E5"), Color.FromArgb("#24312A"));

        for (int i = 0; i < MobileNavigation.Tabs.Count; i++)
        {
            var def = MobileNavigation.Tabs[i];
            var itemLayout = new VerticalStackLayout
            {
                HorizontalOptions = LayoutOptions.Fill,
                VerticalOptions = LayoutOptions.Fill,
                Padding = new Thickness(4, 6, 4, 3),
                Spacing = 0,
            };

            var iconLabel = new Label
            {
                Text = def.Icon,
                FontSize = 20,
                FontAttributes = FontAttributes.Bold,
                HorizontalTextAlignment = TextAlignment.Center,
                VerticalTextAlignment = TextAlignment.Center,
            };

            var titleLabel = new Label
            {
                Text = def.Title,
                FontSize = 9,
                FontAttributes = FontAttributes.Bold,
                Margin = new Thickness(0, 4, 0, 0),
                HorizontalTextAlignment = TextAlignment.Center,
            };

            var pip = new Border
            {
                WidthRequest = 18,
                HeightRequest = 3,
                StrokeThickness = 0,
                StrokeShape = new RoundRectangle { CornerRadius = 1.5 },
                BackgroundColor = Color.FromArgb("#D9F36A"),
                Margin = new Thickness(0, 2, 0, 0),
                HorizontalOptions = LayoutOptions.Center,
                IsVisible = def.Route == "discover"
            };

            itemLayout.Children.Add(iconLabel);
            itemLayout.Children.Add(titleLabel);

            var route = def.Route;
            var itemContainer = new Grid();
            itemContainer.ZIndex = 1;
            itemContainer.Children.Add(itemLayout);
            if (route == "messages")
            {
                messagesBadgeLabel = new Label
                {
                    FontSize = 8,
                    FontAttributes = FontAttributes.Bold,
                    TextColor = Colors.White,
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
                    BackgroundColor = Color.FromArgb("#D95045"),
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
                await itemLayout.ScaleToAsync(0.92, 60, Easing.CubicOut);
                await itemLayout.ScaleToAsync(1.0, 70, Easing.CubicIn);
                await SelectTabAsync(route);
            };
            itemContainer.GestureRecognizers.Add(tap);

            Grid.SetColumn(itemContainer, i);
            navGrid.Children.Add(itemContainer);

            tabButtons[def.Route] = (iconLabel, titleLabel, pip, itemContainer);
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
            await lifecycle.OnTabAppearingAsync();
        _ = RefreshUnreadCountSafelyAsync();
        unreadTimer ??= Dispatcher.CreateTimer();
        unreadTimer.Interval = TimeSpan.FromSeconds(8);
        unreadTimer.Tick -= OnUnreadTimerTick;
        unreadTimer.Tick += OnUnreadTimerTick;
        unreadTimer.Start();
    }

    protected override async void OnDisappearing()
    {
        unreadTimer?.Stop();
        if (pages.TryGetValue(activeRoute, out var page) && page is ITabLifecycle lifecycle)
            await lifecycle.OnTabDisappearingAsync();
        base.OnDisappearing();
    }

    public void SelectTab(string route) => _ = SelectTabAsync(route);

    public void RefreshTheme() => UpdateNavVisuals();

    public async Task SelectTabAsync(string route)
    {
        if (!InteractionMotion.CanStartTabTransition(activeRoute == route, tabViews.ContainsKey(route), isTabAnimating)) return;
        isTabAnimating = true;

        var previousRoute = activeRoute;
        var movingForward = InteractionMotion.IsForwardTabTransition(TabIndex(previousRoute), TabIndex(route));

        if (pages.TryGetValue(previousRoute, out var previousPage) && previousPage is ITabLifecycle prevLifecycle)
        {
            try { await prevLifecycle.OnTabDisappearingAsync(); } catch { }
        }

        activeRoute = route;
        try
        {
            var currentView = tabViews[previousRoute];
            var nextView = tabViews[route];
            currentView.ZIndex = 1;
            nextView.ZIndex = 2;
            nextView.IsVisible = true;
            nextView.Opacity = 0;
            nextView.TranslationX = InteractionMotion.TabEntryOffset(movingForward);
            UpdateNavVisuals();

            await Task.WhenAll(
                currentView.FadeToAsync(0, 170, Easing.CubicInOut),
                currentView.TranslateToAsync(InteractionMotion.TabExitOffset(movingForward), 0, 190, Easing.CubicInOut),
                nextView.FadeToAsync(1, 190, Easing.CubicOut),
                nextView.TranslateToAsync(0, 0, 210, Easing.CubicOut),
                MoveTabHighlightAsync(route)
            );

            currentView.IsVisible = false;
            currentView.Opacity = 1;
            currentView.TranslationX = 0;
            currentView.ZIndex = 0;
            nextView.ZIndex = 0;

            if (pages.TryGetValue(route, out var page) && page is ITabLifecycle nextLifecycle)
            {
                try { await nextLifecycle.OnTabAppearingAsync(); } catch { }
            }
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

    private Task MoveTabHighlightAsync(string route)
    {
        if (tabHighlight.Parent is not AbsoluteLayout navHost || navHost.Width <= 0)
            return Task.CompletedTask;

        const double width = 20;
        AbsoluteLayout.SetLayoutBounds(tabHighlight, new Rect(0, 1, width, 3));
        var offset = InteractionMotion.TabUnderlineOffset(TabIndex(route), navHost.Width, MobileNavigation.Tabs.Count, width);
        return tabHighlight.TranslateToAsync(offset, 0, 220, Easing.CubicInOut);
    }

    private void PositionTabHighlight(string route)
    {
        if (tabHighlight.Parent is not AbsoluteLayout navHost || navHost.Width <= 0) return;
        const double width = 20;
        AbsoluteLayout.SetLayoutBounds(tabHighlight, new Rect(0, 1, width, 3));
        var offset = InteractionMotion.TabUnderlineOffset(TabIndex(route), navHost.Width, MobileNavigation.Tabs.Count, width);
        tabHighlight.TranslationX = offset;
    }

    private async void OnUnreadTimerTick(object? sender, EventArgs e)
    {
        if (activeRoute != "messages")
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
    }

    private void UpdateNavVisuals()
    {
        var isDark = ((App)Application.Current!).UserAppTheme == AppTheme.Dark;
        var activeColor = isDark ? Color.FromArgb("#D9F36A") : Color.FromArgb("#08543D");
        var inactiveColor = isDark ? Color.FromArgb("#7E8A83") : Color.FromArgb("#8A938E");

        foreach (var (route, (icon, label, pip, _)) in tabButtons)
        {
            var isSelected = route == activeRoute;
            icon.TextColor = isSelected ? activeColor : inactiveColor;
            label.TextColor = isSelected ? activeColor : inactiveColor;
            pip.IsVisible = false;
        }
    }
}
