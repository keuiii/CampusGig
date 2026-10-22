using System.Xml.Linq;
using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Tests;

[TestClass]
public class OrderVisibilityPresentationTests
{
    [TestMethod]
    public void OrderPartyUsesVersionedPublicAvatarOrInitialFallback()
    {
        var party = new OrderParty { Id = "provider-1", DisplayName = "Georgia", AvatarVersion = 42 };
        party.ResolveAvatarUrl("http://10.0.2.2:4000/api/v1/");
        Assert.IsNull(party.AvatarUrl);
        party.HasAvatar = true;
        party.ResolveAvatarUrl("http://10.0.2.2:4000/api/v1/");
        Assert.AreEqual("http://10.0.2.2:4000/api/v1/profile/avatar/provider-1?v=42", party.AvatarUrl);
    }

    [TestMethod]
    public void OrderViewsIncludeProfilePhotoOverInitialFallback()
    {
        var ns = XNamespace.Get("http://schemas.microsoft.com/dotnet/2021/maui");
        var orders = XDocument.Load(Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrdersPage.xaml"));
        Assert.IsTrue(orders.Descendants(ns + "Image").Any(image =>
            (string?)image.Attribute("Source") == "{Binding RelationshipAvatarUrl}"));
        var workspace = XDocument.Load(Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrderWorkspacePage.xaml"));
        Assert.IsTrue(workspace.Descendants(ns + "Image").Any(image =>
            image.Attributes().Any(attribute => attribute.Name.LocalName == "Name" && attribute.Value == "CounterpartyAvatarImage")));
    }

    [TestMethod]
    public void OnlyCompletedOrdersExposeVisibilityActions()
    {
        var completed = new OrderItem { Status = "COMPLETED" };
        var active = new OrderItem { Status = "IN_PROGRESS" };

        Assert.IsTrue(completed.IsCompleted);
        Assert.IsFalse(completed.IsNotCompleted);
        Assert.AreEqual("Archive order", completed.ArchiveActionLabel);
        completed.IsArchived = true;
        Assert.AreEqual("Restore order", completed.ArchiveActionLabel);
        Assert.IsFalse(active.IsCompleted);
        Assert.IsTrue(active.IsNotCompleted);
    }

    [TestMethod]
    public void SwipeActionsAreConfinedToCompletedOrderFooter()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrdersPage.xaml");
        var document = XDocument.Load(path);
        var ns = XNamespace.Get("http://schemas.microsoft.com/dotnet/2021/maui");
        var swipe = document.Descendants(ns + "SwipeView").Single();

        Assert.AreEqual("{Binding IsCompleted}", (string?)swipe.Attribute("IsVisible"));
        Assert.AreEqual("1", (string?)swipe.Attribute("Grid.Row"));
        Assert.AreEqual("Fill", (string?)swipe.Attribute("HorizontalOptions"));
        Assert.AreEqual("80", (string?)swipe.Attribute("Threshold"));
        Assert.AreEqual("Swipe left", (string?)swipe.Descendants(ns + "Label").First().Attribute("Text"));
        Assert.AreEqual("OnOrderSwipeChanging", (string?)swipe.Attribute("SwipeChanging"));
        Assert.AreEqual("OnOrderSwipeEnded", (string?)swipe.Attribute("SwipeEnded"));
        Assert.AreEqual(1, swipe.Descendants(ns + "SwipeItemView").Count());
        var actionTray = swipe.Descendants(ns + "HorizontalStackLayout").Single();
        Assert.AreEqual("4", (string?)actionTray.Attribute("Spacing"));
        Assert.AreEqual(2, actionTray.Elements(ns + "Border").Count());
        Assert.IsTrue(actionTray.Elements(ns + "Border").All(item => (string?)item.Attribute("WidthRequest") == "38"));
        var archiveToggle = document.Descendants(ns + "Border").Single(border =>
            (string?)border.Attribute("AutomationId") == "ArchivedOrdersToggle");
        Assert.IsNull(archiveToggle.Attribute("Text"));
        Assert.IsNotNull(archiveToggle.Element(ns + "Path"));
        var orderControls = archiveToggle.Parent;
        Assert.IsNotNull(orderControls);
        Assert.AreEqual(ns + "Grid", orderControls.Name);
        Assert.AreEqual("44,236,44", (string?)orderControls.Attribute("ColumnDefinitions"));
        Assert.AreEqual("4", (string?)orderControls.Attribute("ColumnSpacing"));
        Assert.AreEqual("1", (string?)document.Descendants(ns + "Border").Single(border =>
            border.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "ScopeTabs")).Attribute("Grid.Column"));
        Assert.AreEqual("2", (string?)archiveToggle.Attribute("Grid.Column"));
        Assert.AreEqual("#F2EED8", (string?)archiveToggle.Attribute("BackgroundColor"));
        Assert.AreEqual("RoundRectangle 20", (string?)archiveToggle.Attribute("StrokeShape"));
        Assert.IsTrue(orderControls.Descendants(ns + "Border").Any(border =>
            border.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "ScopeTabs")));
        Assert.IsTrue(document.Descendants(ns + "DataTrigger").Any(trigger =>
            (string?)trigger.Attribute("Binding") == "{Binding Status}" &&
            (string?)trigger.Attribute("Value") == "COMPLETED"));
        var orderCard = document.Descendants(ns + "Border").Single(border =>
            (string?)border.Attribute("AutomationId") == "OrderCard");
        Assert.IsFalse(orderCard.Elements(ns + "Border.GestureRecognizers").Any());
    }
}
