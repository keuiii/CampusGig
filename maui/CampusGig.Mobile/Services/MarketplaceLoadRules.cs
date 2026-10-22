using System.Collections.ObjectModel;
using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public enum MarketplaceSort
{
    Recommended,
    Newest,
    Rating,
    PriceLowToHigh,
    DeliveryFastest
}

public enum MarketplaceBudgetRange
{
    Any,
    Under500,
    From500To999,
    From1000To2499,
    From2500To4999,
    From5000
}

public static class MarketplaceLoadRules
{
    public static string BuildServicePagePath(
        string query,
        string category,
        string schoolId,
        MarketplaceBudgetRange budget,
        double minimumRating,
        int? maximumDeliveryDays,
        MarketplaceSort sort,
        int page,
        bool savedOnly = false)
    {
        var parameters = new Dictionary<string, string>
        {
            ["page"] = page.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["sort"] = sort switch
            {
                MarketplaceSort.Newest => "newest",
                MarketplaceSort.Rating => "rating",
                MarketplaceSort.PriceLowToHigh => "price-low",
                MarketplaceSort.DeliveryFastest => "delivery-fast",
                _ => "recommended"
            }
        };
        var normalizedQuery = string.Join(' ', query.Split(
            (char[]?)null,
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        if (!string.IsNullOrWhiteSpace(normalizedQuery)) parameters["query"] = normalizedQuery;
        if (!string.IsNullOrWhiteSpace(category)) parameters["category"] = category;
        if (!string.IsNullOrWhiteSpace(schoolId)) parameters["schoolId"] = schoolId;
        if (budget != MarketplaceBudgetRange.Any) parameters["budgetRange"] = budget switch
        {
            MarketplaceBudgetRange.Under500 => "under-500",
            MarketplaceBudgetRange.From500To999 => "500-999",
            MarketplaceBudgetRange.From1000To2499 => "1000-2499",
            MarketplaceBudgetRange.From2500To4999 => "2500-4999",
            _ => "5000-plus"
        };
        if (minimumRating > 0) parameters["minimumRating"] = minimumRating.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (maximumDeliveryDays.HasValue) parameters["maximumDeliveryDays"] = maximumDeliveryDays.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return (savedOnly ? "services/saved?" : "services?") + string.Join("&", parameters.Select(item =>
            $"{Uri.EscapeDataString(item.Key)}={Uri.EscapeDataString(item.Value)}"));
    }

    public static bool ShouldShowSection(int itemCount) => itemCount > 0;

    public static bool HasAnySuccessfulResponse(params bool[] responses) =>
        responses.Any(succeeded => succeeded);

    public static bool MatchesService(
        string query,
        string selectedSchoolId,
        string? selectedCategoryName,
        string title,
        string provider,
        string category,
        string school,
        string schoolId)
    {
        var normalizedQuery = query.Trim();
        var searchableText = $"{title} {provider} {category} {school}";
        var schoolInitialism = BuildInitialism(school);
        var matchesQuery = string.IsNullOrWhiteSpace(normalizedQuery)
            || searchableText.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase)
            || schoolInitialism.Contains(normalizedQuery, StringComparison.OrdinalIgnoreCase);
        return matchesQuery
            && (string.IsNullOrWhiteSpace(selectedSchoolId) || string.Equals(schoolId, selectedSchoolId, StringComparison.Ordinal))
            && (string.IsNullOrWhiteSpace(selectedCategoryName) || string.Equals(category, selectedCategoryName, StringComparison.OrdinalIgnoreCase));
    }

    public static IReadOnlyList<ServiceItem> FilterAndSortServices(
        IEnumerable<ServiceItem> services,
        string query,
        string selectedSchoolId,
        string? selectedCategoryName,
        MarketplaceBudgetRange budgetRange,
        double minimumRating,
        int? maximumDeliveryDays,
        MarketplaceSort sort)
    {
        var indexed = services
            .Select((service, index) => new { Service = service, Index = index })
            .Where(item => MatchesService(
                query,
                selectedSchoolId,
                selectedCategoryName,
                item.Service.Title,
                item.Service.Provider,
                item.Service.Category,
                item.Service.School,
                item.Service.SchoolId))
            .Where(item => MatchesBudgetRange(item.Service.Price, budgetRange))
            .Where(item => item.Service.Rating >= minimumRating)
            .Where(item => maximumDeliveryDays is null || DeliveryDays(item.Service) <= maximumDeliveryDays)
            .ToList();

        return sort switch
        {
            MarketplaceSort.Newest => indexed.OrderByDescending(item => item.Service.PublishedAt).ThenBy(item => item.Index).Select(item => item.Service).ToList(),
            MarketplaceSort.Rating => indexed.OrderByDescending(item => item.Service.Rating).ThenBy(item => item.Index).Select(item => item.Service).ToList(),
            MarketplaceSort.PriceLowToHigh => indexed.OrderBy(item => item.Service.Price).ThenBy(item => item.Index).Select(item => item.Service).ToList(),
            MarketplaceSort.DeliveryFastest => indexed.OrderBy(item => DeliveryDays(item.Service)).ThenBy(item => item.Index).Select(item => item.Service).ToList(),
            _ => indexed.OrderBy(item => item.Index).Select(item => item.Service).ToList()
        };
    }

    public static bool MatchesBudgetRange(int price, MarketplaceBudgetRange range) => range switch
    {
        MarketplaceBudgetRange.Under500 => price < 500,
        MarketplaceBudgetRange.From500To999 => price is >= 500 and < 1_000,
        MarketplaceBudgetRange.From1000To2499 => price is >= 1_000 and < 2_500,
        MarketplaceBudgetRange.From2500To4999 => price is >= 2_500 and < 5_000,
        MarketplaceBudgetRange.From5000 => price >= 5_000,
        _ => true
    };

    public static void ReconcileServices(
        ObservableCollection<ServiceItem> current,
        IReadOnlyList<ServiceItem> desired)
    {
        for (var desiredIndex = 0; desiredIndex < desired.Count; desiredIndex++)
        {
            var desiredService = desired[desiredIndex];
            var existingIndex = IndexOfService(current, desiredService.Id, desiredIndex);

            if (existingIndex < 0)
                current.Insert(desiredIndex, desiredService);
            else if (existingIndex != desiredIndex)
                current.Move(existingIndex, desiredIndex);

            if (!HasSameContent(current[desiredIndex], desiredService))
                current[desiredIndex] = desiredService;
        }

        while (current.Count > desired.Count)
            current.RemoveAt(current.Count - 1);
    }

    private static int IndexOfService(
        IReadOnlyList<ServiceItem> services,
        string serviceId,
        int startIndex)
    {
        for (var index = startIndex; index < services.Count; index++)
            if (string.Equals(services[index].Id, serviceId, StringComparison.Ordinal))
                return index;

        return -1;
    }

    private static int DeliveryDays(ServiceItem service) =>
        service.Packages.Count == 0
            ? int.MaxValue
            : service.Packages.Min(package => package.DeliveryDays);

    private static bool HasSameContent(ServiceItem current, ServiceItem desired) =>
        current.Id == desired.Id
        && current.Title == desired.Title
        && current.Description == desired.Description
        && current.Category == desired.Category
        && current.ProviderId == desired.ProviderId
        && current.Provider == desired.Provider
        && current.ProviderHasAvatar == desired.ProviderHasAvatar
        && current.ProviderAvatarVersion == desired.ProviderAvatarVersion
        && current.SchoolId == desired.SchoolId
        && current.School == desired.School
        && current.Price == desired.Price
        && current.Rating.Equals(desired.Rating)
        && current.Delivery == desired.Delivery
        && current.PublishedAt == desired.PublishedAt
        && current.CoverMediaId == desired.CoverMediaId
        && current.CoverImageUrl == desired.CoverImageUrl
        && current.ProviderAvatarUrl == desired.ProviderAvatarUrl
        && current.IsSaved == desired.IsSaved
        && current.Packages.Count == desired.Packages.Count
        && current.Packages.Zip(desired.Packages).All(pair =>
            pair.First.Id == pair.Second.Id
            && pair.First.Tier == pair.Second.Tier
            && pair.First.Name == pair.Second.Name
            && pair.First.Description == pair.Second.Description
            && pair.First.PriceCentavos == pair.Second.PriceCentavos
            && pair.First.DeliveryDays == pair.Second.DeliveryDays
            && pair.First.RevisionLimit == pair.Second.RevisionLimit)
        && current.Portfolio.Count == desired.Portfolio.Count
        && current.Portfolio.Zip(desired.Portfolio).All(pair =>
            pair.First.Id == pair.Second.Id
            && pair.First.OriginalName == pair.Second.OriginalName
            && pair.First.MimeType == pair.Second.MimeType);

    private static string BuildInitialism(string school) => string.Concat(
        school.Split([' ', '-', '.'], StringSplitOptions.RemoveEmptyEntries)
            .Where(word => word is not ("of" or "the" or "and"))
            .Select(word => char.ToUpperInvariant(word[0])));
}
