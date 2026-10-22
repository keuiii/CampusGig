using System.Text.Json;
using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class PhaseCMarketplaceTests
{
    [TestMethod]
    public void SinglePriceRushValidation_RequiresEligibleTypedTier()
    {
        var valid = ProviderListingEditorRules.ValidateSinglePrice(
            "category", new string('T', 10), new string('D', 50), "ONLINE", null,
            "500", "3", "2", true, "HOURS_6");
        Assert.IsTrue(valid.IsValid);
        Assert.AreEqual(50000, valid.SinglePrice!.BasePriceCentavos);
        Assert.IsTrue(valid.SinglePrice.AcceptsRushOrders);
        Assert.AreEqual("HOURS_6", valid.SinglePrice.FastestRushTier);

        var invalid = ProviderListingEditorRules.ValidateSinglePrice(
            "category", new string('T', 10), new string('D', 50), "ONLINE", null,
            "500", "1", "2", true, "HOURS_24");
        Assert.IsFalse(invalid.IsValid);
    }

    [TestMethod]
    public void QuoteContract_DeserializesAuthoritativeBreakdown()
    {
        const string json = """
        {"pricingModel":"SINGLE_PRICE_V2","currency":"PHP","basePriceCentavos":50000,"deliveryOption":"RUSH_6_HOURS","deliveryDurationMinutes":360,"rushSurchargeCentavos":20000,"providerServiceSubtotalCentavos":70000,"platformFeeCentavos":3500,"clientTotalCentavos":73500,"platformFeeBasisPoints":500,"rushBasisPoints":4000,"pricingPolicyVersion":1,"eligibleDeliveryOptions":["NORMAL","RUSH_6_HOURS"]}
        """;
        var quote = JsonSerializer.Deserialize<MarketplaceQuote>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
        Assert.IsNotNull(quote);
        Assert.AreEqual(73500, quote.ClientTotalCentavos);
        CollectionAssert.Contains(quote.EligibleDeliveryOptions, "RUSH_6_HOURS");
    }

    [TestMethod]
    public void V2OrderContract_AllowsPendingDeadlineAndNoPackage()
    {
        const string json = """
        {"id":"order","pricingModel":"SINGLE_PRICE_V2","orderNumber":"CG-1","title":"Service","status":"ACCEPTED","requirements":"Complete requirements","totalCentavos":52500,"currency":"PHP","dueAt":null,"package":null,"deliveryOption":"NORMAL","deliveryDurationMinutes":1440,"provider":{},"client":{},"createdAt":"2026-10-05T00:00:00Z"}
        """;
        var order = JsonSerializer.Deserialize<OrderItem>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
        Assert.IsNotNull(order);
        Assert.IsNull(order.DueAt);
        Assert.IsNull(order.Package);
        Assert.AreEqual("Starts after payment", order.DeliveryDateLabel);
    }

    [TestMethod]
    public void PhaseCPages_ContainRushQuoteAndDeadlinePresentation()
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CampusGig.Mobile"));
        var booking = File.ReadAllText(Path.Combine(root, "Pages", "ServiceBookingPage.cs"));
        var editor = File.ReadAllText(Path.Combine(root, "Pages", "ProviderListingEditorPage.xaml"));
        var workspace = File.ReadAllText(Path.Combine(root, "Pages", "OrderWorkspacePage.xaml.cs"));
        StringAssert.Contains(booking, "services/{service.Id}/quote");
        StringAssert.Contains(booking, "\"Service fee\"");
        StringAssert.Contains(booking, "BasisPointsPercent(quote.PlatformFeeBasisPoints)");
        Assert.IsFalse(booking.Contains("CampusGig service fee", StringComparison.Ordinal));
        StringAssert.Contains(editor, "ListingAcceptsRush");
        StringAssert.Contains(workspace, "Starts after payment confirmation");
    }

    [TestMethod]
    public void SinglePriceServicesOpenTheExistingAuthoritativeBookingFlow()
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CampusGig.Mobile"));
        var home = File.ReadAllText(Path.Combine(root, "Pages", "HomePage.xaml.cs"));
        var profile = File.ReadAllText(Path.Combine(root, "Pages", "PublicProviderProfilePage.cs"));
        var booking = File.ReadAllText(Path.Combine(root, "Pages", "ServiceBookingPage.cs"));

        Assert.IsFalse(home.Contains("Booking for single-price listings is not available yet.", StringComparison.Ordinal));
        Assert.IsFalse(profile.Contains("Booking for single-price listings is not available yet.", StringComparison.Ordinal));
        StringAssert.Contains(home, "new ServiceBookingPage(api, realtime, session, service)");
        StringAssert.Contains(profile, "new ServiceBookingPage(api, realtime, session, service)");
        StringAssert.Contains(booking, "EligibleDeliveryOptions");
        StringAssert.Contains(booking, "quote.ClientTotalCentavos");
        StringAssert.Contains(booking, "deliveryOption = selectedDeliveryOption");
        StringAssert.Contains(booking, "requirements.TextChanged");
        StringAssert.Contains(booking, "if (PricingModelRules.IsSinglePriceV2(service.PricingModel))");
        StringAssert.Contains(booking, "RenderV2Summary();");
    }
}
