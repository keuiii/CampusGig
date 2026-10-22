namespace CampusGig.Mobile.Services;

public static class PaymentReturnRules
{
    public sealed record AppReturn(string OrderId, string Status, string? RevisionPurchaseId);

    public static AppReturn? ParseAppLink(Uri? uri)
    {
        if (uri is null || uri.Scheme != "campusgig" || uri.Host != "payment-return") return null;
        var values = uri.Query.TrimStart('?')
            .Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => part.Split('=', 2))
            .Where(part => part.Length == 2)
            .Select(part => new
            {
                Key = Uri.UnescapeDataString(part[0]),
                Value = Uri.UnescapeDataString(part[1]),
            })
            .ToList();
        var orderId = values.FirstOrDefault(value => value.Key.Equals("orderId", StringComparison.OrdinalIgnoreCase))?.Value;
        var status = values.FirstOrDefault(value => value.Key.Equals("payment", StringComparison.OrdinalIgnoreCase))?.Value;
        var revisionPurchaseId = values.FirstOrDefault(value => value.Key.Equals("revisionPurchaseId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (string.IsNullOrWhiteSpace(orderId)) return null;
        if (status is not "success" and not "cancelled") return null;
        return new AppReturn(orderId, status, string.IsNullOrWhiteSpace(revisionPurchaseId) ? null : revisionPurchaseId);
    }

    public static bool IsPaid(string? paymentStatus) => paymentStatus == "PAID";

    public static bool IsAwaitingConfirmation(
        string orderId,
        string? pendingOrderId,
        string? paymentStatus) =>
        !string.IsNullOrWhiteSpace(orderId) &&
        orderId == pendingOrderId &&
        !IsPaid(paymentStatus) &&
        paymentStatus is not "FAILED" and not "CANCELLED";

    public static bool ShouldClearPendingCheckout(
        string orderId,
        string? pendingOrderId,
        string? paymentStatus) =>
        !string.IsNullOrWhiteSpace(pendingOrderId) &&
        pendingOrderId == orderId &&
        (IsPaid(paymentStatus) || paymentStatus is "FAILED" or "CANCELLED");

    public static string Guidance(string? paymentStatus, bool awaitingConfirmation) => paymentStatus switch
    {
        "PAID" => "Your payment is verified. The provider can safely continue with this order.",
        "FAILED" => "The payment failed. Review the payment details and try checkout again.",
        "CANCELLED" => "The checkout was cancelled. You can start checkout again when you are ready.",
        "REFUND_PENDING" => "Your refund is being processed.",
        "PARTIALLY_REFUNDED" => "Part of this payment has been refunded.",
        "REFUNDED" => "This payment has been refunded.",
        _ when awaitingConfirmation => "CampusGig is waiting for PayMongo confirmation. Check again if the status does not update shortly.",
        _ => "Complete checkout using an available PayMongo payment method.",
    };
}
