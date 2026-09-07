namespace CampusGig.Mobile.Services;

public static class DialogPresentationRules
{
    public static bool ShouldUseWindowHost(bool hostAvailable, bool hostIsSourcePage) =>
        hostAvailable && !hostIsSourcePage;
}
