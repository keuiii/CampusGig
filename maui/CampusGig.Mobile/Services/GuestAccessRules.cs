namespace CampusGig.Mobile.Services;

public enum GuestProtectedAction
{
    ViewSavedServices,
    SaveService,
    ViewNotifications,
    ViewProfile,
    SendServiceRequest,
    MessageProvider,
}

public sealed record PendingAuthIntent(
    GuestProtectedAction Action,
    string? ServiceId,
    string? PackageId,
    string? ProviderId);

public static class GuestAccessRules
{
    public const string GuestModePreferenceKey = "campusgig_guest_mode";
    public const string PendingActionPreferenceKey = "campusgig_pending_auth_action";
    public const string PendingServicePreferenceKey = "campusgig_pending_auth_service";
    public const string PendingPackagePreferenceKey = "campusgig_pending_auth_package";
    public const string PendingProviderPreferenceKey = "campusgig_pending_auth_provider";

    public static bool RequiresAuthentication(GuestProtectedAction action, bool authenticated) =>
        !authenticated && Enum.IsDefined(action);

    public static PendingAuthIntent? CreateServiceRequestIntent(string? serviceId, string? packageId)
    {
        if (!IsSafeIdentifier(serviceId)) return null;
        return new PendingAuthIntent(
            GuestProtectedAction.SendServiceRequest,
            serviceId!,
            IsSafeIdentifier(packageId) ? packageId : null,
            null);
    }

    public static PendingAuthIntent? CreateProviderInquiryIntent(string? providerId)
    {
        if (!IsSafeIdentifier(providerId)) return null;
        return new PendingAuthIntent(
            GuestProtectedAction.MessageProvider,
            null,
            null,
            providerId);
    }

    public static PendingAuthIntent? ParseIntent(
        string? action,
        string? serviceId,
        string? packageId,
        string? providerId)
    {
        if (!Enum.TryParse<GuestProtectedAction>(action, ignoreCase: false, out var parsedAction))
            return null;
        return parsedAction switch
        {
            GuestProtectedAction.SendServiceRequest => CreateServiceRequestIntent(serviceId, packageId),
            GuestProtectedAction.MessageProvider => CreateProviderInquiryIntent(providerId),
            _ => null,
        };
    }

    public static string PromptMessage(GuestProtectedAction action) => action switch
    {
        GuestProtectedAction.ViewSavedServices => "Log in or create an account to view your saved services.",
        GuestProtectedAction.SaveService => "Log in or create an account to save this service.",
        GuestProtectedAction.ViewNotifications => "Log in or create an account to view your notifications.",
        GuestProtectedAction.ViewProfile => "Log in or create an account to open your CampusGig profile.",
        GuestProtectedAction.SendServiceRequest => "Log in or create an account to request this service. You will return to this service afterward.",
        GuestProtectedAction.MessageProvider => "Log in or create an account to message this provider. The conversation will open afterward.",
        _ => "Log in or create an account to continue.",
    };

    private static bool IsSafeIdentifier(string? value) =>
        !string.IsNullOrWhiteSpace(value) &&
        value.Length <= 128 &&
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_');
}
