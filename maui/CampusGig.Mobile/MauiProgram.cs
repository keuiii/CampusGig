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
		builder.Services.AddTransient<ViewModels.ProfileViewModel>();
#if ANDROID
		builder.Services.AddSingleton<Services.IGoogleIdentityService, Platforms.Android.GoogleIdentityService>();
#else
		builder.Services.AddSingleton<Services.IGoogleIdentityService, Services.UnavailableGoogleIdentityService>();
#endif
		builder.Services.AddTransient<Pages.AuthPage>();
		builder.Services.AddTransient<Pages.SplashPage>();
		builder.Services.AddTransient<Pages.OnboardingPage>();
		builder.Services.AddTransient<Pages.HomePage>();
		builder.Services.AddTransient<Pages.OrdersPage>();
		builder.Services.AddTransient<Pages.MessagesPage>();
		builder.Services.AddTransient<Pages.ProfilePage>();
		builder.Services.AddTransient<Pages.MainTabbedPage>();
		builder.Services.AddTransient<Pages.GuestMainPage>();

#if DEBUG
		builder.Logging.AddDebug();
#endif

		return builder.Build();
	}

	private static void ConfigurePlatformControls()
	{
		Microsoft.Maui.Handlers.EntryHandler.Mapper.AppendToMapping("CampusGigKeyboardDismissal", (_, entry) =>
		{
			if (entry is not Entry input) return;
			input.Completed -= OnInputCompleted;
			input.Completed += OnInputCompleted;
		});
		Microsoft.Maui.Handlers.EditorHandler.Mapper.AppendToMapping("CampusGigKeyboardDismissal", (_, editor) =>
		{
			if (editor is not Editor input) return;
			input.Completed -= OnInputCompleted;
			input.Completed += OnInputCompleted;
		});
		Microsoft.Maui.Handlers.SearchBarHandler.Mapper.AppendToMapping("CampusGigKeyboardDismissal", (_, searchBar) =>
		{
			if (searchBar is not SearchBar input) return;
			input.SearchButtonPressed -= OnSearchCompleted;
			input.SearchButtonPressed += OnSearchCompleted;
		});
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

	private static void OnInputCompleted(object? sender, EventArgs eventArgs)
	{
		if (sender is Entry { ReturnType: ReturnType.Next } entry && FocusNextTextInput(entry))
			return;
		if (sender is VisualElement input) input.Unfocus();
	}

	private static bool FocusNextTextInput(Entry current)
	{
		Element root = current;
		while (root is not ContentPage && root.Parent is Element parent)
			root = parent;

		var inputs = root.GetVisualTreeDescendants()
			.OfType<VisualElement>()
			.Where(element => IsAvailableTextInput(element, root))
			.ToList();
		var currentIndex = inputs.IndexOf(current);
		for (var index = currentIndex + 1; index < inputs.Count; index++)
			if (inputs[index].Focus()) return true;
		return false;
	}

	private static bool IsAvailableTextInput(VisualElement element, Element root)
	{
		if (element is not (Entry or Editor) ||
			!element.IsVisible || !element.IsEnabled || element.InputTransparent)
			return false;
		if (element is Entry { IsReadOnly: true } or Editor { IsReadOnly: true })
			return false;

		for (var parent = element.Parent; parent is not null && parent != root; parent = parent.Parent)
			if (parent is VisualElement { IsVisible: false } or VisualElement { IsEnabled: false })
				return false;
		return true;
	}

	private static void OnSearchCompleted(object? sender, EventArgs eventArgs)
	{
		if (sender is VisualElement searchBar) searchBar.Unfocus();
	}
}
