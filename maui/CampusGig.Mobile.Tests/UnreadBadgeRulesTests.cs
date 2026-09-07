using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class UnreadBadgeRulesTests
{
    [TestMethod]
    public void BadgeIsHiddenWhenNothingIsUnread()
    {
        Assert.IsFalse(UnreadBadgeRules.IsVisible(0));
        Assert.AreEqual("0", UnreadBadgeRules.Label(0));
    }

    [TestMethod]
    public void BadgeCapsCountsAboveNine()
    {
        Assert.IsTrue(UnreadBadgeRules.IsVisible(12));
        Assert.AreEqual("9+", UnreadBadgeRules.Label(12));
    }
}
