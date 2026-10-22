using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class MarketplaceFilterRulesTests
{
    [TestMethod]
    public void ServicePagePathPreservesAllFiltersAndEncodesSearch()
    {
        var path = MarketplaceLoadRules.BuildServicePagePath(
            " logo   &   art ", "Graphic Design", "school-id", MarketplaceBudgetRange.From500To999,
            4.5, 3, MarketplaceSort.PriceLowToHigh, 2);

        Assert.AreEqual(
            "services?page=2&sort=price-low&query=logo%20%26%20art&category=Graphic%20Design&schoolId=school-id&budgetRange=500-999&minimumRating=4.5&maximumDeliveryDays=3",
            path);
    }

    [TestMethod]
    public void SavedServicePageUsesPrivateEndpointAndKeepsFilters()
    {
        var path = MarketplaceLoadRules.BuildServicePagePath(
            "logo", "Graphic Design", "", MarketplaceBudgetRange.Any,
            0, null, MarketplaceSort.Newest, 2, savedOnly: true);

        Assert.AreEqual("services/saved?page=2&sort=newest&query=logo&category=Graphic%20Design", path);
    }

    [TestMethod]
    public void AdvancedFiltersAreCombined()
    {
        var services = new[]
        {
            Service("match", 500, 4.8, 2, new DateTimeOffset(2026, 9, 25, 0, 0, 0, TimeSpan.Zero)),
            Service("expensive", 900, 5, 1, new DateTimeOffset(2026, 9, 24, 0, 0, 0, TimeSpan.Zero)),
            Service("slow", 400, 4.9, 7, new DateTimeOffset(2026, 9, 23, 0, 0, 0, TimeSpan.Zero))
        };

        var result = MarketplaceLoadRules.FilterAndSortServices(
            services, "match", "bsu", "Programming", MarketplaceBudgetRange.From500To999, 4.5, 3, MarketplaceSort.Recommended);

        Assert.HasCount(1, result);
        Assert.AreEqual("match", result[0].Id);
    }

    [TestMethod]
    public void BudgetRangesAssignEveryBoundaryToExactlyOneChoice()
    {
        Assert.IsTrue(MarketplaceLoadRules.MatchesBudgetRange(499, MarketplaceBudgetRange.Under500));
        Assert.IsFalse(MarketplaceLoadRules.MatchesBudgetRange(500, MarketplaceBudgetRange.Under500));
        Assert.IsTrue(MarketplaceLoadRules.MatchesBudgetRange(500, MarketplaceBudgetRange.From500To999));
        Assert.IsTrue(MarketplaceLoadRules.MatchesBudgetRange(999, MarketplaceBudgetRange.From500To999));
        Assert.IsFalse(MarketplaceLoadRules.MatchesBudgetRange(1_000, MarketplaceBudgetRange.From500To999));
        Assert.IsTrue(MarketplaceLoadRules.MatchesBudgetRange(1_000, MarketplaceBudgetRange.From1000To2499));
        Assert.IsTrue(MarketplaceLoadRules.MatchesBudgetRange(2_499, MarketplaceBudgetRange.From1000To2499));
        Assert.IsTrue(MarketplaceLoadRules.MatchesBudgetRange(2_500, MarketplaceBudgetRange.From2500To4999));
        Assert.IsTrue(MarketplaceLoadRules.MatchesBudgetRange(4_999, MarketplaceBudgetRange.From2500To4999));
        Assert.IsTrue(MarketplaceLoadRules.MatchesBudgetRange(5_000, MarketplaceBudgetRange.From5000));
    }

    [TestMethod]
    public void SortOptionsUseAuthoritativeServiceValues()
    {
        var services = new[]
        {
            Service("middle", 500, 4.5, 3, new DateTimeOffset(2026, 9, 24, 0, 0, 0, TimeSpan.Zero)),
            Service("best", 700, 5, 5, new DateTimeOffset(2026, 9, 23, 0, 0, 0, TimeSpan.Zero)),
            Service("new", 300, 4, 1, new DateTimeOffset(2026, 9, 25, 0, 0, 0, TimeSpan.Zero))
        };

        CollectionAssert.AreEqual(
            new[] { "best", "middle", "new" },
            Ids(services, MarketplaceSort.Rating));
        CollectionAssert.AreEqual(
            new[] { "new", "middle", "best" },
            Ids(services, MarketplaceSort.PriceLowToHigh));
        CollectionAssert.AreEqual(
            new[] { "new", "middle", "best" },
            Ids(services, MarketplaceSort.DeliveryFastest));
        CollectionAssert.AreEqual(
            new[] { "new", "middle", "best" },
            Ids(services, MarketplaceSort.Newest));
    }

    private static string[] Ids(IEnumerable<ServiceItem> services, MarketplaceSort sort) =>
        MarketplaceLoadRules.FilterAndSortServices(services, "", "", null, MarketplaceBudgetRange.Any, 0, null, sort)
            .Select(service => service.Id)
            .ToArray();

    private static ServiceItem Service(
        string id,
        int price,
        double rating,
        int deliveryDays,
        DateTimeOffset publishedAt) => new()
    {
        Id = id,
        Title = $"{id} service",
        Provider = $"{id} provider",
        Category = "Programming",
        School = "Batangas State University",
        SchoolId = "bsu",
        Price = price,
        Rating = rating,
        PublishedAt = publishedAt,
        Packages =
        [
            new ServicePackage
            {
                Id = $"{id}-package",
                PriceCentavos = price * 100,
                DeliveryDays = deliveryDays
            }
        ]
    };
}
