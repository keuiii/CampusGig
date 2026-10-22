using Android.App;
using Android.Content;
using Android.Content.PM;
using Android.OS;
using Android.Views;
using Android.Views.InputMethods;
using Android.Widget;

namespace CampusGig.Mobile;

[Activity(Theme = "@style/Maui.SplashTheme", MainLauncher = true, LaunchMode = LaunchMode.SingleTask, WindowSoftInputMode = SoftInput.AdjustResize, ConfigurationChanges = ConfigChanges.ScreenSize | ConfigChanges.Orientation | ConfigChanges.UiMode | ConfigChanges.ScreenLayout | ConfigChanges.SmallestScreenSize | ConfigChanges.Density)]
[IntentFilter(
    [Intent.ActionView],
    Categories = [Intent.CategoryDefault, Intent.CategoryBrowsable],
    DataScheme = "campusgig",
    DataHost = "payment-return")]
public class MainActivity : MauiAppCompatActivity
{
    public override bool DispatchTouchEvent(MotionEvent? touchEvent)
    {
        if (touchEvent?.Action == MotionEventActions.Down && CurrentFocus is EditText focusedInput)
        {
            var inputBounds = new Android.Graphics.Rect();
            focusedInput.GetGlobalVisibleRect(inputBounds);
            var tappedInsideInput = inputBounds.Contains(
                (int)touchEvent.RawX,
                (int)touchEvent.RawY);
            if (!tappedInsideInput)
            {
                focusedInput.ClearFocus();
                var keyboard = GetSystemService(InputMethodService) as InputMethodManager;
                keyboard?.HideSoftInputFromWindow(
                    focusedInput.WindowToken,
                    HideSoftInputFlags.None);
            }
        }

        return base.DispatchTouchEvent(touchEvent);
    }

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
