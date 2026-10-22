using System.Net;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class DownloadRetryRulesTests
{
    private static readonly Uri ApiBase = new("https://api.campusgig.example");

    [TestMethod]
    public void ExpiredExternalSignedUrlIsRenewedOnce()
    {
        var storageUri = new Uri("https://campusgig.s3.ap-southeast-1.amazonaws.com/file");

        Assert.IsTrue(DownloadRetryRules.ShouldRenewSignedUrl(
            HttpStatusCode.Forbidden, storageUri, ApiBase, 0));
        Assert.IsTrue(DownloadRetryRules.ShouldRenewSignedUrl(
            HttpStatusCode.BadRequest, storageUri, ApiBase, 0));
        Assert.IsFalse(DownloadRetryRules.ShouldRenewSignedUrl(
            HttpStatusCode.Forbidden, storageUri, ApiBase, 1));
    }

    [TestMethod]
    public void ApiAuthorizationFailuresAreNeverMisclassifiedAsExpiredStorageLinks()
    {
        Assert.IsFalse(DownloadRetryRules.ShouldRenewSignedUrl(
            HttpStatusCode.Forbidden,
            new Uri("https://api.campusgig.example/orders/file"),
            ApiBase,
            0));
        Assert.IsFalse(DownloadRetryRules.ShouldRenewSignedUrl(
            HttpStatusCode.Unauthorized,
            new Uri("https://storage.example/file"),
            ApiBase,
            0));
    }
}
