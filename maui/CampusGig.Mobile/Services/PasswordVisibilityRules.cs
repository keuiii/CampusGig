namespace CampusGig.Mobile.Services;

public static class PasswordVisibilityRules
{
    public static bool Toggle(bool isPassword) => !isPassword;
    public static string ButtonLabel(bool isPassword) => isPassword ? "Show" : "Hide";
}
