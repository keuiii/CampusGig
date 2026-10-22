using System.Net;

namespace CampusGig.Mobile.Services;

public static class DownloadRetryRules
{
    public static bool ShouldRenewSignedUrl(
        HttpStatusCode statusCode,
        Uri? finalRequestUri,
        Uri apiBaseUri,
        int attempt)
    {
        if (attempt != 0 || statusCode is not (HttpStatusCode.BadRequest or HttpStatusCode.Forbidden))
            return false;
        if (finalRequestUri is null) return false;
        return !string.Equals(finalRequestUri.Scheme, apiBaseUri.Scheme, StringComparison.OrdinalIgnoreCase) ||
               !string.Equals(finalRequestUri.Host, apiBaseUri.Host, StringComparison.OrdinalIgnoreCase) ||
               finalRequestUri.Port != apiBaseUri.Port;
    }
}
