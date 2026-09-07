using System.Net;

namespace CampusGig.Mobile.Services;

public static class AuthorizationFailureRules
{
    public static bool ShouldClearSession(HttpStatusCode statusCode, bool requestHadBearerToken) =>
        statusCode == HttpStatusCode.Unauthorized && requestHadBearerToken;
}
