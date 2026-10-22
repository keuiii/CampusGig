namespace CampusGig.Mobile.Controls;

public sealed class SkeletonBlock : Border
{
    private CancellationTokenSource? animationCancellation;

    public SkeletonBlock()
    {
        StrokeThickness = 0;
        InputTransparent = true;
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#E5EBE7"), Color.FromArgb("#2A3731"));
        AutomationProperties.SetIsInAccessibleTree(this, false);
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    private async void OnLoaded(object? sender, EventArgs args)
    {
        if (!AnimationsEnabled()) return;

        animationCancellation?.Cancel();
        animationCancellation = new CancellationTokenSource();
        var cancellationToken = animationCancellation.Token;
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                await this.FadeToAsync(0.55, 700, Easing.SinInOut);
                await this.FadeToAsync(1, 700, Easing.SinInOut);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void OnUnloaded(object? sender, EventArgs args)
    {
        animationCancellation?.Cancel();
        animationCancellation?.Dispose();
        animationCancellation = null;
        Opacity = 1;
    }

    private static bool AnimationsEnabled()
    {
#if ANDROID
        return Android.Provider.Settings.Global.GetFloat(
            Android.App.Application.Context.ContentResolver,
            Android.Provider.Settings.Global.AnimatorDurationScale,
            1f) > 0f;
#elif IOS || MACCATALYST
        return !UIKit.UIAccessibility.IsReduceMotionEnabled;
#elif WINDOWS
        return new Windows.UI.ViewManagement.UISettings().AnimationsEnabled;
#else
        return true;
#endif
    }
}
