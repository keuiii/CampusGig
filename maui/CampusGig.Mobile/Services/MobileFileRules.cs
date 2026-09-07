namespace CampusGig.Mobile.Services;

public static class MobileFileRules
{
    public const long MaximumProfileUploadBytes = 5 * 1024 * 1024;
    public const long MaximumMessageAttachmentBytes = 15 * 1024 * 1024;
    public const int MaximumMessageAttachments = 3;
    public const long MaximumDeliverableBytes = 15 * 1024 * 1024;
    public const int MaximumDeliverableFiles = 5;

    public static bool ExceedsProfileUploadLimit(long? sizeBytes) =>
        sizeBytes is > MaximumProfileUploadBytes;

    public static bool ExceedsMessageAttachmentLimit(long? sizeBytes) =>
        sizeBytes is > MaximumMessageAttachmentBytes;

    public static bool ExceedsDeliverableLimit(long? sizeBytes) =>
        sizeBytes is > MaximumDeliverableBytes;

    public static bool IsSupportedDeliverable(string? fileName) =>
        Path.GetExtension(fileName ?? "").ToLowerInvariant() is
            ".jpg" or ".jpeg" or ".png" or ".webp" or ".pdf" or ".zip" or ".docx" or ".xlsx";

    public static string DeliverableContentType(string fileName, string? reportedContentType) =>
        !string.IsNullOrWhiteSpace(reportedContentType) && reportedContentType != "application/octet-stream"
            ? reportedContentType
            : Path.GetExtension(fileName).ToLowerInvariant() switch
            {
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".webp" => "image/webp",
                ".pdf" => "application/pdf",
                ".zip" => "application/zip",
                ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                _ => "application/octet-stream",
            };

    public static bool CanSendMessage(string? body, int attachmentCount) =>
        !string.IsNullOrWhiteSpace(body) || attachmentCount > 0;

    public static string DescribeSelection(long? sizeBytes) => sizeBytes is null
        ? "Document selected"
        : $"{Math.Max(1, Math.Round(sizeBytes.Value / 1024.0))} KB selected";
}
