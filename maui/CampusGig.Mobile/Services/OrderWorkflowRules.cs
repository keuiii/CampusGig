using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public static class OrderWorkflowRules
{
    public static bool IsProvider(OrderDetail? order, string? userId) =>
        order is not null && !string.IsNullOrWhiteSpace(userId) && order.Provider.Id == userId;

    public static bool CanDecide(string status, bool isProvider) => isProvider && status == "REQUESTED";
    public static bool CanStart(string status, bool isProvider) => isProvider && status == "ACCEPTED";
    public static bool CanDeliver(string status, bool isProvider) =>
        isProvider && status is "IN_PROGRESS" or "REVISION_REQUESTED";
    public static bool CanReviewDelivery(string status, bool isProvider) => !isProvider && status == "SUBMITTED";
    public static bool CanReviewProvider(string status, bool isProvider, bool hasReview) =>
        !isProvider && status == "COMPLETED" && !hasReview;
    public static bool CanSubmitDelivery(string? note, int fileCount, bool hasOversizedFile) =>
        (note?.Trim().Length ?? 0) >= 3 && fileCount is >= 1 and <= 5 && !hasOversizedFile;
}
