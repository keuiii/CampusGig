using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class ProviderListingLifecycleRulesTests
{
    [TestMethod]
    public void DraftAndRejectedListingsCanBeEditedAndSubmittedOnMobile()
    {
        CollectionAssert.AreEqual(
            new[] { "preview", "edit", "submit" },
            ProviderListingLifecycleRules.Actions("DRAFT").ToArray());
        CollectionAssert.AreEqual(
            new[] { "preview", "edit", "submit" },
            ProviderListingLifecycleRules.Actions("REJECTED").ToArray());
        StringAssert.Contains(ProviderListingLifecycleRules.StatusCopy("DRAFT"), "administrator review");
        StringAssert.Contains(ProviderListingLifecycleRules.StatusCopy("REJECTED"), "feedback");
    }

    [TestMethod]
    public void PublishedAndPausedListingsCanStartAModeratedRevision()
    {
        CollectionAssert.AreEqual(
            new[] { "preview", "edit", "pause", "archive" },
            ProviderListingLifecycleRules.Actions("PUBLISHED").ToArray());
        CollectionAssert.AreEqual(
            new[] { "preview", "edit", "resume", "archive" },
            ProviderListingLifecycleRules.Actions("PAUSED").ToArray());
        StringAssert.Contains(
            ProviderListingLifecycleRules.StatusCopy("PUBLISHED"),
            "private draft");
    }

    [TestMethod]
    public void ArchivedListingsRestoreWithoutAutomaticPublication()
    {
        CollectionAssert.AreEqual(
            new[] { "preview", "restore" },
            ProviderListingLifecycleRules.Actions("ARCHIVED").ToArray());
        StringAssert.Contains(
            ProviderListingLifecycleRules.StatusCopy("ARCHIVED"),
            "hidden");
    }

    [TestMethod]
    public void UnknownTransitionCannotBecomeAnApiPath()
    {
        Assert.ThrowsExactly<ArgumentOutOfRangeException>(() =>
            ProviderListingLifecycleRules.EndpointAction("publish"));
    }
}
