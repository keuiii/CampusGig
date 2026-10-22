using System.Xml.Linq;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class MessagesPresentationMarkupTests
{
    [TestMethod]
    public void MessagesUsesTheCompactMainTabHeader()
    {
        var markup = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "MessagesPage.xaml"));

        StringAssert.Contains(markup, "Style=\"{StaticResource PageTitleStyle}\"");
        Assert.IsFalse(markup.Contains("Text=\"CONVERSATIONS\"", StringComparison.Ordinal));
        StringAssert.Contains(markup, "AutomationId=\"MessagesTitle\"");
        StringAssert.Contains(markup, "Style=\"{StaticResource MainTabHeaderStyle}\"");
        Assert.IsFalse(markup.Contains("Keep every project conversation", StringComparison.Ordinal));
        Assert.IsFalse(markup.Contains("<Ellipse Grid.RowSpan=\"3\"", StringComparison.Ordinal));
    }

    [TestMethod]
    public void SearchAndInboxActionsShareOneCompactToolbar()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "MessagesPage.xaml");
        var document = XDocument.Load(path);
        var toolbar = document.Descendants()
            .Single(element => element.Name.LocalName == "Grid" &&
                element.Attribute("ColumnDefinitions")?.Value == "*,40,40");

        Assert.IsTrue(toolbar.Descendants().Any(element =>
            element.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "MessageSearch")));
        Assert.IsTrue(toolbar.Descendants().Any(element =>
            element.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "ArchiveInboxButton")));
        Assert.IsTrue(toolbar.Descendants().Any(element =>
            element.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "UnreadCountBadge")));
        var unreadBadge = toolbar.Descendants().Single(element =>
            element.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "UnreadCountBadge"));
        Assert.IsNull(unreadBadge.Attribute("IsVisible"));
        Assert.AreEqual("0", unreadBadge.Descendants()
            .Single(element => element.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "UnreadCountLabel"))
            .Attribute("Text")?.Value);
    }

    [TestMethod]
    public void ConversationSwipeUsesIconOnlyPinArchiveAndDeleteActions()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "MessagesPage.xaml");
        var document = XDocument.Load(path);
        var swipeView = document.Descendants()
            .Single(element => element.Name.LocalName == "SwipeView");
        var swipeItems = document.Descendants()
            .Where(element => element.Name.LocalName == "SwipeItemView")
            .ToArray();

        Assert.AreEqual("120", swipeView.Attribute("Threshold")?.Value);
        Assert.HasCount(1, swipeItems);
        Assert.AreEqual("132", swipeItems.Single().Attribute("WidthRequest")?.Value);
        Assert.AreEqual(
            "132",
            swipeItems.Single().Descendants()
                .First(element => element.Name.LocalName == "Grid")
                .Attribute("WidthRequest")?.Value);
        var actionSurface = swipeItems.Single().Descendants()
            .Single(element => element.Name.LocalName == "Border");
        Assert.AreEqual("RoundRectangle 17", actionSurface.Attribute("StrokeShape")?.Value);
        Assert.AreEqual("132", actionSurface.Attribute("WidthRequest")?.Value);
        var actionGrids = swipeItems.Single().Descendants()
            .Where(element => element.Name.LocalName == "Grid" &&
                element.Attribute("AutomationId") is not null)
            .ToArray();
        Assert.HasCount(3, actionGrids);
        CollectionAssert.AreEquivalent(
            new[] { "PinConversationAction", "ArchiveConversationAction", "DeleteConversationAction" },
            actionGrids.Select(item => item.Attribute("AutomationId")?.Value).ToArray());
        CollectionAssert.AreEquivalent(
            new[] { "message_pin.svg", "message_archive.svg", "message_delete.svg" },
            swipeItems.Single().Descendants()
                .Where(element => element.Name.LocalName == "Image")
                .Select(item => item.Attribute("Source")?.Value)
                .ToArray());
        Assert.IsTrue(swipeItems.Single().Descendants()
            .Where(element => element.Name.LocalName == "Image")
            .All(item => item
                .Attribute("WidthRequest")?.Value == "18"));
        Assert.IsTrue(actionGrids.All(item =>
            item.Attribute("SemanticProperties.Description") is not null));
    }

    [TestMethod]
    public void InboxKeepsOlderConversationsAccessible()
    {
        var markup = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "MessagesPage.xaml"));
        var code = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "MessagesPage.xaml.cs"));

        StringAssert.Contains(markup, "AutomationId=\"LoadMoreConversationsButton\"");
        StringAssert.Contains(code, "response.Pagination.NextCursor");
        StringAssert.Contains(code, "DistinctBy(item => item.Id)");
        StringAssert.Contains(code, "response.UnreadCount");
        StringAssert.Contains(code, "OnRealtimeInboxChanged");
    }
}
