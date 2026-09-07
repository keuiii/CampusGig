namespace CampusGig.Mobile.Services;

public static class MfaPresentationRules
{
    public static string StatusLabel(bool enabled) => enabled ? "PROTECTED" : "OFF";

    public static string Summary(bool enabled, int recoveryCodes, int trustedDevices)
    {
        if (!enabled) return "Set up an authenticator app to protect sign-ins and sensitive account changes.";

        return $"{recoveryCodes} recovery code{(recoveryCodes == 1 ? "" : "s")} remaining  ·  " +
               $"{trustedDevices} remembered device{(trustedDevices == 1 ? "" : "s")}";
    }
}
