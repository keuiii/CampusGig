using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class PasswordVisibilityRulesTests
{
    [TestMethod]
    public void Toggle_RevealsAndHidesPassword()
    {
        Assert.IsFalse(PasswordVisibilityRules.Toggle(true));
        Assert.IsTrue(PasswordVisibilityRules.Toggle(false));
    }

    [TestMethod]
    public void ButtonLabel_DescribesNextAction()
    {
        Assert.AreEqual("Show", PasswordVisibilityRules.ButtonLabel(true));
        Assert.AreEqual("Hide", PasswordVisibilityRules.ButtonLabel(false));
    }
}
