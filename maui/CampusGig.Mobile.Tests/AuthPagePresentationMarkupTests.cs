namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class AuthPagePresentationMarkupTests
{
    [TestMethod]
    public void LoginAndRegistrationUseTheUpdatedCompactPresentation()
    {
        var markup = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "AuthPage.xaml"));
        var source = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "AuthPage.xaml.cs"));

        StringAssert.Contains(markup, "Text=\"Welcome Back\"");
        StringAssert.Contains(source, "AuthMode.Register => (\"Create Your Account\"");
        StringAssert.Contains(markup, "BackgroundColor=\"#1B4D3E\"");
        StringAssert.Contains(markup, "VerticalScrollBarVisibility=\"Never\"");
        StringAssert.Contains(markup, "VerticalOptions=\"Start\"");
        StringAssert.Contains(markup, "Padding=\"22,22,22,28\"");
        StringAssert.Contains(markup, "Style=\"{StaticResource DisabledActionStateStyle}\"");
        StringAssert.Contains(markup, "MaximumWidthRequest=\"300\"");
        StringAssert.Contains(markup, "SemanticProperties.Description=\"Show password\"");
        StringAssert.Contains(markup, "x:Name=\"GoogleButton\"");
        StringAssert.Contains(markup, "x:Name=\"BrowseGuestButton\"");
        StringAssert.Contains(markup, "x:Name=\"ForgotButton\"");
        StringAssert.Contains(markup, "x:Name=\"AuthTabs\" HeightRequest=\"42\" Padding=\"3\" StrokeThickness=\"0\"");
        StringAssert.Contains(markup, "StrokeShape=\"RoundRectangle 12\"");
        StringAssert.Contains(markup, "x:Name=\"AuthenticatorCodeSlots\"");
        StringAssert.Contains(markup, "x:Name=\"AuthCodeBox5\"");
        StringAssert.Contains(markup, "AutomationId=\"VerificationCode\"");
        StringAssert.Contains(source, "RenderAuthenticatorCodeSlots(normalized)");
        StringAssert.Contains(source, "AuthenticatorCodeLabels[enteredIndex].ScaleToAsync");
        Assert.IsLessThan(
            markup.IndexOf("x:Name=\"SocialGroup\"", StringComparison.Ordinal),
            markup.IndexOf("x:Name=\"ForgotButton\"", StringComparison.Ordinal));
        StringAssert.Contains(markup, "x:Name=\"ForgotButton\" Text=\"Forgot password?\"");
        StringAssert.Contains(markup, "Margin=\"0,2,0,0\" HeightRequest=\"44\"");
        StringAssert.Contains(markup, "x:Name=\"StudentGroup\" IsVisible=\"False\" Margin=\"0,8,0,0\"");
        StringAssert.Contains(markup, "Padding=\"6,0\" HeightRequest=\"46\"");
        StringAssert.Contains(source, "OnGoogleClicked");
        StringAssert.Contains(source, "OnBrowseAsGuestClicked");
        StringAssert.Contains(source, "OnForgotClicked");
        StringAssert.Contains(source, "ConfirmPasswordGroup.IsVisible = mode == AuthMode.Reset");
        Assert.IsFalse(source.Contains(
            "mode == AuthMode.Register || (mode == AuthMode.Reset",
            StringComparison.Ordinal));
    }

    [TestMethod]
    public void RegistrationDoesNotRequirePasswordConfirmation()
    {
        var source = File.ReadAllText(Path.Combine(
            AppContext.BaseDirectory,
            "Fixtures",
            "AuthPage.xaml.cs"));

        var registerStart = source.IndexOf("case AuthMode.Register:", StringComparison.Ordinal);
        var verifyStart = source.IndexOf("case AuthMode.Verify:", registerStart, StringComparison.Ordinal);
        Assert.IsGreaterThanOrEqualTo(0, registerStart);
        Assert.IsGreaterThan(registerStart, verifyStart);

        var registerBlock = source[registerStart..verifyStart];
        Assert.IsFalse(registerBlock.Contains("ConfirmPasswordEntry", StringComparison.Ordinal));
        StringAssert.Contains(registerBlock, "auth/register");
        StringAssert.Contains(registerBlock, "isStudent = StudentCheckBox.IsChecked");
    }
}
