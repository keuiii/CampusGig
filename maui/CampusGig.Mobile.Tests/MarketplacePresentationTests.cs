using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class MarketplacePresentationTests
{
    [TestMethod]
    [DataRow("REQUIRES_ACTION", "Awaiting payment")]
    [DataRow("RECONCILIATION_REQUIRED", "Needs review")]
    [DataRow("REVISION_REQUESTED", "Revision requested")]
    [DataRow("IN_PROGRESS", "In Progress")]
    public void StatusLabelUsesReadableMarketplaceLanguage(string status, string expected) =>
        Assert.AreEqual(expected, MarketplacePresentation.StatusLabel(status));

    [TestMethod]
    public void MissingStatusHasSafeFallback() =>
        Assert.AreEqual("Not available", MarketplacePresentation.StatusLabel(null));
}
