namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class HomePageLifecycleMarkupTests
{
    [TestMethod]
    public void DiscoverAppearanceKeepsItsCancellationTokenLocalAcrossAwait()
    {
        var source = ReadFixture("HomePage.xaml.cs");

        StringAssert.Contains(source, "var appearanceCancellation = new CancellationTokenSource()");
        StringAssert.Contains(source, "var cancellationToken = appearanceCancellation.Token");
        StringAssert.Contains(source, "ReferenceEquals(refreshCancellation, appearanceCancellation)");
        Assert.AreEqual(
            -1,
            source.IndexOf("RefreshInBackgroundAsync(refreshCancellation.Token)", StringComparison.Ordinal),
            "The shared cancellation field must not be dereferenced after an awaited load.");
    }

    [TestMethod]
    public void RootTabLifecycleContainsPageFailuresInsteadOfCrashingAndroid()
    {
        var source = ReadFixture("MainTabbedPage.cs");

        StringAssert.Contains(source, "await RunLifecycleSafelyAsync(lifecycle.OnTabAppearingAsync)");
        StringAssert.Contains(source, "await RunLifecycleSafelyAsync(lifecycle.OnTabDisappearingAsync)");
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));
}
