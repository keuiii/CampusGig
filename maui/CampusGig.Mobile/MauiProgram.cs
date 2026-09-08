using Microsoft.Extensions.Logging;

namespace CampusGig.Mobile;

public static class MauiProgram
{
	public static MauiApp CreateMauiApp()
	{
		ConfigurePlatformControls();
		var builder = MauiApp.CreateBuilder();
		builder
			.UseMauiApp<App>()
			.ConfigureFonts(fonts =>
			{
				fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
				fonts.AddFont("OpenSans-Semibold.ttf", "OpenSansSemibold");
			});

		builder.Services.AddSingleton<Services.ISessionStorage, Services.MauiSessionStorage>();
		builder.Services.AddSingleton<Services.SessionService>();
		builder.Services.AddSingleton<Services.CampusGigApi>();
		builder.Services.AddSingleton<Services.RealtimeService>();
#if ANDROID
		builder.Services.AddSingleton<Services.IGoogleIdentityService, Platforms.Android.GoogleIdentityService>();
#else
		builder.Services.AddSingleton<Services.IGoogleIdentityService, Services.UnavailableGoogleIdentityService>();
#endif
		builder.Services.AddTransient<Pages.AuthPage>();
		builder.Services.AddTransient<Pages.SplashPage>();
		builder.Services.AddTransient<Pages.HomePage>();
		builder.Services.AddTransient<Pages.OrdersPage>();
		builder.Services.AddTransient<Pages.MessagesPage>();
		builder.Services.AddTransient<Pages.ProfilePage>();
		builder.Services.AddTransient<Pages.MainTabbedPage>();

#if DEBUG
		builder.Logging.AddDebug();
#endif

		return builder.Build();
	}

	private static void ConfigurePlatformControls()
	{
#if ANDROID
		Microsoft.Maui.Handlers.EntryHandler.Mapper.AppendToMapping("CampusGigBorderless", (handler, _) =>
		{
			handler.PlatformView.BackgroundTintList =
				Android.Content.Res.ColorStateList.ValueOf(Android.Graphics.Color.Transparent);
		});
		Microsoft.Maui.Handlers.EditorHandler.Mapper.AppendToMapping("CampusGigBorderless", (handler, _) =>
		{
			handler.PlatformView.BackgroundTintList =
				Android.Content.Res.ColorStateList.ValueOf(Android.Graphics.Color.Transparent);
		});
		Microsoft.Maui.Handlers.PickerHandler.Mapper.AppendToMapping("CampusGigBorderless", (handler, _) =>
		{
			handler.PlatformView.BackgroundTintList =
				Android.Content.Res.ColorStateList.ValueOf(Android.Graphics.Color.Transparent);
		});
#endif
	}
}
