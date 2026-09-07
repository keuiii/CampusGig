namespace CampusGig.Mobile.Services;

public enum AuthFormMode
{
    Login,
    Register,
    Verify,
    Forgot,
    Reset,
    Mfa,
}

public static class AuthFormRules
{
    public static bool IsReady(
        AuthFormMode mode,
        string? email,
        string? password,
        string? displayName,
        string? code,
        bool recoveryCode)
    {
        var normalizedCode = NormalizeCode(code, recoveryCode);
        return mode switch
        {
            AuthFormMode.Mfa => normalizedCode.Length == (recoveryCode ? 10 : 6),
            AuthFormMode.Verify => NormalizeCode(code, false).Length == 6,
            AuthFormMode.Forgot => !string.IsNullOrWhiteSpace(email),
            AuthFormMode.Reset => NormalizeCode(code, false).Length == 6 && (password?.Length ?? 0) >= 8,
            AuthFormMode.Login => !string.IsNullOrWhiteSpace(email) && (password?.Length ?? 0) >= 8,
            AuthFormMode.Register => !string.IsNullOrWhiteSpace(email)
                && (password?.Length ?? 0) >= 8
                && (displayName?.Trim().Length ?? 0) >= 2,
            _ => false,
        };
    }

    public static string NormalizeCode(string? value, bool recoveryCode)
    {
        var characters = (value ?? "").Where(char.IsLetterOrDigit);
        return recoveryCode
            ? new string(characters.Take(10).ToArray()).ToUpperInvariant()
            : new string(characters.Where(char.IsDigit).Take(6).ToArray());
    }
}
