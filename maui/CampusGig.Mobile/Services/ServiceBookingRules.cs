using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class ServiceBookingRules
{
    public const int MinimumRequirementsLength = 10;
    public const int MaximumAdvanceBookingDays = 365;

    public static DateTime EarliestDeliveryDate(ServicePackage package, DateTime today) =>
        today.Date.AddDays(package.DeliveryDays);

    public static bool IsDeliveryDateValid(ServicePackage? package, DateTime requestedDate, DateTime today) =>
        package is not null &&
        requestedDate.Date >= EarliestDeliveryDate(package, today) &&
        requestedDate.Date <= today.Date.AddDays(MaximumAdvanceBookingDays);

    public static bool CanSubmit(
        ServicePackage? package,
        string? requirements,
        DateTime requestedDate,
        DateTime today) =>
        package is not null &&
        (requirements?.Trim().Length ?? 0) >= MinimumRequirementsLength &&
        IsDeliveryDateValid(package, requestedDate, today);

    public static bool CanStartSubmission(
        bool isBusy,
        ServicePackage? package,
        string? requirements,
        DateTime requestedDate,
        DateTime today) =>
        !isBusy && CanSubmit(package, requirements, requestedDate, today);
}
