using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class OrderWorkflowRules
{
    public static bool CanDecline(string? reason) => (reason?.Trim().Length ?? 0) >= 3;
    public static bool IsProvider(OrderDetail? order, string? userId) =>
        order is not null && !string.IsNullOrWhiteSpace(userId) && order.Provider.Id == userId;

    public static bool CanDecide(string status, bool isProvider) => isProvider && status == "REQUESTED";
    public static bool CanCancel(string status, bool isProvider) => !isProvider && status == "REQUESTED";
    public static bool CanStart(string status, bool isProvider, string? paymentStatus) =>
        isProvider && status == "ACCEPTED" && paymentStatus == "PAID";
    public static bool ShouldShowPayment(string status, bool isProvider, string? paymentStatus) =>
        !isProvider &&
        (status is "ACCEPTED" or "IN_PROGRESS" or "REVISION_REQUESTED" or "SUBMITTED" or "COMPLETED" ||
         !string.IsNullOrWhiteSpace(paymentStatus));
    public static bool CanOpenCheckout(string status, bool isProvider, string? paymentStatus) =>
        !isProvider &&
        status is "ACCEPTED" or "IN_PROGRESS" or "REVISION_REQUESTED" or "SUBMITTED" or "COMPLETED" &&
        paymentStatus is not ("PAID" or "REFUND_PENDING" or "REFUNDED");
    public static string PaymentStatusLabel(string? status) => status switch
    {
        "PAID" => "PAYMENT CONFIRMED",
        "REQUIRES_ACTION" => "AWAITING PAYMENT",
        "FAILED" => "PAYMENT FAILED",
        "REFUND_PENDING" => "REFUND PROCESSING",
        "PARTIALLY_REFUNDED" => "PARTIALLY REFUNDED",
        "REFUNDED" => "REFUNDED",
        "CANCELLED" => "PAYMENT CANCELLED",
        _ => "PAYMENT PENDING",
    };
    public static bool CanDeliver(string status, bool isProvider, string? paymentStatus) =>
        isProvider && paymentStatus == "PAID" && status is "IN_PROGRESS" or "REVISION_REQUESTED";
    public static bool CanReviewDelivery(string status, bool isProvider, string? paymentStatus) =>
        !isProvider && status == "SUBMITTED" && paymentStatus == "PAID";
    public static bool CanReviewProvider(string status, bool isProvider, bool hasReview, string? paymentStatus) =>
        !isProvider && status == "COMPLETED" && !hasReview && paymentStatus == "PAID";
    public static bool IsValidRating(int rating) => rating is >= 1 and <= 5;
    public static string RatingDescription(int rating) => rating switch
    {
        5 => "Excellent",
        4 => "Very good",
        3 => "Good",
        2 => "Fair",
        1 => "Poor",
        _ => "Select a rating",
    };
    public static string RevisionUsageLabel(int used, int limit) =>
        limit <= 0 ? "No revisions included" : $"{Math.Max(0, limit - used)} of {limit} revisions remaining";
    public static bool CanSubmitDelivery(string? note, int fileCount, bool hasOversizedFile) =>
        (note?.Trim().Length ?? 0) >= 3 && fileCount is >= 1 and <= 5 && !hasOversizedFile;
}
