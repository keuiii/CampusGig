namespace CampusGig.Mobile.Controls;

using Microsoft.Maui.Controls.Shapes;

public enum SkeletonCardKind
{
    Service,
    Conversation,
    Order,
    Profile,
    Listing,
    Review,
    AdminQueue,
}

public sealed class SkeletonCard : ContentView
{
    public static readonly BindableProperty KindProperty = BindableProperty.Create(
        nameof(Kind), typeof(SkeletonCardKind), typeof(SkeletonCard), SkeletonCardKind.Conversation,
        propertyChanged: static (bindable, _, _) => ((SkeletonCard)bindable).Build());

    public SkeletonCard()
    {
        InputTransparent = true;
        AutomationProperties.SetIsInAccessibleTree(this, false);
        Build();
    }

    public SkeletonCardKind Kind
    {
        get => (SkeletonCardKind)GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }

    private void Build()
    {
        Content = Kind switch
        {
            SkeletonCardKind.Service => CreateServiceCard(),
            SkeletonCardKind.Order => CreateRowCard(150, true),
            SkeletonCardKind.Profile => CreateProfileCard(),
            SkeletonCardKind.Listing => CreateRowCard(126, false),
            SkeletonCardKind.Review => CreateRowCard(112, true),
            SkeletonCardKind.AdminQueue => CreateRowCard(138, false),
            _ => CreateRowCard(78, true),
        };
    }

    private static View CreateServiceCard()
    {
        var stack = new VerticalStackLayout { Spacing = 12 };
        stack.Children.Add(Block(260, 150, 0));
        stack.Children.Add(Block(104, 12));
        stack.Children.Add(Block(210, 18));
        stack.Children.Add(Block(170, 11));
        return Card(stack, 0, 18);
    }

    private static View CreateProfileCard()
    {
        var stack = new VerticalStackLayout
        {
            Spacing = 12,
            HorizontalOptions = LayoutOptions.Fill,
        };
        stack.Children.Add(Block(82, 82, 41, LayoutOptions.Center));
        stack.Children.Add(Block(190, 20, 8, LayoutOptions.Center));
        stack.Children.Add(Block(142, 12, 6, LayoutOptions.Center));
        stack.Children.Add(Block(230, 12, 6, LayoutOptions.Center));
        return Card(stack, 22, 20);
    }

    private static View CreateRowCard(double height, bool withAvatar)
    {
        var grid = new Grid
        {
            ColumnDefinitions =
            {
                new ColumnDefinition(withAvatar ? 52 : 0),
                new ColumnDefinition(GridLength.Star),
            },
            ColumnSpacing = withAvatar ? 12 : 0,
        };
        if (withAvatar) grid.Add(Block(46, 46, 15), 0);
        var lines = new VerticalStackLayout { Spacing = 9, VerticalOptions = LayoutOptions.Center };
        lines.Children.Add(Block(150, 14));
        lines.Children.Add(Block(220, 10));
        lines.Children.Add(Block(112, 10));
        grid.Add(lines, 1);
        return Card(grid, 16, 18, height);
    }

    private static Border Card(View content, double padding, double radius, double minimumHeight = -1)
    {
        var card = new Border
        {
            Padding = padding,
            StrokeShape = new RoundRectangle { CornerRadius = radius },
            StrokeThickness = 1,
            Content = content,
            MinimumHeightRequest = minimumHeight,
        };
        card.SetAppThemeColor(Border.StrokeProperty, Color.FromArgb("#DDE4DF"), Color.FromArgb("#34423A"));
        card.SetAppThemeColor(BackgroundColorProperty, Colors.White, Color.FromArgb("#1C2520"));
        return card;
    }

    private static SkeletonBlock Block(
        double width,
        double height,
        double radius = 7,
        LayoutOptions? horizontalOptions = null) => new()
        {
            WidthRequest = width,
            HeightRequest = height,
            StrokeShape = new RoundRectangle { CornerRadius = radius },
            HorizontalOptions = horizontalOptions ?? LayoutOptions.Start,
        };
}
