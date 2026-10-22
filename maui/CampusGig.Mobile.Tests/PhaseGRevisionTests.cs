using System.Text.Json;
using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class PhaseGRevisionTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    [TestMethod]
    public void RevisionContractsPreserveQuotePurchaseDeadlineAndDeliveryAssociation()
    {
        var detail = JsonSerializer.Deserialize<OrderDetail>("""
            {
              "id":"order-1",
              "revisionLimit":1,
              "revisionsUsed":1,
              "revisions":[{
                "id":"revision-2",
                "sequenceNumber":2,
                "type":"PAID_EXTRA",
                "instructions":"Adjust the spacing.",
                "status":"OPEN",
                "sourceDeliverySubmissionId":"delivery-1",
                "revisionDeadlineAt":"2026-10-07T14:00:00Z",
                "turnaroundMinutes":360,
                "purchase":{"id":"purchase-1","providerSubtotalCentavos":7000,"currency":"PHP","paymentStatus":"PAID","activationStatus":"ACTIVATED"}
              }],
              "revisionPurchases":[{
                "id":"purchase-1",
                "sourceDeliverySubmissionId":"delivery-1",
                "providerSubtotalCentavos":7000,
                "platformFeeCentavos":350,
                "totalCentavos":7350,
                "currency":"PHP",
                "turnaroundMinutes":360,
                "pricingPolicyVersion":1,
                "paymentStatus":"PAID",
                "activationStatus":"ACTIVATED"
              }],
              "deliverySubmissions":[{"id":"delivery-2","version":2,"revisionRequestId":"revision-2"}]
            }
            """, JsonOptions);

        Assert.IsNotNull(detail);
        Assert.AreEqual("PAID_EXTRA", detail.Revisions.Single().Type);
        Assert.AreEqual("delivery-1", detail.Revisions.Single().SourceDeliverySubmissionId);
        Assert.AreEqual(360, detail.Revisions.Single().TurnaroundMinutes);
        Assert.AreEqual(7_000, detail.Revisions.Single().Purchase!.ProviderSubtotalCentavos);
        Assert.AreEqual(7_350, detail.RevisionPurchases.Single().TotalCentavos);
        Assert.AreEqual("revision-2", detail.DeliverySubmissions.Single().RevisionRequestId);
    }

    [TestMethod]
    public void QuoteAndEarningContractsPreserveCurrencyAndSourceIdentity()
    {
        var quote = JsonSerializer.Deserialize<ExtraRevisionQuote>("""
            {"revisionType":"PAID_EXTRA","providerSubtotalCentavos":7000,"platformFeeCentavos":350,"clientTotalCentavos":7350,"currency":"USD","turnaroundMinutes":360,"pricingPolicyVersion":1,"pricingBasisCentavos":70000,"deliveryDurationBasisMinutes":720,"sourceOrderId":"order-1","currentDeliverySubmissionId":"delivery-1"}
            """, JsonOptions);
        var earning = JsonSerializer.Deserialize<ProviderEarningItem>("""
            {"id":"earning-2","sourceType":"PAID_EXTRA_REVISION","revisionSequence":2,"amountCentavos":7000,"currency":"PHP","status":"PENDING","pendingAt":"2026-10-07T08:00:00Z"}
            """, JsonOptions);

        Assert.IsNotNull(quote);
        Assert.AreEqual("USD", quote.Currency);
        Assert.AreEqual(350, quote.PlatformFeeCentavos);
        Assert.AreEqual(7_350, quote.ClientTotalCentavos);
        Assert.IsNotNull(earning);
        Assert.AreEqual("PAID EXTRA REVISION #2", earning.SourceLabel);
        Assert.AreEqual("PHP 70.00", earning.AmountLabel);
    }

    [TestMethod]
    public void MobileWorkspaceExposesEquivalentSafeRevisionActionsWithoutRefundOrPayoutControls()
    {
        var layout = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "OrderWorkspacePage.xaml"));
        var source = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "OrderWorkspacePage.xaml.cs"));

        StringAssert.Contains(source, "Request Included Revision");
        StringAssert.Contains(layout, "Purchase Extra Revision");
        StringAssert.Contains(layout, "Ask Provider to Acknowledge");
        StringAssert.Contains(layout, "Need something outside the original requirements?");
        StringAssert.Contains(layout, "Create a new order for additional work.");
        StringAssert.Contains(layout, "Acknowledge");
        StringAssert.Contains(layout, "Decline");
        StringAssert.Contains(source, "payments/revision-quote");
        StringAssert.Contains(source, "payments/revision-checkout");
        StringAssert.Contains(source, "correction-claim");
        StringAssert.Contains(source, "correction-decision");
        StringAssert.Contains(source, "returnTarget = \"MOBILE\"");
        StringAssert.Contains(source, "PendingRevisionPaymentOrderKey");
        StringAssert.Contains(source, "Returning from PayMongo does not confirm payment.");
        StringAssert.Contains(source, "OnOpenDisputeClicked");
        Assert.IsFalse(source.Contains("Partial refund", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(source.Contains("RefundAsync", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(source.Contains("Request payout", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(source.Contains("Withdraw", StringComparison.OrdinalIgnoreCase));
    }
}
