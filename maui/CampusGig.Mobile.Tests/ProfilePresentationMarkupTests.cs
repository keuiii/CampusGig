namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class ProfilePresentationMarkupTests
{
    [TestMethod]
    public void ProfileDoesNotExposeAnIntroReplayAction()
    {
        var profilePath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "ProfilePage.xaml");
        var markup = File.ReadAllText(profilePath);

        Assert.IsFalse(markup.Contains("Replay intro animation", StringComparison.Ordinal));
        Assert.IsFalse(markup.Contains("OnReplayIntroTapped", StringComparison.Ordinal));
        StringAssert.Contains(markup, "AuthSessionsStatus");
        StringAssert.Contains(markup, "AuthSessionsList");
        StringAssert.Contains(markup, "AutomationId=\"CampusIdentityHeader\"");
        StringAssert.Contains(markup, "AutomationId=\"CampusIdentityForm\"");
        StringAssert.Contains(markup, "AutomationId=\"StudentYearLevel\"");
        StringAssert.Contains(markup, "AutomationId=\"ProviderVerifiedBadge\"");
        StringAssert.Contains(markup, "AutomationId=\"ProviderInstagramUrl\"");
        StringAssert.Contains(markup, "AutomationId=\"ProviderLinkedinUrl\"");
        StringAssert.Contains(markup, "AutomationId=\"ProviderXUrl\"");
        StringAssert.Contains(markup, "AutomationId=\"ProviderPortfolioUrl\"");
        StringAssert.Contains(markup, "AutomationId=\"ProviderListingsRow\"");
        StringAssert.Contains(markup, "AutomationId=\"ProviderEarningsRow\"");
        StringAssert.Contains(markup, "AutomationId=\"MaxActiveOrders\"");
        StringAssert.Contains(markup, "AutomationId=\"MaxPendingOrders\"");
        StringAssert.Contains(markup, "AutomationId=\"SupportCategory\"");
        StringAssert.Contains(markup, "AutomationId=\"SupportSubject\"");
        StringAssert.Contains(markup, "AutomationId=\"SupportMessage\"");
        StringAssert.Contains(markup, "AutomationId=\"SubmitSupportTicket\"");
        StringAssert.Contains(markup, "AutomationId=\"SupportReceipt\"");
        Assert.IsFalse(markup.Contains("x:Name=\"YearPicker\"", StringComparison.Ordinal));
    }

    [TestMethod]
    public void ProfileGroupsActionsWithoutRedundantSectionLabelsAndRevealsExpandedContent()
    {
        var markup = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "ProfilePage.xaml"));
        var source = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "ProfilePage.xaml.cs"));

        foreach (var heading in new[]
                 {
                     "Text=\"APPEARANCE\"",
                     "Text=\"STUDENT INFORMATION\"",
                     "Text=\"SCHOOL VERIFICATION\"",
                     "Text=\"NEXT STEPS\"",
                 })
            Assert.IsFalse(markup.Contains(heading, StringComparison.Ordinal));

        StringAssert.Contains(markup, "x:Name=\"ProfileScrollView\"");
        StringAssert.Contains(source, "RevealExpandedSectionAsync(StudentIdentityForm)");
        StringAssert.Contains(source, "RevealExpandedSectionAsync(ProviderPanel)");
        StringAssert.Contains(source, "RevealExpandedSectionAsync(SettingsPanel)");
        StringAssert.Contains(source, "RevealExpandedSectionAsync(SupportPanel)");
        StringAssert.Contains(source, "OnProviderEarningsClicked");
        StringAssert.Contains(source, "new ProviderEarningsPage(api)");
        StringAssert.Contains(source, "ScrollToPosition.MakeVisible");
        StringAssert.Contains(markup, "Text=\"Set up your campus identity\" FontSize=\"15\"");
        StringAssert.Contains(markup, "Text=\"Verify your student identity\" FontSize=\"15\"");
    }

    [TestMethod]
    public void MessageBadgeRemainsVisibleAtZeroAndUsesTheActivePalette()
    {
        var messagesPath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "MessagesPage.xaml");
        var markup = File.ReadAllText(messagesPath);

        StringAssert.Contains(markup, "x:Name=\"UnreadCountBadge\"");
        Assert.IsFalse(markup.Contains("x:Name=\"UnreadCountBadge\" Grid.Column=\"2\" IsVisible=\"False\"", StringComparison.Ordinal));
        StringAssert.Contains(markup, "x:Name=\"UnreadCountLabel\" Text=\"0\"");
        StringAssert.Contains(markup, "BackgroundColor=\"#DFF2E8\"");
        Assert.IsFalse(markup.Contains("BackgroundColor=\"#D95045\"", StringComparison.Ordinal));
    }
}
