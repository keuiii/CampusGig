using CampusGig.Mobile.Pages;
using CampusGig.Mobile.Services;
using Microsoft.Extensions.DependencyInjection;

namespace CampusGig.Mobile;

public partial class App : Application
{
	private const string PendingPaymentOrderKey = "campusgig_pending_payment_order";
	private const string PendingRevisionPaymentOrderKey = "campusgig_pending_revision_payment_order";
	public static event Func<Task>? AppResumed;
	private readonly IServiceProvider services;
	private bool changingSession;
	private GuestMainPage? guestMain;

	public App(IServiceProvider services)
	{
		InitializeComponent();
		this.services = services;
		UserAppTheme = Preferences.Default.Get("campusgig_dark_mode", false)
			? AppTheme.Dark
			: AppTheme.Light;
		CampusGigApi.UnauthorizedReceived += async () => await ShowLoginAsync();
	}

	protected override Window CreateWindow(IActivationState? activationState)
	{
		var onboardingCompleted = Preferences.Default.Get(
			OnboardingPresentationRules.CompletionPreferenceKey,
			false);
		Page initialPage = StartupPresentationRules.ShouldPlayOnColdLaunch(onboardingCompleted)
			? services.GetRequiredService<SplashPage>()
			: services.GetRequiredService<OnboardingPage>();
		var window = new Window(initialPage);
		window.Created += async (_, _) => await InitializeAsync();
		window.Stopped += async (_, _) => await SuspendRealtimeSafelyAsync();
		window.Resumed += async (_, _) => await ResumeAsync();
		return window;
	}

	protected override void OnAppLinkRequestReceived(Uri uri)
	{
		base.OnAppLinkRequestReceived(uri);
		var paymentReturn = PaymentReturnRules.ParseAppLink(uri);
		if (paymentReturn is null) return;
		var pendingKey = paymentReturn.RevisionPurchaseId is null
			? PendingPaymentOrderKey
			: PendingRevisionPaymentOrderKey;
		if (paymentReturn.Status == "success")
			Preferences.Default.Set(pendingKey, paymentReturn.OrderId);
		else
			Preferences.Default.Remove(pendingKey);
	}

	private async Task InitializeAsync()
	{
		var splash = Windows.FirstOrDefault()?.Page as SplashPage;
		var splashAnimation = splash is null
			? Task.CompletedTask
			: Task.WhenAll(
				Task.Delay(StartupPresentationRules.MinimumSplashDuration),
				splash.PlayAsync());
		bool authenticated;
		try
		{
			authenticated = await TryRestoreSessionAsync();
		}
		catch (Exception exception)
		{
			System.Diagnostics.Debug.WriteLine($"Startup session restoration failed: {exception.Message}");
			authenticated = false;
		}
		await splashAnimation;
		if (splash is not null)
			await splash.CompleteAsync();
		if (authenticated)
			ShowMain();
		else if (Preferences.Default.Get(GuestAccessRules.GuestModePreferenceKey, false))
			ShowGuest();
		else
			ShowOnboardingOrAuth();
	}

	private async Task<bool> TryRestoreSessionAsync()
	{
		var session = services.GetRequiredService<SessionService>();
		var api = services.GetRequiredService<CampusGigApi>();
		if (!await session.RestoreAsync()) return false;
		var sessionGeneration = session.Generation;

		try
		{
			var user = await api.GetAsync<Models.AuthUser>("auth/me");
			return await session.UpdateUserAsync(user, sessionGeneration);
		}
		catch (CampusGigApiException exception) when (exception.IsUnauthorized)
		{
			await session.ClearAccessSessionAsync();
			return false;
		}
		catch (HttpRequestException)
		{
			return session.User is not null;
		}
		catch (TaskCanceledException)
		{
			return session.User is not null;
		}
		catch (CampusGigApiException)
		{
			return session.User is not null;
		}
	}

	private async Task ResumeAsync()
	{
		try
		{
			await ConnectRealtimeSafelyAsync();
			if (AppResumed is not null) await AppResumed.Invoke();
			if (MainTabbedPage.Instance is not null)
				await MainTabbedPage.Instance.RefreshActiveTabAsync();
		}
		catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
	}

	private void ShowAuth()
	{
		Preferences.Default.Remove("campusgig_pending_payment_order");
		Preferences.Default.Remove(PendingRevisionPaymentOrderKey);
		ClearGuestMain();
		var window = Windows.FirstOrDefault();
		if (window is not null)
			window.Page = services.GetRequiredService<AuthPage>();
	}

	private void ShowOnboardingOrAuth()
	{
		var completed = Preferences.Default.Get(
			OnboardingPresentationRules.CompletionPreferenceKey,
			false);
		if (!OnboardingPresentationRules.ShouldShow(authenticated: false, completed))
		{
			ShowAuth();
			return;
		}

		Preferences.Default.Remove(PendingPaymentOrderKey);
		Preferences.Default.Remove(PendingRevisionPaymentOrderKey);
		var window = Windows.FirstOrDefault();
		if (window is not null && window.Page is not OnboardingPage)
			window.Page = services.GetRequiredService<OnboardingPage>();
	}

