namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class PasswordResetPresentationMarkupTests
{
    [TestMethod]
    public void ResetFormContainsFocusedSecureControls()
    {
        var markup = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "AuthPage.xaml"));

        StringAssert.Contains(markup, "x:Name=\"ResetAccountPanel\"");
        StringAssert.Contains(markup, "x:Name=\"ResetCodeField\"");
        StringAssert.Contains(markup, "AutomationId=\"ResetCode\"");
        StringAssert.Contains(markup, "x:Name=\"ConfirmPasswordGroup\"");
        StringAssert.Contains(markup, "x:Name=\"PasswordStrengthPanel\"");
        StringAssert.Contains(markup, "x:Name=\"ResetMfaGroup\" IsVisible=\"False\"");
    }
}
