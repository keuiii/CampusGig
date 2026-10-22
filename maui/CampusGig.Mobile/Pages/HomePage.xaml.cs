using System.Collections.ObjectModel;
using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class HomePage : ContentPage, ITabLifecycle, IDisposable
{
    private static readonly MarketplaceBudgetRange[] BudgetRanges =
    [
        MarketplaceBudgetRange.Any,
        MarketplaceBudgetRange.Under500,
        MarketplaceBudgetRange.From500To999,
        MarketplaceBudgetRange.From1000To2499,
        MarketplaceBudgetRange.From2500To4999,
        MarketplaceBudgetRange.From5000
    ];
    private static readonly double[] MinimumRatings = [0, 4.5, 4, 3];
    private static readonly int?[] MaximumDeliveryDays = [null, 1, 3, 7];
    private static readonly MarketplaceSort[] MarketplaceSorts =
    [
        MarketplaceSort.Recommended,
        MarketplaceSort.Newest,
        MarketplaceSort.Rating,
        MarketplaceSort.PriceLowToHigh,
        MarketplaceSort.DeliveryFastest
    ];

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
    private int serviceTotal;
    private int loadedServicePage = 1;
    private int serviceQueryVersion;
    private int serviceDataVersion;
    private bool hasMoreServices;
    private bool loadingMoreServices;
    private bool savedOnly;
    private HashSet<string> savedServiceIds = new(StringComparer.Ordinal);
    private string savedForUserId = "";
    private CancellationTokenSource? filterCancellation;
    private CancellationTokenSource? refreshCancellation;
    private bool isLoading;

    public ObservableCollection<ServiceItem> FilteredServices { get; } = [];

    public HomePage(CampusGigApi api, SessionService session, RealtimeService realtime)
    {
        InitializeComponent();
        this.api = api;
        this.session = session;
        this.realtime = realtime;
        realtime.NotificationsChanged += OnRealtimeNotificationsChanged;
        realtime.MarketplaceChanged += OnMarketplaceChanged;
        realtime.ReconciliationRequired += OnRealtimeReconciliationRequired;
        BindingContext = this;
        BudgetRangePicker.ItemsSource = new[]
        {
            "Any budget",
            "Below ₱500",
            "₱500–₱999",
            "₱1,000–₱2,499",
            "₱2,500–₱4,999",
            "₱5,000 and above"
        };
        MinimumRatingPicker.ItemsSource = new[] { "Any rating", "4.5 and above", "4.0 and above", "3.0 and above" };
        MaximumDeliveryPicker.ItemsSource = new[] { "Any delivery", "Within 1 day", "Within 3 days", "Within 7 days" };
        MarketplaceSortPicker.ItemsSource = new[] { "Recommended", "Newest", "Top rated", "Price: low to high", "Fastest delivery" };
        BudgetRangePicker.SelectedIndex = 0;
        MinimumRatingPicker.SelectedIndex = 0;
        MaximumDeliveryPicker.SelectedIndex = 0;
        MarketplaceSortPicker.SelectedIndex = 0;
        RenderProfileShortcut();
    }

    public async Task OnTabAppearingAsync()
    {
        RenderProfileShortcut();
        var appearanceCancellation = new CancellationTokenSource();
        CancelAndDispose(Interlocked.Exchange(ref refreshCancellation, appearanceCancellation));
        var cancellationToken = appearanceCancellation.Token;
        try
        {
            if (services.Count == 0) await LoadAsync(cancellationToken: cancellationToken);
            else await LoadAsync(false, cancellationToken);
            if (cancellationToken.IsCancellationRequested ||
                !ReferenceEquals(refreshCancellation, appearanceCancellation)) return;
            _ = RefreshInBackgroundAsync(cancellationToken);
            if (!entrancePlayed)
            {
                entrancePlayed = true;
                await PlayEntranceAsync();
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    public Task OnTabDisappearingAsync()
    {
        CancelAndDispose(Interlocked.Exchange(ref refreshCancellation, null));
        CancelAndDispose(Interlocked.Exchange(ref filterCancellation, null));
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

    private async Task LoadAsync(bool showError = true, CancellationToken cancellationToken = default)
    {
        if (isLoading) return;
        var userId = session.User?.Id ?? "";
        if (savedForUserId != userId)
        {
            savedForUserId = userId;
            savedServiceIds.Clear();
            savedOnly = false;
            SavedServicesButton.Text = "Saved";
        }
        isLoading = true;
        LoadingServices.IsVisible = services.Count == 0;
        Exception? loadError = null;
        try
        {
            var categoryTask = TryLoadAsync<ApiList<CategoryItem>>("categories", cancellationToken);
            var schoolTask = TryLoadAsync<ApiList<SchoolItem>>("schools", cancellationToken);
            var queryVersion = serviceQueryVersion;
            var dataVersion = ++serviceDataVersion;
            var serviceTask = TryLoadServicePagesAsync(loadedServicePage, cancellationToken);
            var savedTask = session.User is null
                ? Task.FromResult(new LoadAttempt<ApiList<string>>(new ApiList<string>(), null))
                : TryLoadAsync<ApiList<string>>("services/saved/ids", cancellationToken);
            await Task.WhenAll(categoryTask, schoolTask, serviceTask, savedTask);
            cancellationToken.ThrowIfCancellationRequested();
            var categoryResponse = await categoryTask;
            var schoolResponse = await schoolTask;
            var serviceResponse = await serviceTask;
            var savedResponse = await savedTask;
            if (savedResponse.Value is not null)
                savedServiceIds = savedResponse.Value.Data.ToHashSet(StringComparer.Ordinal);

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

            if (serviceResponse.Value is not null && queryVersion == serviceQueryVersion && dataVersion == serviceDataVersion)
            {
                services = serviceResponse.Value.Data;
                serviceTotal = serviceResponse.Value.Total;
                loadedServicePage = serviceResponse.Value.Page;
                hasMoreServices = serviceResponse.Value.HasMore;
                servicesLoaded = true;
                foreach (var service in services)
                {
                    service.IsSaved = savedServiceIds.Contains(service.Id);
                    service.CoverImageUrl = service.CoverMediaId is null ? null :
                        $"{api.BaseUrl}/services/{service.Id}/media/{service.CoverMediaId}";
                    service.ProviderAvatarUrl = service.ProviderHasAvatar
                        ? $"{api.BaseUrl}/profile/avatar/{service.ProviderId}?v={service.ProviderAvatarVersion}"
                        : null;
                }
                MarketplacePageErrorPanel.IsVisible = false;
            }
            else if (serviceResponse.Error is not null && queryVersion == serviceQueryVersion && dataVersion == serviceDataVersion)
            {
                MarketplacePageError.Text = "Could not refresh services. Pull down to retry.";
                MarketplacePageErrorPanel.IsVisible = true;
            }

            ApplyFilter(false);

            if (!MarketplaceLoadRules.HasAnySuccessfulResponse(
                    categoryResponse.Value is not null,
                    schoolResponse.Value is not null,
                    serviceResponse.Value is not null))
                throw serviceResponse.Error
                    ?? schoolResponse.Error
                    ?? categoryResponse.Error
                    ?? new CampusGigApiException("Unable to load marketplace.");

            if (session.User is not null)
                _ = LoadNotificationsAsync();
            else
            {
                notifications = [];
                NotificationBadge.IsVisible = false;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
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

    private async Task<LoadAttempt<T>> TryLoadAsync<T>(string path, CancellationToken cancellationToken = default)
    {
        try
        {
            return new(await api.GetAsync<T>(path, cancellationToken)
                .WaitAsync(TimeSpan.FromSeconds(12), cancellationToken), null);
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Discover request '{path}' failed: {exception}");
            return new(default, exception);
        }
    }

    private string ServicePagePath(int page)
    {
        var category = (CategoryList.ItemsSource as IEnumerable<CategoryItem>)?
            .FirstOrDefault(item => item.Id == selectedCategoryId)?.Name ?? "";
        var budget = BudgetRanges.ElementAtOrDefault(Math.Max(0, BudgetRangePicker.SelectedIndex));
        var sort = MarketplaceSorts.ElementAtOrDefault(Math.Max(0, MarketplaceSortPicker.SelectedIndex));
        var rating = MinimumRatings.ElementAtOrDefault(Math.Max(0, MinimumRatingPicker.SelectedIndex));
        var days = MaximumDeliveryDays.ElementAtOrDefault(Math.Max(0, MaximumDeliveryPicker.SelectedIndex));
        return MarketplaceLoadRules.BuildServicePagePath(
            SearchBox.Text ?? "", category, selectedSchoolId, budget, rating, days, sort, page, savedOnly);
    }

    private async Task<LoadAttempt<ServicePage>> TryLoadServicePagesAsync(
        int pageCount,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var combined = new ServicePage();
            for (var page = 1; page <= pageCount; page++)
            {
                var result = await api.GetAsync<ServicePage>(ServicePagePath(page), cancellationToken)
                    .WaitAsync(TimeSpan.FromSeconds(12), cancellationToken);
                combined.Data.AddRange(result.Data);
                combined.Page = result.Page;
                combined.PageSize = result.PageSize;
                combined.Total = result.Total;
                combined.HasMore = result.HasMore;
                if (!result.HasMore) break;
            }
            return new(combined, null);
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Discover pages failed: {exception}");
            return new(null, exception);
        }
    }

    private async Task RefreshInBackgroundAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
            while (await timer.WaitForNextTickAsync(cancellationToken))
                await LoadAsync(false, cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void OnFilterChanged(object? sender, TextChangedEventArgs e)
    {
        ClearSearchButton.IsVisible = !string.IsNullOrWhiteSpace(e.NewTextValue);
        ApplyFilter();
    }

    private void OnClearSearchClicked(object? sender, EventArgs e)
    {
        SearchBox.Text = "";
        SearchBox.Focus();
    }

    private void OnSchoolSelected(object? sender, SelectionChangedEventArgs e)
    {
        var nextSchoolId = (e.CurrentSelection.FirstOrDefault() as SchoolItem)?.Id ?? "";
        if (nextSchoolId == selectedSchoolId) return;
        selectedSchoolId = nextSchoolId;
        ApplyFilter();
    }

    private async void OnCategoryTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not CategoryItem selected) return;
        if (sender is TapGestureRecognizer { Parent: VisualElement card })
            await PlayTapAsync(card);
        selectedCategoryId = selected.Id == selectedCategoryId ? "" : selected.Id;
        ApplyFilter();
    }

    private void OnClearCategoryClicked(object? sender, EventArgs e)
    {
        selectedCategoryId = "";
        ApplyFilter();
    }

    private void OnClearFiltersClicked(object? sender, EventArgs e)
    {
        SearchBox.Text = "";
        selectedSchoolId = "";
        selectedCategoryId = "";
        ResetAdvancedFilters();
        SchoolList.SelectedItem = (SchoolList.ItemsSource as IEnumerable<SchoolItem>)?.FirstOrDefault();
        ApplyFilter();
    }

    private async void OnMarketplaceFiltersClicked(object? sender, EventArgs e)
    {
        MarketplaceFiltersPanel.IsVisible = !MarketplaceFiltersPanel.IsVisible;
        MarketplaceFiltersButton.Text = MarketplaceFiltersPanel.IsVisible ? "Hide filters" : "Filters";
        if (!MarketplaceFiltersPanel.IsVisible) return;
        MarketplaceFiltersPanel.Opacity = 0;
        MarketplaceFiltersPanel.TranslationY = -7;
        await Task.WhenAll(
            MarketplaceFiltersPanel.FadeToAsync(1, 150, Easing.CubicOut),
            MarketplaceFiltersPanel.TranslateToAsync(0, 0, 175, Easing.CubicOut));
    }

    private void OnAdvancedFilterChanged(object? sender, EventArgs e) => ApplyFilter();

    private async void OnSavedServicesClicked(object? sender, EventArgs e)
    {
        if (session.User is null)
        {
            await ((App)Application.Current!).RequireAuthenticationAsync(
                this,
                GuestProtectedAction.ViewSavedServices);
            return;
        }
        savedOnly = !savedOnly;
        SavedServicesButton.Text = savedOnly ? "All services" : "Saved";
        ApplyFilter();
    }

    private async void OnSaveServiceClicked(object? sender, EventArgs e)
    {
        if (sender is not Button button || button.CommandParameter is not ServiceItem service) return;
        if (session.User is null)
        {
            await ((App)Application.Current!).RequireAuthenticationAsync(
                this,
                GuestProtectedAction.SaveService);
            return;
        }
        if (!button.IsEnabled) return;
        button.IsEnabled = false;
        try
        {
            if (service.IsSaved)
            {
                await api.DeleteAsync<object>($"services/{service.Id}/save");
                savedServiceIds.Remove(service.Id);
            }
            else
            {
                await api.PutAsync<object>($"services/{service.Id}/save");
                savedServiceIds.Add(service.Id);
            }
            service.IsSaved = savedServiceIds.Contains(service.Id);
            if (savedOnly && !service.IsSaved)
            {
                services.RemoveAll(item => item.Id == service.Id);
                serviceTotal = Math.Max(0, serviceTotal - 1);
                ApplyFilter(false);
                await LoadAsync(false);
            }
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Could not update saved services", exception.Message);
        }
        finally { button.IsEnabled = true; }
    }

    private void OnClearAdvancedFiltersClicked(object? sender, EventArgs e)
    {
        ResetAdvancedFilters();
        ApplyFilter();
    }

    private void ResetAdvancedFilters()
    {
        BudgetRangePicker.SelectedIndex = 0;
        MinimumRatingPicker.SelectedIndex = 0;
        MaximumDeliveryPicker.SelectedIndex = 0;
        MarketplaceSortPicker.SelectedIndex = 0;
    }

    private void ApplyFilter(bool reload = true)
    {
        var selectedCategoryName = (CategoryList.ItemsSource as IEnumerable<CategoryItem>)?
            .FirstOrDefault(category => category.Id == selectedCategoryId)?.Name;

        var budgetRange = BudgetRanges.ElementAtOrDefault(Math.Max(0, BudgetRangePicker.SelectedIndex));
        var minimumRating = MinimumRatings.ElementAtOrDefault(Math.Max(0, MinimumRatingPicker.SelectedIndex));
        var maximumDeliveryDays = MaximumDeliveryDays.ElementAtOrDefault(Math.Max(0, MaximumDeliveryPicker.SelectedIndex));
        var marketplaceSort = MarketplaceSorts.ElementAtOrDefault(Math.Max(0, MarketplaceSortPicker.SelectedIndex));

        MarketplaceLoadRules.ReconcileServices(FilteredServices, services);
        MarketplaceTitleLabel.Text = selectedCategoryName ?? "Available services";
        MarketplaceResultCountLabel.Text = $"{serviceTotal} service{(serviceTotal == 1 ? "" : "s")}";
        var searchQuery = SearchBox.Text?.Trim() ?? "";
        EmptyServicesTitle.Text = string.IsNullOrWhiteSpace(searchQuery)
            ? "No services found"
            : $"No results for “{searchQuery}”";
        EmptyServicesDescription.Text = string.IsNullOrWhiteSpace(searchQuery)
            ? "Try another school, category, or search."
            : "Try a broader phrase, another skill, or clear one of the filters.";
        var advancedFilterCount = (budgetRange == MarketplaceBudgetRange.Any ? 0 : 1)
            + (minimumRating <= 0 ? 0 : 1)
            + (maximumDeliveryDays is null ? 0 : 1)
            + (marketplaceSort == MarketplaceSort.Recommended ? 0 : 1);
        if (!MarketplaceFiltersPanel.IsVisible)
            MarketplaceFiltersButton.Text = advancedFilterCount == 0 ? "Filters" : $"Filters ({advancedFilterCount})";
        ClearCategoryButton.IsVisible = !string.IsNullOrWhiteSpace(selectedCategoryName);
        EmptyServices.IsVisible = servicesLoaded && FilteredServices.Count == 0 && !MarketplacePageErrorPanel.IsVisible;
        LoadMoreServicesButton.IsVisible = hasMoreServices;
        LoadMoreServicesButton.IsEnabled = !loadingMoreServices;
        LoadMoreServicesButton.Text = loadingMoreServices ? "Loading services…" : $"Show more ({FilteredServices.Count} of {serviceTotal})";
        if (reload && servicesLoaded) ScheduleFilterReload();
    }

    private void ScheduleFilterReload()
    {
        serviceQueryVersion++;
        serviceDataVersion++;
        loadedServicePage = 1;
        services = [];
        serviceTotal = 0;
        hasMoreServices = false;
        MarketplaceResultCountLabel.Text = "Loading services…";
        MarketplaceLoadRules.ReconcileServices(FilteredServices, services);
        EmptyServices.IsVisible = false;
        LoadMoreServicesButton.IsVisible = false;
        LoadingServices.IsVisible = true;
        MarketplacePageErrorPanel.IsVisible = false;
        filterCancellation?.Cancel();
        filterCancellation?.Dispose();
        filterCancellation = new CancellationTokenSource();
        var token = filterCancellation.Token;
        _ = ReloadAfterFilterChangeAsync(token);
    }

    private async Task ReloadAfterFilterChangeAsync(CancellationToken token)
    {
        try
        {
            await Task.Delay(250, token);
            while (isLoading) await Task.Delay(50, token);
            token.ThrowIfCancellationRequested();
            await LoadAsync(false, token);
        }
        catch (OperationCanceledException) { }
    }

    private async void OnLoadMoreServicesClicked(object? sender, EventArgs e)
    {
        if (!hasMoreServices || loadingMoreServices) return;
        loadingMoreServices = true;
        var dataVersion = ++serviceDataVersion;
        MarketplacePageErrorPanel.IsVisible = false;
        ApplyFilter(false);
        var queryVersion = serviceQueryVersion;
        try
        {
            var cancellationToken = filterCancellation?.Token ?? CancellationToken.None;
            var page = await api.GetAsync<ServicePage>(
                ServicePagePath(loadedServicePage + 1), cancellationToken);
            if (queryVersion != serviceQueryVersion || dataVersion != serviceDataVersion) return;
            var knownIds = services.Select(item => item.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var service in page.Data.Where(item => knownIds.Add(item.Id)))
            {
                service.IsSaved = savedServiceIds.Contains(service.Id);
                service.CoverImageUrl = service.CoverMediaId is null ? null :
                    $"{api.BaseUrl}/services/{service.Id}/media/{service.CoverMediaId}";
                service.ProviderAvatarUrl = service.ProviderHasAvatar
                    ? $"{api.BaseUrl}/profile/avatar/{service.ProviderId}?v={service.ProviderAvatarVersion}"
                    : null;
                services.Add(service);
            }
            loadedServicePage = page.Page;
            serviceTotal = page.Total;
            hasMoreServices = page.HasMore;
        }
        catch (Exception exception)
        {
            if (queryVersion == serviceQueryVersion && dataVersion == serviceDataVersion)
            {
                MarketplacePageError.Text = $"Could not load more services: {exception.Message}";
                MarketplacePageErrorPanel.IsVisible = true;
            }
        }
        finally
        {
            loadingMoreServices = false;
            ApplyFilter(false);
        }
    }

    private async void OnRefreshing(object? sender, EventArgs e) => await LoadAsync();

    private async void OnRetryMarketplaceClicked(object? sender, EventArgs e) => await LoadAsync();

    private async void OnServiceTapped(object? sender, TappedEventArgs e)
    {
        if (isOpeningService || e.Parameter is not ServiceItem service) return;
        isOpeningService = true;
        try
        {
            if (sender is TapGestureRecognizer { Parent: VisualElement card })
                await PlayTapAsync(card);
            if (PricingModelRules.IsSinglePriceV2(service.PricingModel))
            {
                await Navigation.PushModalAsync(new NavigationPage(new ServiceBookingPage(api, realtime, session, service)));
                return;
            }
            if (!PricingModelRules.IsLegacy(service.PricingModel))
            {
                await AppDialog.AlertAsync(
                    this,
                    "Unsupported pricing model",
                    "Update CampusGig to view and book this listing.",
                    "Close");
                return;
            }
            if (service.Packages.Count == 0)
            {
                await AppDialog.AlertAsync(this, service.Title, service.Description, "Close");
                return;
            }
            await Navigation.PushModalAsync(new NavigationPage(new ServiceBookingPage(api, realtime, session, service)));
        }
        finally { isOpeningService = false; }
    }

    private async Task LoadNotificationsAsync()
    {
        if (session.User is null)
        {
            notifications = [];
            NotificationBadge.IsVisible = false;
            return;
        }
        try
        {
            var response = await api.GetAsync<NotificationList>("notifications");
            notifications = response.Data;
            NotificationBadge.IsVisible = response.UnreadCount > 0;
            NotificationCountLabel.Text = response.UnreadCount > 9 ? "9+" : response.UnreadCount.ToString();
        }
        catch (CampusGigApiException) { NotificationBadge.IsVisible = false; }
    }

    private void OnRealtimeNotificationsChanged(string orderId)
    {
        if (session.User is not null) _ = LoadNotificationsAsync();
    }
    private void OnMarketplaceChanged() => _ = LoadAsync(false);
    private async void OnRealtimeReconciliationRequired()
    {
        while (isLoading) await Task.Delay(50);
        if (session.User is null)
            await LoadAsync(false);
        else
            await Task.WhenAll(LoadAsync(false), LoadNotificationsAsync());
    }

    public void Dispose()
    {
        realtime.NotificationsChanged -= OnRealtimeNotificationsChanged;
        realtime.MarketplaceChanged -= OnMarketplaceChanged;
        realtime.ReconciliationRequired -= OnRealtimeReconciliationRequired;
        CancelAndDispose(Interlocked.Exchange(ref refreshCancellation, null));
        CancelAndDispose(Interlocked.Exchange(ref filterCancellation, null));
    }

    private static void CancelAndDispose(CancellationTokenSource? source)
    {
        if (source is null) return;
        try { source.Cancel(); }
        finally { source.Dispose(); }
    }

    private async void OnNotificationsClicked(object? sender, TappedEventArgs e)
    {
        await PlayTapAsync(NotificationButton);
        if (!await ((App)Application.Current!).RequireAuthenticationAsync(
                this,
                GuestProtectedAction.ViewNotifications)) return;
        await LoadNotificationsAsync();
        await Navigation.PushModalAsync(new NavigationPage(new NotificationsPage(api, session, realtime, notifications, LoadNotificationsAsync)));
    }

    private async void OnProfileClicked(object? sender, TappedEventArgs e)
    {
        await PlayTapAsync(ProfileShortcutButton);
        if (!await ((App)Application.Current!).RequireAuthenticationAsync(
                this,
                GuestProtectedAction.ViewProfile)) return;
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
        ProfileInitialsLabel.Text = user is null ? "IN" : GetInitials(user.DisplayName);
        var hasAvatar = ProfileImageRules.CanDisplay(user?.HasAvatar == true, user?.Id);
        ProfileShortcutImage.IsVisible = hasAvatar;
        ProfileInitialsLabel.IsVisible = !hasAvatar;
        ProfileShortcutImage.Source = hasAvatar
            ? ProfileImageRules.BuildUrl(api.BaseUrl, user!.Id, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())
            : null;
    }

    private async Task PlayEntranceAsync()
    {
        var elements = new VisualElement[] { HeaderArea, HeroCard, SchoolSection, CategoryHeader, CategoryList, MarketplaceHeader };
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
