namespace CampusGig.Mobile.Services;

public static class ProfileImageRules
{
    public static bool CanDisplay(bool hasAvatar, string? userId) =>
        hasAvatar && !string.IsNullOrWhiteSpace(userId);

    public static string BuildUrl(string apiBaseUrl, string userId, long cacheVersion) =>
        $"{apiBaseUrl.TrimEnd('/')}/profile/avatar/{Uri.EscapeDataString(userId)}?v={cacheVersion}";
}
