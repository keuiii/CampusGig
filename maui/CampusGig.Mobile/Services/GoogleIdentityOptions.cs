namespace CampusGig.Mobile.Services;

public static class GoogleIdentityOptions
{
    // OAuth client IDs are public identifiers. The server verifies every returned ID token.
    public const string ServerClientId =
        "271330210270-pk7gte0i1aik5mgi1i38g4uau1e6uhfa.apps.googleusercontent.com";

    public static bool IsConfigured =>
        ServerClientId.EndsWith(".apps.googleusercontent.com", StringComparison.Ordinal) &&
        ServerClientId.Length > 40;
}
