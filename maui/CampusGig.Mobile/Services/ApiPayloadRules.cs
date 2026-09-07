namespace CampusGig.Mobile.Services;

public static class ApiPayloadRules
{
    public static bool IsEmptyOptionalPayload(string? content) =>
        string.IsNullOrWhiteSpace(content)
        || string.Equals(content.Trim(), "null", StringComparison.OrdinalIgnoreCase);
}
