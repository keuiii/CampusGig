using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class ProviderListingEditorRulesTests
{
    private static readonly ProviderListingPackageInput ValidBasic = new(
        "BASIC",
        true,
        "Basic package",
        "A complete package description for the client.",
        "287.50",
        "3",
        "1");

    [TestMethod]
    public void CompleteDraftProducesExactApiPackageValues()
    {
        var result = ProviderListingEditorRules.Validate(
            "graphic-design",
            "Professional poster design",
            "I will design a polished campus poster and provide the source files.",
            "ONLINE",
            "",
            [ValidBasic]);

        Assert.IsTrue(result.IsValid, string.Join(" | ", result.Errors));
        Assert.HasCount(1, result.Packages);
        Assert.AreEqual(28_750, result.Packages[0].PriceCentavos);
        Assert.AreEqual(3, result.Packages[0].DeliveryDays);
        Assert.AreEqual(1, result.Packages[0].RevisionLimit);
    }

    [TestMethod]
    public void RequiredLengthsAndBasicPackageAreEnforcedBeforeNetworkCall()
    {
        var result = ProviderListingEditorRules.Validate(
            "",
            "Short",
            "Too short",
            "INVALID",
            new string('x', 161),
            [ValidBasic with { Enabled = false }]);

        Assert.IsFalse(result.IsValid);
        CollectionAssert.Contains(result.Errors.ToArray(), "Choose a service category.");
        CollectionAssert.Contains(result.Errors.ToArray(), "The Basic package is required.");
        Assert.IsEmpty(result.Packages);
    }

    [TestMethod]
    public void PackageLimitsMatchTheApiContract()
    {
        var result = ProviderListingEditorRules.Validate(
            "graphic-design",
            "Professional poster design",
            "I will design a polished campus poster and provide the source files.",
            "ONLINE",
            null,
            [ValidBasic with { PricePesos = "0.99", DeliveryDays = "91", RevisionLimit = "21" }]);

        Assert.IsFalse(result.IsValid);
        Assert.IsEmpty(result.Packages);
        Assert.IsTrue(result.Errors.Any(item => item.Contains("price", StringComparison.OrdinalIgnoreCase)));
        Assert.IsTrue(result.Errors.Any(item => item.Contains("delivery", StringComparison.OrdinalIgnoreCase)));
        Assert.IsTrue(result.Errors.Any(item => item.Contains("revisions", StringComparison.OrdinalIgnoreCase)));
    }

    [TestMethod]
    public void PricesRejectSubCentavoPrecisionAndAcceptMaximum()
    {
        Assert.IsFalse(ProviderListingEditorRules.TryPriceCentavos("10.001", out _));
        Assert.IsFalse(ProviderListingEditorRules.TryPriceCentavos("100000.01", out _));
        Assert.IsTrue(ProviderListingEditorRules.TryPriceCentavos("100000", out var maximum));
        Assert.AreEqual(10_000_000, maximum);
    }

    [TestMethod]
    public void SinglePriceTermsConvertWholeDaysToCanonicalMinutes()
    {
        var result = ProviderListingEditorRules.ValidateSinglePrice(
            "graphic-design",
            "Professional poster design",
            "I will design a polished campus poster and provide the source files.",
            "ONLINE",
            null,
            "287.50",
            "3",
            "2");

        Assert.IsTrue(result.IsValid, string.Join(" | ", result.Errors));
        Assert.IsNotNull(result.SinglePrice);
        Assert.AreEqual(28_750, result.SinglePrice.BasePriceCentavos);
        Assert.AreEqual(4320, result.SinglePrice.NormalDeliveryMinutes);
        Assert.AreEqual(2, result.SinglePrice.IncludedRevisionLimit);
        Assert.IsEmpty(result.Packages);
    }

    [TestMethod]
    public void SinglePriceTermsRejectInvalidBounds()
    {
        var result = ProviderListingEditorRules.ValidateSinglePrice(
            "graphic-design",
            "Professional poster design",
            "I will design a polished campus poster and provide the source files.",
            "ONLINE",
            null,
            "0.99",
            "91",
            "21");

        Assert.IsFalse(result.IsValid);
        Assert.IsNull(result.SinglePrice);
        Assert.HasCount(3, result.Errors);
    }

    [TestMethod]
    public void MediaRulesMatchServerAllowList()
    {
        Assert.IsTrue(ProviderListingEditorRules.IsSupportedCover("cover.webp"));
        Assert.IsFalse(ProviderListingEditorRules.IsSupportedCover("cover.pdf"));
        Assert.IsTrue(ProviderListingEditorRules.IsSupportedPortfolio("sample.pdf"));
        Assert.IsFalse(ProviderListingEditorRules.IsSupportedPortfolio("sample.docx"));
        Assert.AreEqual("image/jpeg", ProviderListingEditorRules.MediaContentType("photo.JPG"));
        Assert.AreEqual("application/pdf", ProviderListingEditorRules.MediaContentType("work.pdf"));
    }

    [TestMethod]
    public void OnlyDraftAndRejectedListingsCanOpenTheEditor()
    {
        Assert.IsTrue(ProviderListingEditorRules.CanEdit("DRAFT"));
        Assert.IsTrue(ProviderListingEditorRules.CanEdit("REJECTED"));
        Assert.IsFalse(ProviderListingEditorRules.CanEdit("PENDING_REVIEW"));
        Assert.IsFalse(ProviderListingEditorRules.CanEdit("PUBLISHED"));
    }
}
