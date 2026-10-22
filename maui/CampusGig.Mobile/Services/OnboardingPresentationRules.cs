namespace CampusGig.Mobile.Services;

public static class OnboardingPresentationRules
{
    public const string CompletionPreferenceKey = "campusgig_onboarding_completed_v1";

    public static bool ShouldShow(bool authenticated, bool completed) =>
        !authenticated && !completed;

    public static bool IsLastSlide(int position, int slideCount) =>
        slideCount > 0 && position >= slideCount - 1;

    public static int NextPosition(int position, int slideCount) =>
        slideCount <= 0 ? 0 : Math.Min(Math.Max(position, 0) + 1, slideCount - 1);

    public static bool ShouldPlayBrandTransition(bool skipped) => !skipped;
}
