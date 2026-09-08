using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class HomePage : ContentPage, ITabLifecycle
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly RealtimeService realtime;
    private List<ServiceItem> services = [];
    private List<SchoolItem> schools = [];
    private string selectedSchoolId = "";
    private string selectedCategoryId = "";
    private bool entrancePlayed;
    private bool isOpeningService;
    private List<NotificationItem> notifications = [];
    private bool servicesLoaded;
    private CancellationTokenSource? refreshCancellation;
    private bool isLoading;

    public List<ServiceItem> FilteredServices { get; private set; } = [];

    public HomePage(CampusGigApi api, SessionService session, RealtimeService realtime)
    {
        InitializeComponent();
        this.api = api;
        this.session = session;
        this.realtime = realtime;
        realtime.NotificationsChanged += OnRealtimeNotificationsChanged;
        BindingContext = this;
        RenderProfileShortcut();
    }

    public async Task OnTabAppearingAsync()
    {
        RenderProfileShortcut();
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        refreshCancellation = new CancellationTokenSource();
        if (services.Count == 0) await LoadAsync();
        else await LoadAsync(false);
        _ = RefreshInBackgroundAsync(refreshCancellation.Token);
        if (!entrancePlayed)
        {
            entrancePlayed = true;
            await PlayEntranceAsync();
        }
    }

    public Task OnTabDisappearingAsync()
    {
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        refreshCancellation = null;
        return Task.CompletedTask;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await OnTabAppearingAsync();
    }

    protected override async void OnDisappearing()
    {
        await OnTabDisappearingAsync();
        base.OnDisappearing();
    }

    public async Task RefreshTabAsync() => await LoadAsync(false);

    private async Task LoadAsync(bool showError = true)
    {
        if (isLoading) return;
        isLoading = true;
        LoadingServices.IsVisible = services.Count == 0;
        Exception? loadError = null;
        try
        {
            var categoryTask = TryLoadAsync<ApiList<CategoryItem>>("categories");
            var schoolTask = TryLoadAsync<ApiList<SchoolItem>>("schools");
            var serviceTask = TryLoadAsync<ApiList<ServiceItem>>("services");
            await Task.WhenAll(categoryTask, schoolTask, serviceTask);
            var categoryResponse = await categoryTask;
            var schoolResponse = await schoolTask;
            var serviceResponse = await serviceTask;

            if (categoryResponse.Value is not null)
            {
                CategoryList.ItemsSource = categoryResponse.Value.Data;
                CategoryHeader.IsVisible = MarketplaceLoadRules.ShouldShowSection(categoryResponse.Value.Data.Count);
                CategoryList.IsVisible = CategoryHeader.IsVisible;
            }

            if (schoolResponse.Value is not null)
            {
                schools = schoolResponse.Value.Data;
                var previousSchoolId = selectedSchoolId;
                SchoolList.ItemsSource = new List<SchoolItem> { new() { ShortName = "All schools" } }.Concat(schools).ToList();
                var schoolItems = SchoolList.ItemsSource.Cast<SchoolItem>().ToList();
                selectedSchoolId = previousSchoolId;
                SchoolList.SelectedItem = schoolItems.FirstOrDefault(item => item.Id == previousSchoolId) ?? schoolItems.First();
                SchoolCountLabel.Text = $"{schools.Count} participating school{(schools.Count == 1 ? "" : "s")} available";
                SchoolSection.IsVisible = MarketplaceLoadRules.ShouldShowSection(schools.Count);
            }

            if (serviceResponse.Value is not null)
            {
                services = serviceResponse.Value.Data;
                servicesLoaded = true;
                foreach (var service in services)
                {
                    service.CoverImageUrl = service.CoverMediaId is null ? null :
                        $"{api.BaseUrl}/services/{service.Id}/media/{service.CoverMediaId}";
                    service.ProviderAvatarUrl = service.ProviderHasAvatar
                        ? $"{api.BaseUrl}/profile/avatar/{service.ProviderId}?v={service.ProviderAvatarVersion}"
                        : null;
                }
            }

            var previousCategoryId = selectedCategoryId;
            selectedCategoryId = "";
            CategoryList.SelectedItem = (CategoryList.ItemsSource as IEnumerable<CategoryItem>)?
                .FirstOrDefault(item => item.Id == previousCategoryId);
            selectedCategoryId = previousCategoryId;
            ApplyFilter();

            if (!MarketplaceLoadRules.HasAnySuccessfulResponse(
                    categoryResponse.Value is not null,
                    schoolResponse.Value is not null,
                    serviceResponse.Value is not null))
                throw serviceResponse.Error
                    ?? schoolResponse.Error
                    ?? categoryResponse.Error
                    ?? new CampusGigApiException("Unable to load marketplace.");

            _ = LoadNotificationsAsync();
        }
        catch (Exception exception)
        {
            if (showError) loadError = exception;
        }
        finally
        {
            isLoading = false;
            LoadingServices.IsVisible = false;
            Refresh.IsRefreshing = false;
        }

        if (loadError is not null)
            await AppDialog.AlertAsync(this, "Unable to load marketplace", loadError.Message);
    }

    private async Task<LoadAttempt<T>> TryLoadAsync<T>(string path)
    {
        try
        {
            return new(await api.GetAsync<T>(path).WaitAsync(TimeSpan.FromSeconds(12)), null);
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Discover request '{path}' failed: {exception}");
            return new(default, exception);
        }
    }

    private async Task RefreshInBackgroundAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
            while (await timer.WaitForNextTickAsync(cancellationToken))
                await LoadAsync(false);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void OnFilterChanged(object? sender, TextChangedEventArgs e) => ApplyFilter();

    private void OnSchoolSelected(object? sender, SelectionChangedEventArgs e)
    {
        selectedSchoolId = (e.CurrentSelection.FirstOrDefault() as SchoolItem)?.Id ?? "";
        ApplyFilter();
    }

    private void OnCategorySelected(object? sender, SelectionChangedEventArgs e)
    {
        var selected = e.CurrentSelection.FirstOrDefault() as CategoryItem;
        selectedCategoryId = selected?.Id == selectedCategoryId ? "" : selected?.Id ?? "";
        if (string.IsNullOrWhiteSpace(selectedCategoryId)) CategoryList.SelectedItem = null;
        ApplyFilter();
    }

    private void OnClearCategoryClicked(object? sender, EventArgs e)
    {
        selectedCategoryId = "";
        CategoryList.SelectedItem = null;
        ApplyFilter();
    }

    private void OnClearFiltersClicked(object? sender, EventArgs e)
    {
        SearchBox.Text = "";
        selectedSchoolId = "";
        selectedCategoryId = "";
        CategoryList.SelectedItem = null;
        SchoolList.SelectedItem = (SchoolList.ItemsSource as IEnumerable<SchoolItem>)?.FirstOrDefault();
        ApplyFilter();
    }

    private void ApplyFilter()
    {
        var query = SearchBox.Text?.Trim() ?? "";
        var selectedCategoryName = (CategoryList.ItemsSource as IEnumerable<CategoryItem>)?
            .FirstOrDefault(category => category.Id == selectedCategoryId)?.Name;

        FilteredServices = services.Where(service => MarketplaceLoadRules.MatchesService(
            query,
            selectedSchoolId,
            selectedCategoryName,
            service.Title,
            service.Provider,
            service.Category,
            service.School,
            service.SchoolId)).ToList();
        BindableLayout.SetItemsSource(ServiceCards, FilteredServices);
        OnPropertyChanged(nameof(FilteredServices));
        MarketplaceTitleLabel.Text = selectedCategoryName ?? "Available services";
        ClearCategoryButton.IsVisible = !string.IsNullOrWhiteSpace(selectedCategoryName);
        EmptyServices.IsVisible = servicesLoaded && FilteredServices.Count == 0;
    }

    private async void OnRefreshing(object? sender, EventArgs e) => await LoadAsync();

    private async void OnServiceTapped(object? sender, TappedEventArgs e)
    {
        if (isOpeningService || e.Parameter is not ServiceItem service) return;
        isOpeningService = true;
        try
        {
            if (sender is TapGestureRecognizer { Parent: VisualElement card })
                await PlayTapAsync(card);
            if (service.Packages.Count == 0)
            {
                await AppDialog.AlertAsync(this, service.Title, service.Description, "Close");
                return;
            }
            await Navigation.PushModalAsync(new NavigationPage(new ServiceBookingPage(api, service)));
        }
        finally { isOpeningService = false; }
    }

    private async Task LoadNotificationsAsync()
    {
        try
        {
            var response = await api.GetAsync<NotificationList>("notifications");
            notifications = response.Data;
            NotificationBadge.IsVisible = response.UnreadCount > 0;
            NotificationCountLabel.Text = response.UnreadCount > 9 ? "9+" : response.UnreadCount.ToString();
        }
        catch (CampusGigApiException) { NotificationBadge.IsVisible = false; }
    }

    private void OnRealtimeNotificationsChanged(string orderId) => _ = LoadNotificationsAsync();

    private async void OnNotificationsClicked(object? sender, TappedEventArgs e)
    {
        await PlayTapAsync(NotificationButton);
        await LoadNotificationsAsync();
        await Navigation.PushModalAsync(new NavigationPage(new NotificationsPage(api, session, notifications, LoadNotificationsAsync)));
    }

    private async void OnProfileClicked(object? sender, TappedEventArgs e)
    {
        await PlayTapAsync(ProfileShortcutButton);
        if (MainTabbedPage.Instance is not null)
            await MainTabbedPage.Instance.SelectTabAsync("profile");
    }

    private static async Task PlayTapAsync(VisualElement element)
    {
        await Task.WhenAll(
            element.ScaleToAsync(0.91, 55, Easing.CubicOut),
            element.FadeToAsync(0.78, 55, Easing.CubicOut));
        await Task.WhenAll(
            element.ScaleToAsync(1, 105, Easing.CubicOut),
            element.FadeToAsync(1, 105, Easing.CubicOut));
    }

    private static string GetInitials(string? displayName)
    {
        var parts = (displayName ?? "C").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return string.Join("", parts.Take(2).Select(part => char.ToUpperInvariant(part[0])));
    }

    private void RenderProfileShortcut()
    {
        var user = session.User;
        ProfileInitialsLabel.Text = GetInitials(user?.DisplayName);
        var hasAvatar = ProfileImageRules.CanDisplay(user?.HasAvatar == true, user?.Id);
        ProfileShortcutImage.IsVisible = hasAvatar;
        ProfileInitialsLabel.IsVisible = !hasAvatar;
        ProfileShortcutImage.Source = hasAvatar
            ? ProfileImageRules.BuildUrl(api.BaseUrl, user!.Id, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
            : null;
    }

    private async Task PlayEntranceAsync()
    {
        var elements = new VisualElement[] { HeaderArea, HeroCard, SchoolSection, CategoryHeader, CategoryList, MarketplaceHeader, ServiceCards };
        foreach (var element in elements)
        {
            element.Opacity = 0;
            element.TranslationY = 12;
        }
        await Task.WhenAll(elements.Select((element, index) =>
            AnimateElementAsync(element, index * 35)));
    }

    private static async Task AnimateElementAsync(VisualElement element, int delayMilliseconds)
    {
        if (delayMilliseconds > 0) await Task.Delay(delayMilliseconds);
        await Task.WhenAll(
            element.FadeToAsync(1, 165, Easing.CubicOut),
            element.TranslateToAsync(0, 0, 190, Easing.CubicOut));
    }
}

internal sealed record LoadAttempt<T>(T? Value, Exception? Error);