	public async Task CompleteOnboardingAsync(OnboardingPage page, bool showBrandTransition)
	{
		if (changingSession) return;
		changingSession = true;
		try
		{
			Preferences.Default.Set(OnboardingPresentationRules.CompletionPreferenceKey, true);
			await page.CompleteAsync();
			var window = Windows.FirstOrDefault();
			if (window is null) return;

			if (showBrandTransition)
			{
				var splash = services.GetRequiredService<SplashPage>();
				window.Page = splash;
				await Task.WhenAll(
					Task.Delay(StartupPresentationRules.MinimumSplashDuration),
					splash.PlayAsync());
				await splash.CompleteAsync();
			}

			window.Page = services.GetRequiredService<AuthPage>();
		}
		finally
		{
			changingSession = false;
		}
	}

	public void ShowMain()
	{
		var window = Windows.FirstOrDefault();
		if (window is null) return;

		try
		{
			Preferences.Default.Set(GuestAccessRules.GuestModePreferenceKey, false);
		}
		catch (Exception exception)
		{
			// Some Android devices can temporarily reject a SharedPreferences
			// write after secure-storage activity. Authentication must still be
			// allowed to enter the in-memory session for this app run.
			System.Diagnostics.Debug.WriteLine(
				$"Guest-mode preference could not be cleared: {exception}");
		}
		ClearGuestMain();
		MainTabbedPage.ClearInstance();
		var main = services.GetRequiredService<MainTabbedPage>();
		window.Page = main;
		_ = ConnectRealtimeSafelyAsync();
		_ = RestorePendingPaymentAsync(main);
		_ = RestorePendingAuthIntentAsync(main);
	}

	public async Task EnterGuestModeAsync()
	{
		if (changingSession) return;
		changingSession = true;
		try
		{
			ClearPendingAuthIntent();
			Preferences.Default.Set(GuestAccessRules.GuestModePreferenceKey, true);
			await services.GetRequiredService<RealtimeService>().DisconnectAsync();
			await services.GetRequiredService<SessionService>().ClearAccessSessionAsync();
			MainTabbedPage.ClearInstance();
			await MainThread.InvokeOnMainThreadAsync(ShowGuest);
		}
		finally
		{
			changingSession = false;
		}
	}

	public async Task<bool> RequireAuthenticationAsync(
		Page owner,
		GuestProtectedAction action,
		string? serviceId = null,
		string? packageId = null,
		string? providerId = null)
	{
		if (!GuestAccessRules.RequiresAuthentication(
				action,
				services.GetRequiredService<SessionService>().User is not null))
			return true;

		var continueToAuth = await AppDialog.ConfirmAsync(
			owner,
			"Continue with CampusGig",
			GuestAccessRules.PromptMessage(action),
			"Log in or sign up",
			"Keep browsing");
		if (!continueToAuth) return false;

		ClearPendingAuthIntent();
		var intent = action switch
		{
			GuestProtectedAction.SendServiceRequest =>
				GuestAccessRules.CreateServiceRequestIntent(serviceId, packageId),
			GuestProtectedAction.MessageProvider =>
				GuestAccessRules.CreateProviderInquiryIntent(providerId),
			_ => null,
		};
		if (intent is not null) SavePendingAuthIntent(intent);
		await ShowLoginAsync();
		return false;
	}

	private void ShowGuest()
	{
		var window = Windows.FirstOrDefault();
		if (window is null) return;
		ClearGuestMain();
		MainTabbedPage.ClearInstance();
		guestMain = services.GetRequiredService<GuestMainPage>();
		window.Page = guestMain;
	}

	private void ClearGuestMain()
	{
		guestMain?.Dispose();
		guestMain = null;
	}

	private static async Task RestorePendingPaymentAsync(MainTabbedPage main)
	{
		var orderId = Preferences.Default.Get(PendingPaymentOrderKey, "");
		if (string.IsNullOrWhiteSpace(orderId))
			orderId = Preferences.Default.Get(PendingRevisionPaymentOrderKey, "");
		if (string.IsNullOrWhiteSpace(orderId)) return;
		await Task.Delay(250);
		try { await main.OpenClientOrderAsync(orderId); }
		catch (Exception exception)
		{
			Preferences.Default.Remove(PendingPaymentOrderKey);
			Preferences.Default.Remove(PendingRevisionPaymentOrderKey);
			System.Diagnostics.Debug.WriteLine(exception);
		}
	}

	private async Task ConnectRealtimeSafelyAsync()
	{
		if (services.GetRequiredService<SessionService>().User is null) return;
		try { await services.GetRequiredService<RealtimeService>().ConnectAsync(); }
		catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
	}

