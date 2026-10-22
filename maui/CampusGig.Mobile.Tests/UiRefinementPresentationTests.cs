using System.Xml.Linq;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class UiRefinementPresentationTests
{
    [TestMethod]
    public void ListingEditorKeepsLongFormReadableAndResponsive()
    {
        var markup = ReadFixture("ProviderListingEditorPage.xaml");
        var source = ReadFixture("ProviderListingEditorPage.xaml.cs");
        var document = XDocument.Parse(markup);

        Assert.IsTrue(document.Descendants().Any(element => element.Attributes().Any(attribute =>
            attribute.Name.LocalName == "Name" && attribute.Value == "DeliveryLocationGrid")));
        Assert.IsTrue(document.Descendants().Any(element => element.Attributes().Any(attribute =>
            attribute.Name.LocalName == "Name" && attribute.Value == "MediaActionsGrid")));
        StringAssert.Contains(markup, "SizeChanged=\"OnFormRootSizeChanged\"");
        StringAssert.Contains(markup, "AutomationId=\"ListingSectionGuide\"");
        StringAssert.Contains(markup, "x:Name=\"FormProgress\"");
        StringAssert.Contains(markup, "AutomationId=\"ListingDetailsNext\"");
        StringAssert.Contains(markup, "AutomationId=\"ListingPricingNext\"");
        StringAssert.Contains(markup, "AutomationId=\"ListingMediaNext\"");
        StringAssert.Contains(markup, "Padding=\"20,14,20,36\"");
        StringAssert.Contains(markup, "x:Key=\"WizardPrimaryButton\"");
        StringAssert.Contains(markup, "x:Key=\"WizardSecondaryButton\"");
        StringAssert.Contains(markup, "Text=\"Continue to review\"");
        StringAssert.Contains(markup, "Text=\"Submit for review\"");
        StringAssert.Contains(source, "ConfigureNumericFields(editor.NumericFieldsGrid, compact)");
        StringAssert.Contains(source, "FormRoot.Width < 390");
        StringAssert.Contains(source, "FormProgress.ProgressTo");
    }

    [TestMethod]
    public void SharedDisabledActionStateRemainsReadableInBothThemes()
    {
        var resources = ReadFixture("App.xaml");

        StringAssert.Contains(resources, "x:Key=\"DisabledActionStateStyle\"");
        StringAssert.Contains(resources, "Property=\"IsEnabled\" Value=\"False\"");
        StringAssert.Contains(resources, "Light=#D5DEDA, Dark=#2A3731");
        StringAssert.Contains(resources, "Light=#52605A, Dark=#C4CEC9");
        StringAssert.Contains(resources, "Property=\"Opacity\" Value=\"1\"");
    }

    [TestMethod]
    public void ListsReserveBottomSpaceAndProtectLongMetadata()
    {
        var home = ReadFixture("HomePage.xaml");
        var orders = ReadFixture("OrdersPage.xaml");
        var messages = ReadFixture("MessagesPage.xaml");
        var profile = ReadFixture("ProfilePage.xaml");
        var resources = ReadFixture("App.xaml");

        StringAssert.Contains(home, "HeightRequest=\"108\"");
        StringAssert.Contains(home, "Text=\"{Binding ProviderLabel}\"");
        StringAssert.Contains(home, "LineBreakMode=\"TailTruncation\"");
        StringAssert.Contains(orders, "Padding=\"0,4,0,24\"");
        StringAssert.Contains(orders, "MaxLines=\"2\"");
        StringAssert.Contains(messages, "SemanticProperties.Description=\"Unread conversation count\"");
        StringAssert.Contains(messages, "<BoxView HeightRequest=\"24\" BackgroundColor=\"Transparent\" />");
        StringAssert.Contains(resources, "x:Key=\"MainTabHeaderStyle\"");
        StringAssert.Contains(resources, "x:Key=\"MainTabHeaderAccentStyle\"");
        StringAssert.Contains(resources, "x:Key=\"MainTabHeaderSubtitleStyle\"");
        StringAssert.Contains(resources, "Light=#F4F3EC, Dark=#1C2520");
        StringAssert.Contains(home, "x:Name=\"HeroCard\"");
        StringAssert.Contains(home, "Fill=\"{AppThemeBinding Light=#E4EFC0, Dark=#244035}\"");
        foreach (var page in new[] { orders, messages, profile })
        {
            StringAssert.Contains(page, "{StaticResource MainTabHeaderStyle}");
            StringAssert.Contains(page, "{StaticResource MainTabHeaderAccentStyle}");
            StringAssert.Contains(page, "{StaticResource MainTabHeaderSubtitleStyle}");
        }
    }

    [TestMethod]
    public void ListingAndBookingDetailsUseWordWrappingAndRealStatusStates()
    {
        var listings = ReadFixture("ProviderListingsPage.cs");
        var profile = ReadFixture("PublicProviderProfilePage.cs");
        var booking = ReadFixture("ServiceBookingPage.cs");

        StringAssert.Contains(listings, "StatusSummaryItem(publishedCount, \"PUBLISHED\")");
        StringAssert.Contains(listings, "item.Status == \"PENDING_REVIEW\"");
        StringAssert.Contains(listings, "item.Status == \"DRAFT\"");
        StringAssert.Contains(listings, "LineBreakMode = LineBreakMode.WordWrap");
        StringAssert.Contains(profile, "LineBreakMode = LineBreakMode.WordWrap");
        StringAssert.Contains(booking, "LineBreakMode = LineBreakMode.WordWrap");
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
