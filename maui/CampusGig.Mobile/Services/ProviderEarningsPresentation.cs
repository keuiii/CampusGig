using System.Globalization;

namespace CampusGig.Mobile.Services;

public static class ProviderEarningsPresentation
{
    public static string FormatAmount(int amountCentavos, string currency)
    {
        var normalized = currency.Trim().ToUpperInvariant();
        if (normalized.Length != 3) return $"{amountCentavos / 100m:N2}";
        try
        {
            var region = normalized == "PHP"
                ? new CultureInfo("en-PH")
                : CultureInfo.InvariantCulture;
            return string.Create(
                region,
                $"{normalized} {amountCentavos / 100m:N2}");
        }
        catch (CultureNotFoundException)
        {
            return $"{normalized} {amountCentavos / 100m:N2}";
        }
    }
}
