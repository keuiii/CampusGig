namespace CampusGig.Mobile.Services;

public static class MarketplaceLoadRules
{
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

    private static string BuildInitialism(string school) => string.Concat(
        school.Split([' ', '-', '.'], StringSplitOptions.RemoveEmptyEntries)
            .Where(word => word is not ("of" or "the" or "and"))
            .Select(word => char.ToUpperInvariant(word[0])));
}
