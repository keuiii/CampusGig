namespace CampusGig.Mobile.Services;

public static class AccountRefreshRules
{
    public static bool ShouldRefreshForResource(string? resource) =>
        resource is "identity" or "provider-profile" or "services";

    public static bool ProviderAccessWasGranted(
        IEnumerable<string>? previousRoles,
        IEnumerable<string>? currentRoles) =>
        previousRoles?.Contains("PROVIDER", StringComparer.Ordinal) != true &&
        currentRoles?.Contains("PROVIDER", StringComparer.Ordinal) == true;

    public static bool CanReplaceProviderDraft(
        string? savedHeadline,
        string? savedBio,
        string? savedSkills,
        bool savedAvailability,
        string? currentHeadline,
        string? currentBio,
        string? currentSkills,
        bool currentAvailability,
        IEnumerable<string?>? savedLinks = null,
        IEnumerable<string?>? currentLinks = null) =>
        string.Equals(savedHeadline, currentHeadline?.Trim() ?? "", StringComparison.Ordinal) &&
        string.Equals(savedBio, currentBio?.Trim() ?? "", StringComparison.Ordinal) &&
        string.Equals(savedSkills, currentSkills?.Trim() ?? "", StringComparison.Ordinal) &&
        savedAvailability == currentAvailability &&
        NormalizeLinks(savedLinks).SequenceEqual(NormalizeLinks(currentLinks), StringComparer.Ordinal);

    private static IEnumerable<string> NormalizeLinks(IEnumerable<string?>? links) =>
        (links ?? []).Select(link => link?.Trim() ?? "");
}
