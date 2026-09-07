using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class MessagePaletteTests
{
    [TestMethod]
    public void IncomingBubble_UsesDarkSurfaceInDarkMode()
    {
        Assert.AreEqual("#233129", MessagePalette.Bubble(false, true));
        Assert.AreEqual("#F2F6F3", MessagePalette.Text(false, true));
    }

    [TestMethod]
    public void IncomingBubble_UsesLightSurfaceInLightMode()
    {
        Assert.AreEqual("#E7F1EC", MessagePalette.Bubble(false, false));
        Assert.AreEqual("#17211D", MessagePalette.Text(false, false));
    }

    [TestMethod]
    public void OutgoingBubble_RemainsBrandedAndReadable()
    {
        Assert.AreEqual("#087A5A", MessagePalette.Bubble(true, true));
        Assert.AreEqual("#FFFFFF", MessagePalette.Text(true, true));
    }
}
