using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class RealtimeConnectionPolicyTests
{
    [TestMethod]
    public void InitialConnectionIsBoundedForResponsiveNavigation()
    {
        Assert.IsLessThanOrEqualTo(TimeSpan.FromSeconds(3), RealtimeConnectionPolicy.InitialConnectTimeout);
        Assert.IsGreaterThan(0, RealtimeConnectionPolicy.ReconnectionAttempts);
        Assert.IsLessThanOrEqualTo(4, RealtimeConnectionPolicy.ReconnectionAttempts);
        Assert.IsLessThanOrEqualTo(3000, RealtimeConnectionPolicy.MaximumReconnectionDelayMilliseconds);
    }
}
