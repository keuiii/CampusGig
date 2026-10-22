using System.Text.Json;
using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class ProviderEarningsTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    [TestMethod]
    public void ProviderEarningsContractsDeserializeSummaryAndImmutableHistory()
    {
        const string summaryJson = """
            {"data":[{"currency":"PHP","pendingCentavos":25000,"availableCentavos":0,"withdrawableCentavos":0,"frozenCentavos":0,"payoutProcessingCentavos":0,"paidOutCentavos":0,"refundedCentavos":0}]}
            """;
        const string historyJson = """
            {"data":[{"id":"earning-1","orderId":"order-1","orderNumber":"CG-1","serviceTitle":"Campus poster","sourceType":"ORIGINAL_ORDER","amountCentavos":25000,"currency":"PHP","status":"PENDING","pendingAt":"2026-10-05T04:00:00Z","createdAt":"2026-10-05T04:00:00Z","entries":[{"type":"EARNING_PENDING_CREDIT","amountCentavos":25000,"currency":"PHP","createdAt":"2026-10-05T04:00:00Z"}]}],"pagination":{"hasMore":false,"nextCursor":null}}
            """;

        var summary = JsonSerializer.Deserialize<ApiResult<List<ProviderEarningsSummaryItem>>>(summaryJson, JsonOptions);
        var history = JsonSerializer.Deserialize<ApiList<ProviderEarningItem>>(historyJson, JsonOptions);

        Assert.IsNotNull(summary);
        Assert.AreEqual(25_000, summary.Data.Single().PendingCentavos);
        Assert.AreEqual(0, summary.Data.Single().AvailableCentavos);
        Assert.IsNotNull(history);
        Assert.AreEqual("Campus poster", history.Data.Single().ServiceTitle);
        Assert.AreEqual("PENDING", history.Data.Single().StatusLabel);
        Assert.AreEqual("ORIGINAL ORDER EARNING", history.Data.Single().SourceLabel);
        Assert.AreEqual("EARNING_PENDING_CREDIT", history.Data.Single().Entries.Single().Type);
        Assert.AreEqual("PHP 250.00", history.Data.Single().AmountLabel);
    }

    [TestMethod]
    public void ProviderEarningsPresentationHandlesZeroAndCurrencyNormalization()
    {
        Assert.AreEqual("PHP 0.00", ProviderEarningsPresentation.FormatAmount(0, "php"));
        Assert.AreEqual("USD 123.45", ProviderEarningsPresentation.FormatAmount(12_345, "USD"));
        Assert.AreEqual("123.45", ProviderEarningsPresentation.FormatAmount(12_345, ""));
    }

    [TestMethod]
    public void ProviderEarningsPageExposesSafePayoutParity()
    {
        var source = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "ProviderEarningsPage.cs"));

        StringAssert.Contains(source, "provider/earnings/summary");
        StringAssert.Contains(source, "provider/earnings?limit=50");
        StringAssert.Contains(source, "ProviderEarningsZeroState");
        StringAssert.Contains(source, "ProviderEarningsSummaryZeroState");
        StringAssert.Contains(source, "ProviderEarningItem.SourceLabel");
        StringAssert.Contains(source, "provider/payouts/destinations");
        StringAssert.Contains(source, "provider/payouts");
        StringAssert.Contains(source, "Withdraw all eligible");
        StringAssert.Contains(source, "MaskedAccountIdentifier");
        StringAssert.Contains(source, "This status does not mean money was sent");
        StringAssert.Contains(source, "Color.FromArgb(row.WithdrawableCentavos > 0 ? \"#0F6B4F\" : \"#D5DEDA\")");
        StringAssert.Contains(source, "AutomationId = \"AddPayoutDestination\"");
        Assert.IsFalse(source.Contains("amountCentavos = row.WithdrawableCentavos", StringComparison.Ordinal));
    }
}
