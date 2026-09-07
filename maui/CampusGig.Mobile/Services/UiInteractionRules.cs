namespace CampusGig.Mobile.Services;

public static class UiInteractionRules
{
    public const double MinimumTouchTarget = 48;

    public static bool CanInvoke(bool isEnabled, bool isBusy) => isEnabled && !isBusy;

    public static bool ShouldShowBusy(bool operationRunning, bool awaitingUserFeedback) =>
        operationRunning && !awaitingUserFeedback;
}
