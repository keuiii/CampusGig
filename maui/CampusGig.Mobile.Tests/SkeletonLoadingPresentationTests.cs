namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class SkeletonLoadingPresentationTests
{
    [TestMethod]
    public void InitialStructuredLoadsUseSharedSkeletonCards()
    {
        AssertSkeleton("HomePage.xaml", "LoadingServices", "Kind=\"Service\"");
        AssertSkeleton("MessagesPage.xaml", "LoadingConversations", "Kind=\"Conversation\"");
        AssertSkeleton("OrdersPage.xaml", "LoadingOrders", "Kind=\"Order\"");
        AssertSkeleton("ConversationPage.xaml", "LoadingMessages", "Kind=\"Conversation\"");
        AssertSkeleton("ProfilePage.xaml", "ProfileSkeleton", "Kind=\"Profile\"");
        AssertSkeleton("ProviderListingsPage.cs", "Loading provider listings", "SkeletonCardKind.Listing");
        AssertSkeleton("PublicProviderProfilePage.cs", "Loading provider profile", "SkeletonCardKind.Profile");
    }

    [TestMethod]
    public void RefreshAndPaginationKeepTheirExistingProgressSemantics()
    {
        var profile = ReadFixture("ProfilePage.xaml.cs");
        var listings = ReadFixture("ProviderListingsPage.cs");
        var provider = ReadFixture("PublicProviderProfilePage.cs");

        StringAssert.Contains(profile, "ProfileSkeleton.IsVisible = !profileContentLoaded");
        StringAssert.Contains(listings, "loading.IsVisible = list.ItemsSource is null");
        StringAssert.Contains(provider, "reviewsPageLabel.Text = \"Loading reviews…\"");
        StringAssert.Contains(provider, "if (isInitialLoad)");
    }

    [TestMethod]
    public void SkeletonAnimationHonorsPlatformReducedMotion()
    {
        var block = ReadFixture("SkeletonBlock.cs");

        StringAssert.Contains(block, "AnimatorDurationScale");
        StringAssert.Contains(block, "UIAccessibility.IsReduceMotionEnabled");
        StringAssert.Contains(block, "UISettings().AnimationsEnabled");
        StringAssert.Contains(block, "AutomationProperties.SetIsInAccessibleTree(this, false)");
    }

    private static void AssertSkeleton(string fixture, string stateName, string shape)
    {
        var source = ReadFixture(fixture);
        StringAssert.Contains(source, stateName);
        StringAssert.Contains(source, shape);
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
