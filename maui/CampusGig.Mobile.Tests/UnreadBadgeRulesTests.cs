using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class UnreadBadgeRulesTests
{
    [TestMethod]
    public void BadgeIsHiddenWhenNothingIsUnread()
    {
        Assert.IsFalse(UnreadBadgeRules.IsVisible(0));
        Assert.AreEqual("", UnreadBadgeRules.Label(0));
        Assert.AreEqual("#E4E9E6", UnreadBadgeRules.Background(0));
        Assert.AreEqual("#66716B", UnreadBadgeRules.Foreground(0));
    }

    [TestMethod]
    public void BadgeCapsCountsAboveNine()
    {
        Assert.IsTrue(UnreadBadgeRules.IsVisible(12));
        Assert.AreEqual("9+", UnreadBadgeRules.Label(12));
        Assert.AreEqual("#DFF2E8", UnreadBadgeRules.Background(12));
        Assert.AreEqual("#08543D", UnreadBadgeRules.Foreground(12));
    }
}
