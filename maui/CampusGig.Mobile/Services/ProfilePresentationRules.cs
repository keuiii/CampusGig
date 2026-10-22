namespace CampusGig.Mobile.Services;

public static class ProfilePresentationRules
{
    public static bool IsClientOnly(IReadOnlyCollection<string>? roles) =>
        roles is null || roles.Count == 0 || roles.All(role => role == "CLIENT");

    public static bool ShowsProviderJourney(IReadOnlyCollection<string>? roles) =>
        roles?.Any(role => role is "STUDENT" or "PROVIDER") == true;

    public static bool ShowsVerifiedProviderBadge(bool isProvider, bool verified, int profileStrength) =>
        isProvider && verified && profileStrength >= 100;
}
