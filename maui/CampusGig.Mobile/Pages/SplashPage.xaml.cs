namespace CampusGig.Mobile.Pages;

public partial class SplashPage : ContentPage
{
    private CancellationTokenSource? animationCancellation;

    public SplashPage()
    {
        InitializeComponent();
        NavigationPage.SetHasNavigationBar(this, false);
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        animationCancellation?.Cancel();
        animationCancellation?.Dispose();
        animationCancellation = new CancellationTokenSource();

        await Task.WhenAll(
            BrandGroup.FadeToAsync(1, 420, Easing.CubicOut),
            BrandGroup.TranslateToAsync(0, 0, 480, Easing.CubicOut));
        await Task.WhenAll(
            PromiseGroup.FadeToAsync(1, 320, Easing.CubicOut),
            LoadingGroup.FadeToAsync(1, 320, Easing.CubicOut));
        _ = RotateLoadingRingAsync(animationCancellation.Token);
    }

    protected override void OnDisappearing()
    {
        animationCancellation?.Cancel();
        animationCancellation?.Dispose();
        animationCancellation = null;
        base.OnDisappearing();
    }

    private async Task RotateLoadingRingAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await LoadingRing.RotateToAsync(360, 850, Easing.Linear);
                LoadingRing.Rotation = 0;
            }
        }
        catch (OperationCanceledException)
        {
        }
    }
}
