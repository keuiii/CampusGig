namespace CampusGig.Mobile.Services;

public static class ProfileActionRules
{
    public static bool CanSaveStudent(bool changed, string? schoolId, string? program, string? yearLevel) =>
        changed && !string.IsNullOrWhiteSpace(schoolId) && !string.IsNullOrWhiteSpace(program) &&
        int.TryParse(yearLevel, out var year) && year is >= 1 and <= 6;

    public static bool CanChangePassword(string? current, string? next, string? confirmation, bool mfaEnabled, string? mfaCode) =>
        (current?.Length ?? 0) >= 8 && (next?.Length ?? 0) >= 8 && next == confirmation &&
        (!mfaEnabled || (mfaCode?.Trim().Length ?? 0) >= 6);

    public static bool CanConfirmMfa(string? code) => code?.Trim().Length == 6;

    public static bool CanSubmitVerification(bool hasStudentProfile, bool hasSelectedFile) =>
        hasStudentProfile && hasSelectedFile;

    public static bool CanSubmitSupport(string? category, string? subject, string? message) =>
        !string.IsNullOrWhiteSpace(category) &&
        subject?.Trim().Length is >= 5 and <= 120 &&
        message?.Trim().Length is >= 20 and <= 2000;
}
