namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class KeyboardBehaviorPresentationTests
{
    [TestMethod]
    public void AndroidKeyboardResizesTheActivePageInsteadOfCoveringInputs()
    {
        var activity = ReadFixture("MainActivity.cs");

        StringAssert.Contains(activity, "WindowSoftInputMode = SoftInput.AdjustResize");
        StringAssert.Contains(activity, "HideSoftInputFromWindow");
    }

    [TestMethod]
    public void NextActionMovesToTheNextVisibleEnabledTextInput()
    {
        var program = ReadFixture("MauiProgram.cs");

        StringAssert.Contains(program, "ReturnType: ReturnType.Next");
        StringAssert.Contains(program, "FocusNextTextInput(entry)");
        StringAssert.Contains(program, "GetVisualTreeDescendants()");
        StringAssert.Contains(program, "IsAvailableTextInput");
        StringAssert.Contains(program, "IsVisible: false");
        StringAssert.Contains(program, "IsEnabled: false");
    }

    [TestMethod]
    public void PrimaryFormsDeclareUsefulNextAndDoneActions()
    {
        var auth = ReadFixture("AuthPage.xaml");
        var listing = ReadFixture("ProviderListingEditorPage.xaml");
        var profile = ReadFixture("ProfilePage.xaml");

        StringAssert.Contains(auth, "ReturnType=\"Next\"");
        StringAssert.Contains(auth, "ReturnType=\"Done\"");
        StringAssert.Contains(listing, "x:Name=\"BasePriceEntry\"");
        StringAssert.Contains(listing, "Keyboard=\"Numeric\" ReturnType=\"Next\"");
        StringAssert.Contains(listing, "Keyboard=\"Numeric\" ReturnType=\"Done\"");
        StringAssert.Contains(profile, "x:Name=\"SupportSubjectEntry\"");
        StringAssert.Contains(profile, "ReturnType=\"Next\"");
        StringAssert.Contains(profile, "ReturnType=\"Done\"");
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
