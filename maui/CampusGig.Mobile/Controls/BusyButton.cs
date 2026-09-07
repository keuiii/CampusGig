using Microsoft.Maui.Controls.Shapes;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Controls;

public sealed class BusyButton : ContentView
{
    public static readonly BindableProperty TextProperty = BindableProperty.Create(
        nameof(Text), typeof(string), typeof(BusyButton), string.Empty, propertyChanged: OnVisualPropertyChanged);

    public static readonly BindableProperty BusyTextProperty = BindableProperty.Create(
        nameof(BusyText), typeof(string), typeof(BusyButton), "Working", propertyChanged: OnVisualPropertyChanged);

    public static readonly BindableProperty FillColorProperty = BindableProperty.Create(
        nameof(FillColor), typeof(Color), typeof(BusyButton), Color.FromArgb("#08543D"), propertyChanged: OnVisualPropertyChanged);

    public static readonly BindableProperty TextColorProperty = BindableProperty.Create(
        nameof(TextColor), typeof(Color), typeof(BusyButton), Colors.White, propertyChanged: OnVisualPropertyChanged);

    public static readonly BindableProperty CornerRadiusProperty = BindableProperty.Create(
        nameof(CornerRadius), typeof(double), typeof(BusyButton), 14d, propertyChanged: OnVisualPropertyChanged);

    public static readonly BindableProperty IsBusyProperty = BindableProperty.Create(
        nameof(IsBusy), typeof(bool), typeof(BusyButton), false, propertyChanged: OnVisualPropertyChanged);

    private readonly Border surface;
    private readonly Label label;
    private readonly ActivityIndicator indicator;
    private readonly Button input;

    public BusyButton()
    {
        MinimumHeightRequest = UiInteractionRules.MinimumTouchTarget;
        MinimumWidthRequest = UiInteractionRules.MinimumTouchTarget;
        HorizontalOptions = LayoutOptions.Center;

        label = new Label
        {
            FontAttributes = FontAttributes.Bold,
            FontSize = 14,
            HorizontalTextAlignment = TextAlignment.Center,
            VerticalTextAlignment = TextAlignment.Center,
            InputTransparent = true,
        };
        indicator = new ActivityIndicator
        {
            WidthRequest = 22,
            HeightRequest = 22,
            HorizontalOptions = LayoutOptions.Center,
            VerticalOptions = LayoutOptions.Center,
            InputTransparent = true,
        };
        input = new Button
        {
            BackgroundColor = Colors.Transparent,
            BorderWidth = 0,
            Padding = 0,
            HorizontalOptions = LayoutOptions.Fill,
            VerticalOptions = LayoutOptions.Fill,
        };
        input.Clicked += (_, args) =>
        {
            if (UiInteractionRules.CanInvoke(IsEnabled, IsBusy)) Clicked?.Invoke(this, args);
        };
        input.Pressed += async (_, _) => await AnimateScaleAsync(0.975, 55);
        input.Released += async (_, _) => await AnimateScaleAsync(1, 100);

        surface = new Border
        {
            StrokeThickness = 0,
            Content = new Grid { Children = { label, indicator, input } },
        };
        Content = surface;
        UpdateVisuals();
    }

    public event EventHandler? Clicked;

    public string Text { get => (string)GetValue(TextProperty); set => SetValue(TextProperty, value); }
    public string BusyText { get => (string)GetValue(BusyTextProperty); set => SetValue(BusyTextProperty, value); }
    public Color FillColor { get => (Color)GetValue(FillColorProperty); set => SetValue(FillColorProperty, value); }
    public Color TextColor { get => (Color)GetValue(TextColorProperty); set => SetValue(TextColorProperty, value); }
    public double CornerRadius { get => (double)GetValue(CornerRadiusProperty); set => SetValue(CornerRadiusProperty, value); }
    public bool IsBusy { get => (bool)GetValue(IsBusyProperty); set => SetValue(IsBusyProperty, value); }

    protected override void OnPropertyChanged(string? propertyName = null)
    {
        base.OnPropertyChanged(propertyName);
        if (propertyName == IsEnabledProperty.PropertyName && input is not null) UpdateVisuals();
    }

    private static void OnVisualPropertyChanged(BindableObject bindable, object oldValue, object newValue) =>
        ((BusyButton)bindable).UpdateVisuals();

    private async Task AnimateScaleAsync(double scale, uint duration) =>
        await surface.ScaleToAsync(scale, duration, Easing.CubicOut);

    private void UpdateVisuals()
    {
        if (surface is null) return;
        surface.BackgroundColor = FillColor;
        surface.StrokeShape = new RoundRectangle { CornerRadius = CornerRadius };
        surface.Opacity = 1;
        Opacity = IsEnabled ? 1 : 0.45;
        label.Text = IsBusy ? BusyText : Text;
        label.TextColor = TextColor;
        label.IsVisible = !IsBusy;
        indicator.Color = TextColor;
        indicator.IsVisible = IsBusy;
        indicator.IsRunning = IsBusy;
        input.IsEnabled = UiInteractionRules.CanInvoke(IsEnabled, IsBusy);
        SemanticProperties.SetDescription(input, IsBusy ? BusyText : Text);
    }
}
