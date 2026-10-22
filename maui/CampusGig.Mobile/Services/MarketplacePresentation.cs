namespace CampusGig.Mobile.Services;

public static class MarketplacePresentation
{
    private static readonly IReadOnlyDictionary<string, string> StatusLabels =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["REQUIRES_ACTION"] = "Awaiting payment",
            ["RECONCILIATION_REQUIRED"] = "Needs review",
            ["PENDING_REVIEW"] = "Pending review",
            ["REVISION_REQUESTED"] = "Revision requested",
            ["PARTIALLY_REFUNDED"] = "Partially refunded",
            ["REFUND_PENDING"] = "Refund processing",
            ["RESOLVED_CLIENT"] = "Resolved for client",
            ["RESOLVED_PROVIDER"] = "Resolved for provider",
            ["RESOLVED_SPLIT"] = "Resolved with split outcome",
        };

    public static string StatusLabel(string? status)
    {
        if (string.IsNullOrWhiteSpace(status)) return "Not available";

        var normalized = status.Trim().ToUpperInvariant();
        if (StatusLabels.TryGetValue(normalized, out var label)) return label;

        return string.Join(' ', normalized
            .Split('_', StringSplitOptions.RemoveEmptyEntries)
            .Select(word => char.ToUpperInvariant(word[0]) + word[1..].ToLowerInvariant()));
    }
}
