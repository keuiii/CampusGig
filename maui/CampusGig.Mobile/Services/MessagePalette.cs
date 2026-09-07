namespace CampusGig.Mobile.Services;

public static class MessagePalette
{
    public static string Bubble(bool isMine, bool isDark) => isMine
        ? (isDark ? "#087A5A" : "#0F6B4F")
        : (isDark ? "#233129" : "#E7F1EC");

    public static string Text(bool isMine, bool isDark) => isMine
        ? "#FFFFFF"
        : (isDark ? "#F2F6F3" : "#17211D");
}
