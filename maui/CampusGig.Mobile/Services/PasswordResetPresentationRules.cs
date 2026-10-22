namespace CampusGig.Mobile.Services;

public static class PasswordResetPresentationRules
{
    private const string SecondFactorPrompt =
        "Enter your authenticator or recovery code to reset this protected account";

    public static string MaskEmail(string? email)
    {
        var normalized = email?.Trim() ?? "";
        var separator = normalized.IndexOf('@');
        if (separator <= 0 || separator == normalized.Length - 1) return "Your account email";

        var local = normalized[..separator];
        var domain = normalized[(separator + 1)..];
        var visiblePrefix = local[..Math.Min(2, local.Length)];
        var hiddenCount = Math.Max(3, local.Length - visiblePrefix.Length);
        return $"{visiblePrefix}{new string('*', hiddenCount)}@{domain}";
    }

    public static bool RequiresSecondFactor(string? apiMessage) =>
        string.Equals(apiMessage?.Trim(), SecondFactorPrompt, StringComparison.OrdinalIgnoreCase);
}
