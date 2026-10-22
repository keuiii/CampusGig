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

    [TestMethod]
    public void ReconciliationRunsOnceAfterEachDisconnectedPeriod()
    {
        var gate = new RealtimeReconciliationGate();

        Assert.IsFalse(gate.ConsumeReconnect());
        gate.MarkDisconnected();
        gate.MarkDisconnected();
        Assert.IsTrue(gate.ConsumeReconnect());
        Assert.IsFalse(gate.ConsumeReconnect());

        gate.MarkDisconnected();
        gate.Reset();
        Assert.IsFalse(gate.ConsumeReconnect());
    }
}
