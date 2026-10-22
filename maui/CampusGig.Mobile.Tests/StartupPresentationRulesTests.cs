using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class StartupPresentationRulesTests
{
    [TestMethod]
    public void SplashLettersUseAConsistentNonNegativeStagger()
    {
        Assert.AreEqual(TimeSpan.Zero, StartupPresentationRules.SplashLetterDelay(0));
        Assert.AreEqual(TimeSpan.Zero, StartupPresentationRules.SplashLetterDelay(-1));
        Assert.AreEqual(
            TimeSpan.FromMilliseconds(StartupPresentationRules.SplashLetterStaggerMilliseconds * 8),
            StartupPresentationRules.SplashLetterDelay(8));
    }

    [TestMethod]
    public void SplashMinimumRemainsBriefWhileTheAnimationControlsItsSequence()
    {
        Assert.IsGreaterThan(TimeSpan.Zero, StartupPresentationRules.MinimumSplashDuration);
        Assert.IsLessThanOrEqualTo(TimeSpan.FromMilliseconds(1500), StartupPresentationRules.MinimumSplashDuration);
    }

    [TestMethod]
    public void ColdLaunchPlaysSplashAfterOnboardingHasBeenCompleted()
    {
        Assert.IsFalse(StartupPresentationRules.ShouldPlayOnColdLaunch(onboardingCompleted: false));
        Assert.IsTrue(StartupPresentationRules.ShouldPlayOnColdLaunch(onboardingCompleted: true));
    }
}
