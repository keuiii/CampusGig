namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class GuestBrowsingMarkupTests
{
    [TestMethod]
    public void AuthenticationScreenOffersAnExplicitGuestEntryPoint()
    {
        var markup = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "AuthPage.xaml"));

        StringAssert.Contains(markup, "AutomationId=\"BrowseAsGuestButton\"");
        StringAssert.Contains(markup, "Text=\"Browse as guest\"");
        StringAssert.Contains(markup, "Clicked=\"OnBrowseAsGuestClicked\"");
    }
}
