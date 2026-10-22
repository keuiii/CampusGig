using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class PricingModelRules
{
    public static bool IsLegacy(string? value) =>
        string.IsNullOrWhiteSpace(value) || value == PricingModels.LegacyPackages;

    public static bool IsSinglePriceV2(string? value) =>
        value == PricingModels.SinglePriceV2;

    public static string FormatDeliveryMinutes(int? minutes)
    {
        if (minutes is null or < 1) return "Unavailable";
        if (minutes % 1440 == 0)
        {
            var days = minutes.Value / 1440;
            return $"{days} day{(days == 1 ? "" : "s")}";
        }
        if (minutes % 60 == 0)
        {
            var hours = minutes.Value / 60;
            return $"{hours} hour{(hours == 1 ? "" : "s")}";
        }
        return $"{minutes} minutes";
    }
}
