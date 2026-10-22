using CampusGig.Mobile.Services;
using Microsoft.Maui.Controls.Shapes;

namespace CampusGig.Mobile.Pages;

public sealed class GuestMainPage : ContentPage, IDisposable
{
    private readonly HomePage home;
    private bool disposed;

    public GuestMainPage(HomePage home)
    {
        this.home = home;
        NavigationPage.SetHasNavigationBar(this, false);
        this.SetAppThemeColor(
            BackgroundColorProperty,
            Color.FromArgb("#F3F5F3"),
            Color.FromArgb("#111713"));

        try { home.Parent = this; } catch { }
        var homeView = home.Content;
        home.Content = null;
        homeView.BindingContext = home.BindingContext ?? home;

        var discover = CreateNavigationItem("tab_discover.svg", "Discover", true, "GuestDiscoverTab");
        var signIn = CreateNavigationItem("tab_profile.svg", "Sign in", false, "GuestSignInTab");
        var signInTap = new TapGestureRecognizer();
        signInTap.Tapped += async (_, _) => await ((App)Application.Current!).ShowLoginAsync();
        signIn.GestureRecognizers.Add(signInTap);

        var navigation = new Grid
        {
            ColumnDefinitions =
            [
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Star),
            ],
        };
        navigation.Add(discover);
        navigation.Add(signIn, 1);

        var navigationHost = new Border
        {
            HeightRequest = 72,
            StrokeThickness = 1,
            StrokeShape = new RoundRectangle { CornerRadius = 24 },
            Padding = new Thickness(7),
            Margin = new Thickness(16, 7, 16, 12),
            Content = navigation,
            Shadow = new Shadow
            {
                Brush = Color.FromArgb("#33000000"),
                Offset = new Point(0, 5),
                Radius = 14,
                Opacity = .24f,
            },
        };
        navigationHost.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#F2F7F4"), Color.FromArgb("#E61A241F"));
        navigationHost.SetAppThemeColor(Border.StrokeProperty, Color.FromArgb("#DDE3DF"), Color.FromArgb("#24312A"));

        var root = new Grid
        {
            RowDefinitions =
            [
                new RowDefinition(GridLength.Star),
                new RowDefinition(GridLength.Auto),
            ],
        };
        root.Add(homeView);
        root.Add(navigationHost, row: 1);
        Content = root;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await home.OnTabAppearingAsync();
    }

    protected override async void OnDisappearing()
    {
        await home.OnTabDisappearingAsync();
        base.OnDisappearing();
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        home.Dispose();
    }

    private static Grid CreateNavigationItem(
        string iconSource,
        string title,
        bool selected,
        string automationId)
    {
        var activeColor = Color.FromArgb("#08543D");
        var inactiveColor = Color.FromArgb("#66716B");
        return new Grid
        {
            AutomationId = automationId,
            Children =
            {
                new VerticalStackLayout
                {
                    Padding = new Thickness(4, 6, 4, 3),
                    Spacing = 1,
                    HorizontalOptions = LayoutOptions.Fill,
                    VerticalOptions = LayoutOptions.Fill,
                    Children =
                    {
                        new Image
                        {
                            Source = iconSource,
                            WidthRequest = 24,
                            HeightRequest = 24,
                            Opacity = selected ? 1 : .6,
                            HorizontalOptions = LayoutOptions.Center,
                        },
                        new Label
                        {
                            Text = title,
                            FontSize = 10,
                            FontAttributes = FontAttributes.Bold,
                            TextColor = selected ? activeColor : inactiveColor,
                            HorizontalTextAlignment = TextAlignment.Center,
                        },
                    },
                },
            },
        };
    }
}
