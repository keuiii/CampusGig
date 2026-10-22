using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class OnboardingPresentationRulesTests
{
    [TestMethod]
    public void OnboardingAppearsOnlyForAnUnauthenticatedFirstLaunch()
    {
        Assert.IsTrue(OnboardingPresentationRules.ShouldShow(authenticated: false, completed: false));
        Assert.IsFalse(OnboardingPresentationRules.ShouldShow(authenticated: true, completed: false));
        Assert.IsFalse(OnboardingPresentationRules.ShouldShow(authenticated: false, completed: true));
    }

    [TestMethod]
    public void ThreeSlideNavigationStopsAtTheLastIntroduction()
    {
        Assert.AreEqual(1, OnboardingPresentationRules.NextPosition(0, 3));
        Assert.AreEqual(2, OnboardingPresentationRules.NextPosition(1, 3));
        Assert.AreEqual(2, OnboardingPresentationRules.NextPosition(2, 3));
        Assert.IsFalse(OnboardingPresentationRules.IsLastSlide(1, 3));
        Assert.IsTrue(OnboardingPresentationRules.IsLastSlide(2, 3));
    }

    [TestMethod]
    public void BrandTransitionPlaysAfterGetStartedButNotSkip()
    {
        Assert.IsTrue(OnboardingPresentationRules.ShouldPlayBrandTransition(skipped: false));
        Assert.IsFalse(OnboardingPresentationRules.ShouldPlayBrandTransition(skipped: true));
    }
}
