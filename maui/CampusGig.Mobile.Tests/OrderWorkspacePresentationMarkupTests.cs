using System.Xml.Linq;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class OrderWorkspacePresentationMarkupTests
{
    [TestMethod]
    public void CompletedOrderReviewFlowExposesStableAutomationTargets()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrderWorkspacePage.xaml");
        var document = XDocument.Load(path);
        var automationIds = document.Descendants()
            .Select(element => element.Attribute("AutomationId")?.Value)
            .Where(value => value is not null)
            .ToArray();

        CollectionAssert.IsSubsetOf(
            new[]
            {
                "OrderWorkspace",
                "WorkspaceOrderNumber",
                "WorkspaceCounterparty",
                "AcceptDeliveryButton",
                "Rating5Button",
                "ReviewComment",
                "SubmitReviewButton",
            },
            automationIds);
    }

    [TestMethod]
    public void DeliveryHistoryShowsVersionsFilesAndNonAcceptancePolicy()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrderWorkspacePage.xaml");
        var markup = File.ReadAllText(path);

        StringAssert.Contains(markup, "DeliverySubmissionList");
        StringAssert.Contains(markup, "VersionLabel");
        StringAssert.Contains(markup, "SubmittedLabel");
        StringAssert.Contains(markup, "NoteLabel");
        StringAssert.Contains(markup, "Downloading a file does not automatically accept the order.");
        StringAssert.Contains(markup, "LegacyFileList");
        StringAssert.Contains(markup, "BackgroundColor=\"{AppThemeBinding Light=#F4F3EC, Dark=#1C2520}\"");
        Assert.IsFalse(markup.Contains("Light=#073F31", StringComparison.Ordinal));
        StringAssert.Contains(markup, "x:Name=\"OpenDisputeButton\"");
        StringAssert.Contains(markup, "FillColor=\"#0F6B4F\"");
        Assert.IsFalse(markup.Contains("#9A5B13", StringComparison.Ordinal));
    }
}
