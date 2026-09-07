namespace CampusGig.Mobile.Services;

public static class UnreadBadgeRules
{
    public static bool IsVisible(int count) => count > 0;
    public static string Label(int count) => count > 9 ? "9+" : Math.Max(0, count).ToString();
}
