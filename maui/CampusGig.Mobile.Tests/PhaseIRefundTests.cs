using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class PhaseIRefundTests
{
    [TestMethod]
    public void PendingAndReconciliationStatesNeverClaimSuccess()
    {
        var pending = new RefundEligibility
        {
            Refund = new MarketplaceRefund { Status = "PROCESSING" },
        };
        var reconciliation = new RefundEligibility
        {
            Refund = new MarketplaceRefund { Status = "RECONCILIATION_REQUIRED" },
        };

        Assert.IsTrue(RefundPresentation.IsPending(pending.Refund));
        StringAssert.Contains(RefundPresentation.Guidance(pending), "processes");
        StringAssert.Contains(RefundPresentation.Guidance(reconciliation), "Do not submit another request");
        Assert.IsFalse(RefundPresentation.Guidance(pending).Contains("completed", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public void SuccessAndEligibilityCopyDescribeOneFullRefund()
    {
        var succeeded = new RefundEligibility
        {
            Refund = new MarketplaceRefund { Status = "SUCCEEDED" },
        };
        var rush = new RefundEligibility
        {
            CanRequest = true,
            EligibleReasons = ["MISSED_RUSH_DEADLINE"],
        };

        StringAssert.Contains(RefundPresentation.Guidance(succeeded), "including the CampusGig service fee");
        Assert.AreEqual("Request full rush refund", RefundPresentation.ActionLabel(rush));
    }

    [TestMethod]
    public void WorkspaceUsesServerEligibilityAndHasNoPartialOrPayoutAction()
    {
        var layout = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrderWorkspacePage.xaml"));
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrderWorkspacePage.xaml.cs"));

        StringAssert.Contains(layout, "RefundRequestButton");
        StringAssert.Contains(source, "payments/refund-eligibility");
        StringAssert.Contains(source, "payments/refunds");
        StringAssert.Contains(source, "including the CampusGig service fee");
        Assert.IsFalse(source.Contains("Partial refund", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(source.Contains("Request payout", StringComparison.OrdinalIgnoreCase));
    }
}
