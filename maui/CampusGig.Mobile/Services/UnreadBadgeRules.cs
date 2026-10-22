namespace CampusGig.Mobile.Services;

public static class UnreadBadgeRules
{
    public const string EmptyBackground = "#E4E9E6";
    public const string EmptyForeground = "#66716B";
    public const string ActiveBackground = "#DFF2E8";
    public const string ActiveForeground = "#08543D";

    public static bool IsVisible(int count) => count > 0;
    public static string Label(int count) => count <= 0 ? "" : count > 9 ? "9+" : count.ToString();
    public static string Background(int count) => count > 0 ? ActiveBackground : EmptyBackground;
    public static string Foreground(int count) => count > 0 ? ActiveForeground : EmptyForeground;
}
