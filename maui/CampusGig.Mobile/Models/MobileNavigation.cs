namespace CampusGig.Mobile.Models;

public sealed record MobileTabDefinition(string Route, string Title, string Icon, string IconFile)
{
    public MobileTabDefinition(string route, string title, string icon)
        : this(route, title, icon, $"tab_{route}.svg") { }
}

public static class MobileNavigation
{
    public static IReadOnlyList<MobileTabDefinition> Tabs { get; } =
    [
        new("discover", "Discover", "⌂"),
        new("orders", "Orders", "▱"),
        new("messages", "Messages", "◌"),
        new("profile", "Profile", "◎"),
    ];
}
