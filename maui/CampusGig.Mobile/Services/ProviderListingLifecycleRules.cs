namespace CampusGig.Mobile.Services;

public static class ProviderListingLifecycleRules
{
    public static IReadOnlyList<string> Actions(string? status) => status switch
    {
        "DRAFT" or "REJECTED" => ["preview", "edit", "submit"],
        "PENDING_REVIEW" => ["preview"],
        "PUBLISHED" => ["preview", "edit", "pause", "archive"],
        "PAUSED" => ["preview", "edit", "resume", "archive"],
        "ARCHIVED" => ["preview", "restore"],
        _ => ["preview"],
    };

    public static string StatusCopy(string? status) => status switch
    {
        "DRAFT" => "Private draft. Edit it or submit it for administrator review.",
        "PENDING_REVIEW" => "Awaiting admin review.",
        "PUBLISHED" => "Visible in Discover. Editing creates a private draft.",
        "PAUSED" => "Hidden until you resume it. Editing creates a private draft.",
        "REJECTED" => "Review the administrator feedback, edit, and resubmit.",
        "ARCHIVED" => "Stored privately and hidden from clients.",
        _ => "Listing status unavailable.",
    };

    public static string EndpointAction(string action) => action switch
    {
        "pause" or "resume" or "archive" or "restore" => action,
        _ => throw new ArgumentOutOfRangeException(nameof(action)),
    };

    public static string ActionLabel(string action) => action switch
    {
        "pause" => "Pause",
        "resume" => "Resume",
        "archive" => "Archive",
        "restore" => "Restore",
        "submit" => "Submit for review",
        "edit" => "Edit",
        _ => "Preview",
    };
}
