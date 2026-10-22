using System.Xml.Linq;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class SplashPresentationMarkupTests
{
    [TestMethod]
    public void AccentLineUsesAStaticLimeSurfaceWithoutScaleTransforms()
    {
        var splashPath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "SplashPage.xaml");
        var document = XDocument.Load(splashPath);
        var accentLine = document
            .Descendants()
            .Single(element => element.Attributes().Any(attribute =>
                attribute.Name.LocalName == "Name" && attribute.Value == "AccentLine"));

        Assert.AreEqual("Border", accentLine.Name.LocalName);
        Assert.AreEqual("#B9E64A", accentLine.Attribute("BackgroundColor")?.Value);
        Assert.AreEqual("0", accentLine.Attribute("StrokeThickness")?.Value);
        Assert.IsNull(accentLine.Attribute("Scale"));
    }
}
