using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class PasswordChangeFlowRules
{
    public static bool IsImmediate(PasswordChangeResult? result) =>
        !string.IsNullOrWhiteSpace(result?.ConfirmationMethod);

    public static bool IsPending(PasswordChangeResult? result) =>
        string.Equals(result?.Status, "PENDING", StringComparison.OrdinalIgnoreCase)
        && !string.IsNullOrWhiteSpace(result?.Id);

    public static bool IsTerminal(PasswordChangeResult? result) =>
        result is not null && result.Status is "CONFIRMED" or "REJECTED" or "CANCELLED" or "EXPIRED";

    public static bool WasSuccessful(PasswordChangeResult? result) =>
        string.Equals(result?.Status, "CONFIRMED", StringComparison.OrdinalIgnoreCase);
}
