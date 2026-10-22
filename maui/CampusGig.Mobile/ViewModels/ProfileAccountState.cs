using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.ViewModels;

public sealed record ProfileAccountState(
    string DisplayName,
    string Email,
    string RolesText,
    bool IsStudent,
    bool IsClientOnly,
    bool ShowsProviderJourney,
    bool IsProvider,
    string ProviderSubtitle)
{
    public static ProfileAccountState From(AuthUser? user)
    {
        var roles = user?.Roles ?? [];
        var isProvider = roles.Contains("PROVIDER");
        return new ProfileAccountState(
            user?.DisplayName ?? "CampusGig user",
            user?.Email ?? "",
            roles.Count > 0 ? string.Join(" · ", roles) : "CLIENT",
            roles.Contains("STUDENT"),
            ProfilePresentationRules.IsClientOnly(roles),
            ProfilePresentationRules.ShowsProviderJourney(roles),
            isProvider,
            isProvider ? "Headline, bio, skills and availability" : "Unlocks after student verification");
    }
}
