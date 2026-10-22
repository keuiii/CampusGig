using System.Xml.Linq;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class OrdersPresentationMarkupTests
{
    [TestMethod]
    public void OrderCardsPrioritizeOrderNumberAndRelationshipIdentity()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrdersPage.xaml");
        var document = XDocument.Load(path);
        var markup = File.ReadAllText(path);

        Assert.IsTrue(document.Descendants().Any(element =>
            element.Attribute("AutomationId")?.Value == "OrderNumberLabel"));
        StringAssert.Contains(markup, "RelationshipRole");
        StringAssert.Contains(markup, "RelationshipName");
        StringAssert.Contains(markup, "RelationshipInitial");
        StringAssert.Contains(markup, "AutomationId=\"LoadMoreOrdersButton\"");
        StringAssert.Contains(markup, "Style=\"{StaticResource MainTabHeaderStyle}\"");
        Assert.IsFalse(markup.Contains("Text=\"MY PROJECTS\"", StringComparison.Ordinal));
    }
}
