using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class PasswordResetPresentationRulesTests
{
    [TestMethod]
    public void ResetDestinationMasksLocalAddressButKeepsDomainRecognizable()
    {
        Assert.AreEqual("ke***@gmail.com", PasswordResetPresentationRules.MaskEmail("kevin@gmail.com"));
        Assert.AreEqual("a***@campus.edu", PasswordResetPresentationRules.MaskEmail("a@campus.edu"));
        Assert.AreEqual("Your account email", PasswordResetPresentationRules.MaskEmail("invalid"));
    }

    [TestMethod]
    public void OnlyTheExplicitProtectedAccountResponseStartsSecondFactorStep()
    {
        Assert.IsTrue(PasswordResetPresentationRules.RequiresSecondFactor(
            "Enter your authenticator or recovery code to reset this protected account"));
        Assert.IsFalse(PasswordResetPresentationRules.RequiresSecondFactor("Invalid or expired reset code"));
        Assert.IsFalse(PasswordResetPresentationRules.RequiresSecondFactor(null));
    }
}
