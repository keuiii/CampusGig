namespace CampusGig.Mobile.Services;

public sealed record PasswordStrength(int Score, double Progress, string Label, string LightColor, string DarkColor);

public static class PasswordStrengthRules
{
    public static PasswordStrength Evaluate(string? password)
    {
        if (string.IsNullOrEmpty(password))
            return new(0, 0, "", "#CBD3CE", "#385046");

        var score = 0;
        if (password.Length >= 8) score++;
        if (password.Any(char.IsLower) && password.Any(char.IsUpper)) score++;
        if (password.Any(char.IsDigit)) score++;
        if (password.Any(character => !char.IsLetterOrDigit(character)) || password.Length >= 12) score++;

        return score switch
        {
            <= 1 => new(score, 0.25, "Weak", "#C74335", "#FF8F84"),
            2 => new(score, 0.50, "Fair", "#C88416", "#F2BE63"),
            3 => new(score, 0.75, "Good", "#4D8A39", "#9ED47E"),
            _ => new(score, 1, "Strong", "#0F8060", "#71D7B1"),
        };
    }

    public static bool ConfirmationMatches(string? password, string? confirmation) =>
        !string.IsNullOrEmpty(confirmation) && string.Equals(password, confirmation, StringComparison.Ordinal);
}
