namespace CampusGig.Mobile.Services;

public static class RefreshRequestRules
{
    public static bool CanStart(bool isLoading) => !isLoading;
}
