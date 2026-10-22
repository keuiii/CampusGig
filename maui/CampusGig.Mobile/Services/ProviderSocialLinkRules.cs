namespace CampusGig.Mobile.Services;

public static class ProviderSocialLinkRules
{
    public static bool IsValid(string platform, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttps)
            return false;

        var hosts = platform switch
        {
            "instagram" => new[] { "instagram.com" },
            "linkedin" => new[] { "linkedin.com" },
            "x" => new[] { "x.com", "twitter.com" },
            "portfolio" => [],
            _ => null,
        };
        return hosts is not null && (hosts.Length == 0 || hosts.Any(host =>
            uri.Host.Equals(host, StringComparison.OrdinalIgnoreCase) ||
            uri.Host.EndsWith($".{host}", StringComparison.OrdinalIgnoreCase)));
    }

    public static bool CanOpen(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps;
}
