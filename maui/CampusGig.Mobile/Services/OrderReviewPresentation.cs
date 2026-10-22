using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class OrderReviewPresentation
{
    public static bool HasActiveWindow(OrderItem order) =>
        order.Status == "SUBMITTED" &&
        order.ReviewPolicyVersion == 1 &&
        order.ReviewDeadlineAt.HasValue;

    public static string TimeRemaining(DateTimeOffset deadline, DateTimeOffset now)
    {
        var remaining = deadline - now;
        if (remaining <= TimeSpan.Zero) return "Review period ended";
        var totalMinutes = Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes));
        var hours = totalMinutes / 60;
        var minutes = totalMinutes % 60;
        if (hours == 0) return $"{minutes}m remaining";
        if (minutes == 0) return $"{hours}h remaining";
        return $"{hours}h {minutes}m remaining";
    }

    public static string DeadlineLabel(DateTimeOffset deadline) =>
        deadline.ToLocalTime().ToString("MMM d, yyyy h:mm tt");

    public static string? CompletionExplanation(OrderItem order) => order.CompletionSource switch
    {
        "CLIENT_ACCEPTED" => "The client accepted the delivery. The provider earning is now available.",
        "AUTO_REVIEW_TIMEOUT" => "The 48-hour delivery review period ended. CampusGig completed the order automatically and made the provider earning available.",
        _ => null,
    };
}
