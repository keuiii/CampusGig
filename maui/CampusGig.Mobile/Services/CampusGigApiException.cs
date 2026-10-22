using System.Net;

namespace CampusGig.Mobile.Services;

public sealed class CampusGigApiException : Exception
{
    public CampusGigApiException(string message, HttpStatusCode? statusCode = null) : base(message)
    {
        StatusCode = statusCode;
    }

    public HttpStatusCode? StatusCode { get; }
    public bool IsUnauthorized => StatusCode == HttpStatusCode.Unauthorized;
}
