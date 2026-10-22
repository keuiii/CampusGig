namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class NavigationPresentationMarkupTests
{
    [TestMethod]
    public void BackControlsUseTheSamePlainLessThanAndDestinationPattern()
    {
        StringAssert.Contains(ReadFixture("AuthPage.xaml"), "Text=\"&lt; Back to login\"");
        StringAssert.Contains(ReadFixture("ConversationPage.xaml"), "Text=\"&lt;\"");
        StringAssert.Contains(ReadFixture("ConversationPage.xaml"), "SemanticProperties.Description=\"Back to messages\"");
        StringAssert.Contains(ReadFixture("OrderWorkspacePage.xaml"), "Text=\"&lt; Orders\"");
        StringAssert.Contains(ReadFixture("NotificationsPage.cs"), "Text = \"< Discover\"");
        StringAssert.Contains(ReadFixture("ProviderListingsPage.cs"), "Text = \"< Profile\"");
        StringAssert.Contains(ReadFixture("PublicProviderProfilePage.cs"), "Text = \"< Service\"");
        StringAssert.Contains(ReadFixture("ServiceBookingPage.cs"), "Text = \"< Discover\"");
    }

    [TestMethod]
    public void TextActionsDoNotUseDecorativeTrailingArrows()
    {
        var authMarkup = ReadFixture("AuthPage.xaml");
        var authSource = ReadFixture("AuthPage.xaml.cs");
        var onboardingMarkup = ReadFixture("OnboardingPage.xaml");
        var onboardingSource = ReadFixture("OnboardingPage.xaml.cs");
        var ordersMarkup = ReadFixture("OrdersPage.xaml");
        var workspaceMarkup = ReadFixture("OrderWorkspacePage.xaml");
        var profileSource = ReadFixture("PublicProviderProfilePage.cs");
        var bookingSource = ReadFixture("ServiceBookingPage.cs");

        StringAssert.Contains(authMarkup, "Text=\"Log in\"");
        AssertDoesNotContain(authSource, "→");
        StringAssert.Contains(onboardingMarkup, "Text=\"Next\" AutomationId=\"OnboardingNext\"");
        StringAssert.Contains(onboardingSource, "last ? \"Get started\" : \"Next\"");
        AssertDoesNotContain(ordersMarkup, "Open workspace  →");
        AssertDoesNotContain(workspaceMarkup, "Download  ›");
        AssertDoesNotContain(profileSource, "View service  →");
        AssertDoesNotContain(profileSource, "Next →");
        AssertDoesNotContain(bookingSource, "Send service request  →");
        AssertDoesNotContain(bookingSource, "Change  ›");
    }

    [TestMethod]
    public void PublicSocialLinksUseAccessibleLocalVectorIconsOnly()
    {
        var source = ReadFixture("PublicProviderProfilePage.cs");

        StringAssert.Contains(source, "new ImageButton");
        StringAssert.Contains(source, "SemanticProperties.SetDescription(button, item.Label)");
        StringAssert.Contains(source, "ToolTipProperties.SetText(button, item.Label)");
        AssertDoesNotContain(source, "Text = $\"↗");

        foreach (var icon in new[]
                 {
                     "social_instagram.svg",
                     "social_linkedin.svg",
                     "social_x.svg",
                     "social_portfolio.svg",
                 })
        {
            StringAssert.Contains(source, $"\"{icon}\"");
            var svg = ReadFixture(icon);
            StringAssert.Contains(svg, "<svg");
            StringAssert.Contains(svg, "#0F6B4F");
        }
    }

    [TestMethod]
    public void ProviderMessageActionIsAnAccessibleIconInsideTheIdentityCard()
    {
        var source = ReadFixture("PublicProviderProfilePage.cs");

        StringAssert.Contains(source, "identity.Add(CreateMessageProviderButton(profile))");
        StringAssert.Contains(source, "private ImageButton CreateMessageProviderButton");
        StringAssert.Contains(source, "Source = \"tab_messages.svg\"");
        StringAssert.Contains(source, "SemanticProperties.SetDescription(button, \"Message provider\")");
        StringAssert.Contains(source, "CornerRadius = 23");
        AssertDoesNotContain(source, "Text = \"Message provider\"");
        StringAssert.Contains(ReadFixture("tab_messages.svg"), "<svg");
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));

    private static void AssertDoesNotContain(string actual, string unexpected) =>
        Assert.AreEqual(
            -1,
            actual.IndexOf(unexpected, StringComparison.Ordinal),
            $"Did not expect to find '{unexpected}'.");
}
