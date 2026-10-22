using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class RefundPresentation
{
    private static readonly HashSet<string> PendingStatuses =
        ["REQUESTED", "PENDING", "PROCESSING", "RECONCILIATION_REQUIRED"];

    public static bool IsPending(MarketplaceRefund? refund) =>
        refund is not null && PendingStatuses.Contains(refund.Status);

    public static string Guidance(RefundEligibility? eligibility)
    {
        var refund = eligibility?.Refund;
        if (refund?.Status == "SUCCEEDED")
            return "PayMongo confirmed the full refund, including the CampusGig service fee.";
        if (IsPending(refund))
            return refund!.Status == "RECONCILIATION_REQUIRED"
                ? "The refund outcome needs administrator reconciliation. Do not submit another request."
                : "Work and delivery are blocked while PayMongo processes the full refund.";
        if (refund?.Status == "FAILED")
            return "PayMongo rejected the refund. CampusGig preserved the failed attempt for support review.";
        return eligibility?.CanRequest == true
            ? "This purchase is eligible for a server-authorized full refund. The provider principal and CampusGig fee are returned together."
            : "";
    }

    public static string ActionLabel(RefundEligibility? eligibility) =>
        eligibility?.EligibleReasons.Contains("MISSED_RUSH_DEADLINE") == true
            ? "Request full rush refund"
            : "Cancel and request full refund";
}
