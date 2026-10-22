using System.Globalization;

namespace CampusGig.Mobile.Services;

public sealed record ProviderListingPackageInput(
    string Tier,
    bool Enabled,
    string? Name,
    string? Description,
    string? PricePesos,
    string? DeliveryDays,
    string? RevisionLimit);

public sealed record ProviderListingValidationResult(
    IReadOnlyList<string> Errors,
    IReadOnlyList<ProviderListingPackagePayload> Packages,
    ProviderListingSinglePricePayload? SinglePrice = null)
{
    public bool IsValid => Errors.Count == 0;
}

public sealed record ProviderListingPackagePayload(
    string Tier,
    string Name,
    string Description,
    int PriceCentavos,
    int DeliveryDays,
    int RevisionLimit);

public sealed record ProviderListingSinglePricePayload(
    int BasePriceCentavos,
    int NormalDeliveryMinutes,
    int IncludedRevisionLimit,
    bool AcceptsRushOrders,
    string? FastestRushTier);

public static class ProviderListingEditorRules
{
    public const int TitleMinimumLength = 10;
    public const int TitleMaximumLength = 120;
    public const int DescriptionMinimumLength = 50;
    public const int DescriptionMaximumLength = 3000;
    public const int PackageNameMaximumLength = 80;
    public const int PackageDescriptionMaximumLength = 500;
    public const long MaximumMediaBytes = 8 * 1024 * 1024;
    public const int MaximumPortfolioFiles = 5;

    private static readonly HashSet<string> DeliveryMethods =
        new(StringComparer.Ordinal) { "ONLINE", "IN_PERSON", "HYBRID" };

    private static readonly HashSet<string> PackageTiers =
        new(StringComparer.Ordinal) { "BASIC", "STANDARD", "PREMIUM" };

    public static bool CanEdit(string? status) => status is "DRAFT" or "REJECTED";

    public static ProviderListingValidationResult Validate(
        string? categoryId,
        string? title,
        string? description,
        string? deliveryMethod,
        string? campusLocation,
        IEnumerable<ProviderListingPackageInput> packageInputs)
    {
        var errors = ValidateCommon(categoryId, title, description, deliveryMethod, campusLocation);
        var packages = new List<ProviderListingPackagePayload>();

        var enabled = packageInputs.Where(item => item.Enabled).ToList();
        if (enabled.Count is < 1 or > 3)
            errors.Add("Enable between one and three packages.");
        if (enabled.All(item => item.Tier != "BASIC"))
            errors.Add("The Basic package is required.");
        if (enabled.Select(item => item.Tier).Distinct(StringComparer.Ordinal).Count() != enabled.Count ||
            enabled.Any(item => !PackageTiers.Contains(item.Tier)))
            errors.Add("Each enabled package must use a unique valid tier.");

        foreach (var item in enabled)
        {
            var label = TierLabel(item.Tier);
            var name = item.Name?.Trim() ?? "";
            var packageDescription = item.Description?.Trim() ?? "";
            if (name.Length is < 2 or > PackageNameMaximumLength)
                errors.Add($"{label} package name must be 2-{PackageNameMaximumLength} characters.");
            if (packageDescription.Length is < 10 or > PackageDescriptionMaximumLength)
                errors.Add($"{label} package details must be 10-{PackageDescriptionMaximumLength} characters.");
            if (!TryPriceCentavos(item.PricePesos, out var priceCentavos))
                errors.Add($"{label} price must be between ₱1 and ₱100,000 with no more than two decimal places.");
            if (!int.TryParse(item.DeliveryDays, out var deliveryDays) || deliveryDays is < 1 or > 90)
                errors.Add($"{label} delivery must be between 1 and 90 days.");
            if (!int.TryParse(item.RevisionLimit, out var revisionLimit) || revisionLimit is < 0 or > 20)
                errors.Add($"{label} revisions must be between 0 and 20.");

            if (name.Length is >= 2 and <= PackageNameMaximumLength &&
                packageDescription.Length is >= 10 and <= PackageDescriptionMaximumLength &&
                TryPriceCentavos(item.PricePesos, out priceCentavos) &&
                int.TryParse(item.DeliveryDays, out deliveryDays) && deliveryDays is >= 1 and <= 90 &&
                int.TryParse(item.RevisionLimit, out revisionLimit) && revisionLimit is >= 0 and <= 20)
            {
                packages.Add(new ProviderListingPackagePayload(
                    item.Tier,
                    name,
                    packageDescription,
                    priceCentavos,
                    deliveryDays,
                    revisionLimit));
            }
        }

        return new ProviderListingValidationResult(errors, packages);
    }

