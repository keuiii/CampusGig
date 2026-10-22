using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class DisputePresentation
{
    private static readonly HashSet<string> ActiveStatuses =
    [
        "OPEN",
        "WAITING_FOR_CLIENT",
        "WAITING_FOR_PROVIDER",
        "READY_FOR_REVIEW",
        "UNDER_REVIEW",
    ];

    public static bool IsActive(OrderDispute? dispute) =>
        dispute is not null && ActiveStatuses.Contains(dispute.Status);

    public static bool CanRespond(OrderDispute? dispute, bool isProvider) =>
        IsActive(dispute) &&
        dispute!.ResponseRequestedFrom == (isProvider ? "PROVIDER" : "CLIENT") &&
        dispute.Status == $"WAITING_FOR_{dispute.ResponseRequestedFrom}";

    public static string DeadlineLabel(OrderDispute dispute, DateTimeOffset now)
    {
        if (dispute.ResponseDeadlineAt is not { } deadline) return "No response deadline is active.";
        var state = deadline <= now ? "Deadline passed" : "Respond by";
        return $"{state} {deadline.ToLocalTime():MMM d, yyyy h:mm tt}. No winner is selected automatically.";
    }

    public static string FinancialLabel(OrderDispute dispute) => dispute.Status switch
    {
        "RESOLVED_CLIENT" => "Resolved for client. The affected earning remains frozen; no refund has been issued yet.",
        "RESOLVED_PROVIDER" => "Resolved for provider. The affected earning was restored to its recorded pre-freeze state.",
        "CLOSED" => "Closed without a client financial decision. No refund was issued.",
        _ when dispute.AffectedEarnings.Count > 0 => "Completion is paused and the affected earning is frozen. No refund has been issued.",
        _ => "Completion is paused while CampusGig reviews this dispute. No refund has been issued.",
    };
}
