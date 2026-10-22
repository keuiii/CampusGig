using System.Xml.Linq;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class HomePresentationMarkupTests
{
    [TestMethod]
    public void PreferredSchoolChipsUseLeftAlignedCompactLayout()
    {
        var homePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "HomePage.xaml");
        var document = XDocument.Load(homePath);
        var schoolList = document
            .Descendants()
            .Single(element => element.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "SchoolList"));

        Assert.AreEqual("Start", schoolList.Attribute("HorizontalOptions")?.Value);
        Assert.AreEqual("20,0", schoolList.Attribute("Margin")?.Value);
        Assert.AreEqual("Never", schoolList.Attribute("HorizontalScrollBarVisibility")?.Value);
        Assert.AreEqual("40", schoolList.Attribute("HeightRequest")?.Value);

        var schoolChip = FindNamedElement(document, "SchoolChip");
        Assert.AreEqual("13,6", schoolChip.Attribute("Padding")?.Value);
        Assert.AreEqual("36", schoolChip.Attribute("MinimumHeightRequest")?.Value);
        Assert.AreEqual("Center", schoolChip.Attribute("VerticalOptions")?.Value);

        var schoolChipLabel = FindNamedElement(document, "SchoolChipLabel");
        Assert.AreEqual("Center", schoolChipLabel.Attribute("HorizontalTextAlignment")?.Value);
        Assert.AreEqual("Center", schoolChipLabel.Attribute("VerticalTextAlignment")?.Value);

        var selectedState = document
            .Descendants()
            .Single(element => element.Name.LocalName == "VisualState" &&
                element.Attribute("Name")?.Value == "Selected");
        var selectedSetters = selectedState.Descendants()
            .Where(element => element.Name.LocalName == "Setter")
            .ToArray();
        Assert.IsTrue(selectedSetters.Any(setter =>
            setter.Attribute("Property")?.Value == "BackgroundColor" &&
            setter.Attribute("Value")?.Value == "#DFF2E8"));
        Assert.IsTrue(selectedSetters.Any(setter =>
            setter.Attribute("TargetName")?.Value == "SchoolChipLabel" &&
            setter.Attribute("Property")?.Value == "Label.TextColor" &&
            setter.Attribute("Value")?.Value == "#08543D"));
    }

    [TestMethod]
    public void DiscoverUsesVectorActionsAndClearMarketplaceHierarchy()
    {
        var homePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "HomePage.xaml");
        var document = XDocument.Load(homePath);
        var markup = File.ReadAllText(homePath);

        Assert.IsTrue(document.Descendants().Any(element =>
            element.Attribute("AutomationId")?.Value == "NotificationsBell"));
        Assert.IsTrue(document.Descendants().Any(element =>
            element.Attribute("AutomationId")?.Value == "NotificationBellIcon"));
        Assert.IsTrue(document.Descendants().Any(element => element.Name.LocalName == "Path"));
        StringAssert.Contains(markup, "PriceContextLabel");
        StringAssert.Contains(markup, "PriceAmountLabel");
        StringAssert.Contains(markup, "IsFixedPrice");
        StringAssert.Contains(markup, "SemanticProperties.Description=\"Fixed price\"");
        StringAssert.Contains(markup, "RatingLabel");
        StringAssert.Contains(markup, "DeliveryLabel");
        StringAssert.Contains(markup, "ShowCoverPlaceholder");
        StringAssert.Contains(markup, "SelectionMode=\"None\"");
        StringAssert.Contains(markup, "Tapped=\"OnCategoryTapped\"");
        StringAssert.Contains(markup, "AutomationId=\"MarketplaceFiltersButton\"");
        StringAssert.Contains(markup, "AutomationId=\"BudgetRangeFilter\"");
        StringAssert.Contains(markup, "AutomationId=\"MinimumRatingFilter\"");
        StringAssert.Contains(markup, "AutomationId=\"MaximumDeliveryFilter\"");
        StringAssert.Contains(markup, "AutomationId=\"MarketplaceSortFilter\"");
        StringAssert.Contains(markup, "AutomationId=\"RetryMarketplaceButton\"");
        StringAssert.Contains(markup, "AutomationId=\"ClearServiceSearch\"");
        StringAssert.Contains(markup, "Clicked=\"OnClearSearchClicked\"");
        StringAssert.Contains(
            File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "HomePage.xaml.cs")),
            "ClearSearchButton.IsVisible = !string.IsNullOrWhiteSpace(e.NewTextValue)");
        Assert.IsNotNull(FindNamedElement(document, "LoadingServices"));
        StringAssert.Contains(markup, "Kind=\"Service\"");
        Assert.IsNotNull(FindNamedElement(document, "EmptyServicesTitle"));
        Assert.IsNotNull(FindNamedElement(document, "EmptyServicesDescription"));
        Assert.IsFalse(markup.Contains("OnCategorySelected", StringComparison.Ordinal));
    }

    [TestMethod]
    public void SavedAndFilterActionsUseOneToolbarTreatment()
    {
        var homePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "HomePage.xaml");
        var document = XDocument.Load(homePath);
        var saved = FindNamedElement(document, "SavedServicesButton");
        var filters = FindNamedElement(document, "MarketplaceFiltersButton");

        foreach (var attribute in new[] { "HeightRequest", "Padding", "CornerRadius", "FontSize", "BackgroundColor", "TextColor" })
            Assert.AreEqual(saved.Attribute(attribute)?.Value, filters.Attribute(attribute)?.Value, attribute);
    }

    private static XElement FindNamedElement(XDocument document, string name) => document
        .Descendants()
        .Single(element => element.Attributes().Any(attribute =>
            attribute.Name.LocalName == "Name" && attribute.Value == name));
}