	private async Task SuspendRealtimeSafelyAsync()
	{
		try { await services.GetRequiredService<RealtimeService>().SuspendAsync(); }
		catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
	}

	public async Task ShowLoginAsync()
	{
		if (changingSession) return;
		changingSession = true;
		try
		{
			Preferences.Default.Remove("campusgig_pending_payment_order");
			Preferences.Default.Set(GuestAccessRules.GuestModePreferenceKey, false);
			var window = Windows.FirstOrDefault();
			if (window is null) return;

			await services.GetRequiredService<RealtimeService>().DisconnectAsync();
			await services.GetRequiredService<SessionService>().ClearAccessSessionAsync();
			ClearGuestMain();
			MainTabbedPage.ClearInstance();

			await MainThread.InvokeOnMainThreadAsync(() =>
			{
				window.Page = services.GetRequiredService<AuthPage>();
				return Task.CompletedTask;
			});
		}
		finally
		{
			changingSession = false;
		}
	}

	private async Task RestorePendingAuthIntentAsync(MainTabbedPage main)
	{
		var intent = GuestAccessRules.ParseIntent(
			Preferences.Default.Get(GuestAccessRules.PendingActionPreferenceKey, ""),
			Preferences.Default.Get(GuestAccessRules.PendingServicePreferenceKey, ""),
			Preferences.Default.Get(GuestAccessRules.PendingPackagePreferenceKey, ""),
			Preferences.Default.Get(GuestAccessRules.PendingProviderPreferenceKey, ""));
		ClearPendingAuthIntent();
		if (intent is null) return;

		await Task.Delay(250);
		if (Windows.FirstOrDefault()?.Page != main ||
			services.GetRequiredService<SessionService>().User is null) return;
		try
		{
			var api = services.GetRequiredService<CampusGigApi>();
			if (intent.Action == GuestProtectedAction.MessageProvider &&
				!string.IsNullOrWhiteSpace(intent.ProviderId))
			{
				var inquiry = await api.PostAsync<Models.ApiResult<Models.ConversationItem>>(
					"conversations/inquiries",
					new { providerId = intent.ProviderId });
				await main.SelectTabAsync("messages");
				await main.Navigation.PushModalAsync(
					new ConversationPage(
						api,
						inquiry.Data,
						main.RefreshActiveTabAsync,
						services.GetRequiredService<RealtimeService>()),
					animated: false);
				return;
			}
			if (string.IsNullOrWhiteSpace(intent.ServiceId)) return;
			var service = await api.GetAsync<Models.ServiceItem>($"services/{intent.ServiceId}");
			service.CoverImageUrl = service.CoverMediaId is null
				? null
				: $"{api.BaseUrl}/services/{service.Id}/media/{service.CoverMediaId}";
			service.ProviderAvatarUrl = service.ProviderHasAvatar
				? $"{api.BaseUrl}/profile/avatar/{service.ProviderId}?v={service.ProviderAvatarVersion}"
				: null;
			var booking = new ServiceBookingPage(
				api,
				services.GetRequiredService<RealtimeService>(),
				services.GetRequiredService<SessionService>(),
				service,
				intent.PackageId);
			await main.Navigation.PushModalAsync(new NavigationPage(booking));
		}
		catch (Exception exception)
		{
			System.Diagnostics.Debug.WriteLine(exception);
			await AppDialog.AlertAsync(
				main,
				"Unable to continue",
				"The selected service or provider conversation could not be reopened.");
		}
	}

	private static void SavePendingAuthIntent(PendingAuthIntent intent)
	{
		Preferences.Default.Set(GuestAccessRules.PendingActionPreferenceKey, intent.Action.ToString());
		SetOrRemove(GuestAccessRules.PendingServicePreferenceKey, intent.ServiceId);
		if (string.IsNullOrWhiteSpace(intent.PackageId))
			Preferences.Default.Remove(GuestAccessRules.PendingPackagePreferenceKey);
		else
			Preferences.Default.Set(GuestAccessRules.PendingPackagePreferenceKey, intent.PackageId);
		SetOrRemove(GuestAccessRules.PendingProviderPreferenceKey, intent.ProviderId);
	}

	private static void SetOrRemove(string key, string? value)
	{
		if (string.IsNullOrWhiteSpace(value)) Preferences.Default.Remove(key);
		else Preferences.Default.Set(key, value);
	}

	private static void ClearPendingAuthIntent()
	{
		Preferences.Default.Remove(GuestAccessRules.PendingActionPreferenceKey);
		Preferences.Default.Remove(GuestAccessRules.PendingServicePreferenceKey);
		Preferences.Default.Remove(GuestAccessRules.PendingPackagePreferenceKey);
		Preferences.Default.Remove(GuestAccessRules.PendingProviderPreferenceKey);
	}
}
