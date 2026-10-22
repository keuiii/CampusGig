namespace CampusGig.Mobile.Services;

public static class StartupPresentationRules
{
    public static TimeSpan MinimumSplashDuration { get; } = TimeSpan.FromMilliseconds(1400);
    public const int SplashLetterStaggerMilliseconds = 58;

    public static TimeSpan SplashLetterDelay(int index) =>
        TimeSpan.FromMilliseconds(Math.Max(0, index) * SplashLetterStaggerMilliseconds);

    public static bool ShouldPlayOnColdLaunch(bool onboardingCompleted) => onboardingCompleted;
}
