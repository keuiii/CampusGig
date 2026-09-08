using CampusGig.Mobile.Pages;
using CampusGig.Mobile.Services;
using Microsoft.Extensions.DependencyInjection;

namespace CampusGig.Mobile;

public partial class App : Application
{
	private readonly IServiceProvider services;
	private bool changingSession;

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
		var window = new Window(services.GetRequiredService<SplashPage>());
		window.Created += async (_, _) => await InitializeAsync();
		return window;
	}

	private async Task InitializeAsync()
	{
		var minimumDisplay = Task.Delay(TimeSpan.FromMilliseconds(1800));
		var authenticated = await TryRestoreSessionAsync();
		await minimumDisplay;

		if (authenticated)
			ShowMain();
		else
			ShowAuth();
	}

	private async Task<bool> TryRestoreSessionAsync()
	{
		var session = services.GetRequiredService<SessionService>();
		var api = services.GetRequiredService<CampusGigApi>();
		if (!await session.RestoreAsync()) return false;

		try
		{
			var user = await api.GetAsync<Models.AuthUser>("auth/me");
			await session.UpdateUserAsync(user);
			return true;
		}
		catch
		{
			await session.ClearAccessSessionAsync();
			return false;
		}
	}

	private void ShowAuth()
	{
		var window = Windows.FirstOrDefault();
		if (window is not null)
			window.Page = services.GetRequiredService<AuthPage>();
	}

	public void ShowMain()
	{
		var window = Windows.FirstOrDefault();
		if (window is null) return;

		MainTabbedPage.ClearInstance();
		window.Page = services.GetRequiredService<MainTabbedPage>();
		_ = ConnectRealtimeSafelyAsync();
	}

	private async Task ConnectRealtimeSafelyAsync()
	{
		try { await Task.Run(() => services.GetRequiredService<RealtimeService>().ConnectAsync()); }
		catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
	}

	public async Task ShowLoginAsync()
	{
		if (changingSession) return;
		changingSession = true;
		try
		{
			var window = Windows.FirstOrDefault();
			if (window is null) return;

			await services.GetRequiredService<RealtimeService>().DisconnectAsync();
			await services.GetRequiredService<SessionService>().ClearAccessSessionAsync();
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
}
