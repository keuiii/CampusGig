using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class ServiceBookingRules
{
    public const int MinimumRequirementsLength = 10;

    public static bool CanSubmit(ServicePackage? package, string? requirements) =>
        package is not null &&
        (requirements?.Trim().Length ?? 0) >= MinimumRequirementsLength;

    public static bool CanStartSubmission(bool isBusy, ServicePackage? package, string? requirements) =>
        !isBusy && CanSubmit(package, requirements);
}
