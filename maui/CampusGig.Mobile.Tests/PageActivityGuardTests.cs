using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class PageActivityGuardTests
{
    [TestMethod]
    public void ResultCanUpdateOnlyWhileItsPageGenerationIsActive()
    {
        var guard = new PageActivityGuard();

        guard.Activate();
        var firstVisit = guard.Capture();
        Assert.IsTrue(guard.CanUpdate(firstVisit));

        guard.Deactivate();
        Assert.IsFalse(guard.CanUpdate(firstVisit));

        guard.Activate();
        Assert.IsFalse(guard.CanUpdate(firstVisit));
        Assert.IsTrue(guard.CanUpdate(guard.Capture()));
    }
}