    public static ProviderListingValidationResult ValidateSinglePrice(
        string? categoryId,
        string? title,
        string? description,
        string? deliveryMethod,
        string? campusLocation,
        string? pricePesos,
        string? deliveryDaysValue,
        string? revisionLimitValue,
        bool acceptsRushOrders = false,
        string? fastestRushTier = null)
    {
        var errors = ValidateCommon(categoryId, title, description, deliveryMethod, campusLocation);
        if (!TryPriceCentavos(pricePesos, out var priceCentavos))
            errors.Add("Price must be between ₱1 and ₱100,000 with no more than two decimal places.");
        if (!int.TryParse(deliveryDaysValue, out var deliveryDays) || deliveryDays is < 1 or > 90)
            errors.Add("Delivery must be between 1 and 90 whole days.");
        if (!int.TryParse(revisionLimitValue, out var revisionLimit) || revisionLimit is < 0 or > 20)
            errors.Add("Included revisions must be between 0 and 20.");
        var rushMinutes = fastestRushTier switch
        {
            "HOURS_24" => 1440,
            "HOURS_12" => 720,
            "HOURS_6" => 360,
            "HOURS_3" => 180,
            _ => 0,
        };
        if (acceptsRushOrders && rushMinutes == 0)
            errors.Add("Choose a valid fastest rush turnaround.");
        if (!acceptsRushOrders && fastestRushTier is not null)
            errors.Add("Fastest rush turnaround requires rush orders to be enabled.");
        if (acceptsRushOrders && int.TryParse(deliveryDaysValue, out deliveryDays) && rushMinutes >= deliveryDays * 1440)
            errors.Add("Normal delivery must be slower than the fastest rush turnaround.");

        var terms = errors.Count == 0
            ? new ProviderListingSinglePricePayload(
                priceCentavos,
                deliveryDays * 1440,
                revisionLimit,
                acceptsRushOrders,
                acceptsRushOrders ? fastestRushTier : null)
            : null;
        return new ProviderListingValidationResult(errors, [], terms);
    }

    public static bool TryPriceCentavos(string? value, out int centavos)
    {
        centavos = 0;
        if (!TryParseDecimal(value, out var pesos) || pesos is < 1m or > 100_000m)
            return false;
        var exactCentavos = pesos * 100m;
        if (decimal.Truncate(exactCentavos) != exactCentavos)
            return false;
        centavos = decimal.ToInt32(exactCentavos);
        return true;
    }

    public static bool IsSupportedCover(string? fileName) =>
        Path.GetExtension(fileName ?? "").ToLowerInvariant() is ".jpg" or ".jpeg" or ".png" or ".webp";

    public static bool IsSupportedPortfolio(string? fileName) =>
        IsSupportedCover(fileName) || Path.GetExtension(fileName ?? "").Equals(".pdf", StringComparison.OrdinalIgnoreCase);

    public static string MediaContentType(string fileName) =>
        Path.GetExtension(fileName).ToLowerInvariant() switch
        {
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".pdf" => "application/pdf",
            _ => "application/octet-stream",
        };

    private static bool TryParseDecimal(string? value, out decimal amount) =>
        decimal.TryParse(value, NumberStyles.Number, CultureInfo.CurrentCulture, out amount) ||
        decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out amount);

    private static List<string> ValidateCommon(
        string? categoryId,
        string? title,
        string? description,
        string? deliveryMethod,
        string? campusLocation)
    {
        var errors = new List<string>();
        var normalizedTitle = title?.Trim() ?? "";
        var normalizedDescription = description?.Trim() ?? "";
        var normalizedLocation = campusLocation?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(categoryId))
            errors.Add("Choose a service category.");
        if (normalizedTitle.Length is < TitleMinimumLength or > TitleMaximumLength)
            errors.Add($"Service title must be {TitleMinimumLength}-{TitleMaximumLength} characters.");
        if (normalizedDescription.Length is < DescriptionMinimumLength or > DescriptionMaximumLength)
            errors.Add($"Description must be {DescriptionMinimumLength}-{DescriptionMaximumLength} characters.");
        if (!DeliveryMethods.Contains(deliveryMethod ?? ""))
            errors.Add("Choose a valid delivery method.");
        if (normalizedLocation.Length > 160)
            errors.Add("Campus location must be 160 characters or fewer.");
        return errors;
    }

    private static string TierLabel(string tier) => tier.Length == 0
        ? "Package"
        : string.Concat(char.ToUpperInvariant(tier[0]), tier[1..].ToLowerInvariant());
}
