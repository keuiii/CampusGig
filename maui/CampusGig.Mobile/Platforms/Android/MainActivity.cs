using Android.App;
using Android.Content.PM;
using Android.OS;
using Android.Views;

namespace CampusGig.Mobile;

[Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true, LaunchMode = LaunchMode.SingleTop, ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
public class MainActivity : MauiAppCompatActivity
{
    protected override void OnPostCreate(Bundle? savedInstanceState)
    {
        base.OnPostCreate(savedInstanceState);
        ApplyNeutralSystemBars();
    }

    protected override void OnResume()
    {
        base.OnResume();
        ApplyNeutralSystemBars();
    }

    private void ApplyNeutralSystemBars()
    {
        if (Window is null) return;
        AndroidX.Core.View.WindowCompat.SetDecorFitsSystemWindows(Window, true);
#pragma warning disable CA1422
        Window.AddFlags(WindowManagerFlags.DrawsSystemBarBackgrounds);
        Window.ClearFlags(WindowManagerFlags.TranslucentStatus | WindowManagerFlags.TranslucentNavigation);
        Window.SetStatusBarColor(Android.Graphics.Color.ParseColor("#F4F8F5"));
        Window.SetNavigationBarColor(Android.Graphics.Color.ParseColor("#FFFFFF"));
#pragma warning restore CA1422
        var controller = AndroidX.Core.View.WindowCompat.GetInsetsController(Window, Window.DecorView);
        if (controller is not null)
        {
            controller.AppearanceLightStatusBars = true;
            controller.AppearanceLightNavigationBars = true;
        }
    }
}
