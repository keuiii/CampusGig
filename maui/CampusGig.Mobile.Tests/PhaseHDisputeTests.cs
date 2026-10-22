using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class PhaseHDisputeTests
{
    [TestMethod]
    public void ActiveStatesAndExpectedPartyControlResponse()
    {
        var dispute = new OrderDispute
        {
            Status = "WAITING_FOR_PROVIDER",
            ResponseRequestedFrom = "PROVIDER",
        };

        Assert.IsTrue(DisputePresentation.IsActive(dispute));
        Assert.IsTrue(DisputePresentation.CanRespond(dispute, true));
        Assert.IsFalse(DisputePresentation.CanRespond(dispute, false));

        dispute.Status = "READY_FOR_REVIEW";
        Assert.IsTrue(DisputePresentation.IsActive(dispute));
        Assert.IsFalse(DisputePresentation.CanRespond(dispute, true));
    }

    [TestMethod]
    public void ClientOutcomeNeverClaimsThatARefundOccurred()
    {
        var label = DisputePresentation.FinancialLabel(new OrderDispute
        {
            Status = "RESOLVED_CLIENT",
        });

        StringAssert.Contains(label, "remains frozen");
        StringAssert.Contains(label, "no refund has been issued");
    }

    [TestMethod]
    public void DeadlineCopySaysNoWinnerIsAutomatic()
    {
        var deadline = new DateTimeOffset(2026, 10, 9, 12, 0, 0, TimeSpan.Zero);
        var label = DisputePresentation.DeadlineLabel(
            new OrderDispute { ResponseDeadlineAt = deadline },
            deadline.AddHours(-1));

        StringAssert.Contains(label, "Respond by");
        StringAssert.Contains(label, "No winner is selected automatically");
    }

    [TestMethod]
    public void WorkspaceDocumentsSecureWebOnlyEvidenceLimitationAndNoPayout()
    {
        var layout = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "OrderWorkspacePage.xaml"));
        var source = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "OrderWorkspacePage.xaml.cs"));

        StringAssert.Contains(layout, "DISPUTE PROTECTION");
        StringAssert.Contains(layout, "Evidence upload and secure evidence downloads are currently available on CampusGig Web");
        StringAssert.Contains(source, "orders/{orderId}/disputes");
        StringAssert.Contains(source, "OnSubmitDisputeResponseClicked");
        Assert.IsFalse(layout.Contains("Withdraw", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(source.Contains("Partial refund", StringComparison.OrdinalIgnoreCase));
    }
}
