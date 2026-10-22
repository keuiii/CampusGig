using System.Reflection;

namespace CampusGig.Mobile.Services;

public static class ApiEndpointRules
{
    public const string EmulatorAndroidUrl = "http://10.0.2.2:4000/api/v1";
    public const string LocalDeviceUrl = "http://localhost:4000/api/v1";

    public static string DevelopmentUrl(bool isAndroid, bool isVirtualDevice) =>
        isAndroid && isVirtualDevice ? EmulatorAndroidUrl : LocalDeviceUrl;

    public static string Resolve(
        string? configuredBuildUrl,
        bool isAndroid,
        bool isVirtualDevice,
        bool requireHttps = true)
    {
        if (string.IsNullOrWhiteSpace(configuredBuildUrl))
            return DevelopmentUrl(isAndroid, isVirtualDevice);

        var candidate = configuredBuildUrl.Trim().TrimEnd('/');
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException(
                "CampusGigApiBaseUrl must be an absolute HTTP or HTTPS URL.");
        if (requireHttps && uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException(
                "CampusGigApiBaseUrl must use HTTPS outside local development.");

        return candidate;
    }

    public static string? ConfiguredBuildUrl() =>
        typeof(ApiEndpointRules).Assembly
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(attribute =>
                string.Equals(attribute.Key, "CampusGigApiBaseUrl", StringComparison.Ordinal))
            ?.Value;
}
