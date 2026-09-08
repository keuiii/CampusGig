using System.Text.Json.Serialization;
using System.ComponentModel;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Models;

public sealed class ApiList<T>
{
    public List<T> Data { get; set; } = [];
}

public sealed class NotificationList
{
    public List<NotificationItem> Data { get; set; } = [];
    public int UnreadCount { get; set; }
}

public sealed class NotificationReadAllResult
{
    public int Updated { get; set; }
    public string Message { get; set; } = "";
}

public sealed class ApiResult<T>
{
    public T Data { get; set; } = default!;
    public string Message { get; set; } = "";
}

public sealed class AuthUser
{
    public string Id { get; set; } = "";
    public string Email { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool HasAvatar { get; set; }
    public string Status { get; set; } = "";
    public List<string> Roles { get; set; } = [];
}

public sealed class AuthResponse
{
    public string? AccessToken { get; set; }
    public AuthUser? User { get; set; }
    public bool RequiresTwoFactor { get; set; }
    public string? ChallengeToken { get; set; }
    public string? TrustedDeviceToken { get; set; }
}

public sealed class GoogleSocialLoginRequest
{
    public string Provider => "GOOGLE";
    public required string IdToken { get; init; }
    public string? TrustedDeviceToken { get; init; }
}

public sealed class RegistrationResponse
{
    public bool RequiresVerification { get; set; }
    public string Email { get; set; } = "";
    public string? DevelopmentCode { get; set; }
}

public sealed class CategoryItem
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Icon { get; set; } = "";
    public int ServiceCount { get; set; }
    public string CountLabel => $"{ServiceCount} services";
    public string IconGlyph => Id switch
    {
        "graphic-design" => "▧",
        "tutoring" => "A+",
        "programming" => "</>",
        "photography" => "◉",
        "video-editing" => "▶",
        "writing" => "Aa",
        _ => Icon,
    };
    public string IconBackground => Id switch
    {
        "graphic-design" => "#FFE6DD",
        "tutoring" => "#EEE7FF",
        "programming" => "#E2EEFF",
        "photography" => "#FFF0C9",
        "video-editing" => "#DEF2E6",
        "writing" => "#FDE6EF",
        _ => "#DEF2E6",
    };
    public string IconColor => Id switch
    {
        "graphic-design" => "#C85B39",
        "tutoring" => "#6C51B7",
        "programming" => "#376FB5",
        "photography" => "#A8740D",
        "video-editing" => "#287E56",
        "writing" => "#B44F78",
        _ => "#287E56",
    };
}

public sealed class SchoolItem
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string ShortName { get; set; } = "";
    public string City { get; set; } = "";
}

public sealed class ServicePackage
{
    public string Id { get; set; } = "";
    public string Tier { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public int PriceCentavos { get; set; }
    public int DeliveryDays { get; set; }
    public int RevisionLimit { get; set; }
}

public sealed class ServiceItem
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Category { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public string Provider { get; set; } = "";
    public bool ProviderHasAvatar { get; set; }
    public long ProviderAvatarVersion { get; set; }
    public string SchoolId { get; set; } = "";
    public string School { get; set; } = "";
    public int Price { get; set; }
    public double Rating { get; set; }
    public string Delivery { get; set; } = "";
    public List<ServicePackage> Packages { get; set; } = [];
    public string? CoverMediaId { get; set; }
    public List<ServiceMedia> Portfolio { get; set; } = [];
    public string? CoverImageUrl { get; set; }
    public string? ProviderAvatarUrl { get; set; }
    public string ProviderInitial => string.IsNullOrWhiteSpace(Provider) ? "C" : Provider[..1].ToUpperInvariant();
    public string PriceLabel => $"From ₱{Price:N0}";
    public string ProviderLabel => $"{Provider} · {School}";
}

public sealed class ServiceMedia
{
    public string Id { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string MimeType { get; set; } = "";
}

public class OrderItem
{
    public string Id { get; set; } = "";
    public string OrderNumber { get; set; } = "";
    public string Title { get; set; } = "";
    public string Status { get; set; } = "";
    public string Requirements { get; set; } = "";
    public int TotalCentavos { get; set; }
    public string Currency { get; set; } = "PHP";
    public DateTimeOffset DueAt { get; set; }
    public OrderParty Provider { get; set; } = new();
    public OrderParty Client { get; set; } = new();
    [JsonPropertyName("package")]
    public ServicePackage Package { get; set; } = new();
    public DateTimeOffset CreatedAt { get; set; }
    public string StatusLabel => Status.Replace('_', ' ');
    public string PriceLabel => $"₱{TotalCentavos / 100m:N2}";
    public string DueLabel => $"Due {DueAt:MMM d, yyyy}";
    public string ProviderLabel => $"Provider · {Provider.DisplayName}";
}

public sealed class OrderDetail : OrderItem
{
    public int RevisionsUsed { get; set; }
    public int RevisionLimit { get; set; }
    public List<OrderFileItem> Files { get; set; } = [];
    public List<OrderRevisionItem> Revisions { get; set; } = [];
    public OrderReviewItem? Review { get; set; }
    public List<OrderHistoryItem> History { get; set; } = [];
}

public sealed class OrderFileItem
{
    public string Id { get; set; } = "";
    public string Purpose { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string MimeType { get; set; } = "";
    public long SizeBytes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string SizeLabel => SizeBytes < 1024 * 1024
        ? $"{Math.Max(1, SizeBytes / 1024d):N0} KB"
        : $"{SizeBytes / 1024d / 1024d:N1} MB";
}

public sealed class OrderRevisionItem
{
    public string Id { get; set; } = "";
    public int SequenceNumber { get; set; }
    public string Instructions { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
}

public sealed class OrderReviewItem
{
    public string Id { get; set; } = "";
    public int OverallRating { get; set; }
    public string? Comment { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class OrderHistoryItem
{
    public string Id { get; set; } = "";
    public string? FromStatus { get; set; }
    public string ToStatus { get; set; } = "";
    public string? Note { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public OrderParty Actor { get; set; } = new();
}

public sealed class OrderParty
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
}

public sealed class ConversationItem
{
    public string Id { get; set; } = "";
    public int UnreadCount { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public ConversationParticipant Participant { get; set; } = new();
    public ConversationMessage? LatestMessage { get; set; }
    public OrderItem Order { get; set; } = new();
    public string Preview
    {
        get
        {
            if (LatestMessage is null) return "No messages yet — start the conversation";
            if (!string.IsNullOrWhiteSpace(LatestMessage.Body))
                return $"{(LatestMessage.IsMine ? "You: " : "")}{LatestMessage.Body}";

            var count = LatestMessage.Attachments.Count;
            return $"{(LatestMessage.IsMine ? "You sent" : "Sent")} {count} attachment{(count == 1 ? "" : "s")}";
        }
    }
    public bool HasUnread => UnreadCount > 0;
    public string UnreadLabel => UnreadCount > 9 ? "9+" : UnreadCount.ToString();
    public string UpdatedLabel
    {
        get
        {
            var local = UpdatedAt.LocalDateTime;
            return local.Date == DateTime.Today ? local.ToString("h:mm tt") : local.ToString("MMM d");
        }
    }
}

public sealed class ConversationParticipant
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool HasAvatar { get; set; }
    public long AvatarVersion { get; set; }
    public string? AvatarUrl { get; set; }
    public string Initial
    {
        get
        {
            if (string.IsNullOrWhiteSpace(DisplayName)) return "C";
            var parts = DisplayName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            return string.Join("", parts.Take(2).Select(p => char.ToUpperInvariant(p[0])));
        }
    }
}

public sealed class ConversationMessage : INotifyPropertyChanged
{
    private bool isRead;
    public string Id { get; set; } = "";
    public string? Body { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTime CampusCreatedAt => CampusTime.ToPhilippineTime(CreatedAt);
    public bool IsMine { get; set; }
    public bool IsRead
    {
        get => isRead;
        set
        {
            if (isRead == value) return;
            isRead = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsRead)));
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(DeliveryLabel)));
        }
    }
    public string DeliveryLabel => IsRead ? "Read" : "Sent";
    public event PropertyChangedEventHandler? PropertyChanged;
    public List<MessageAttachment> Attachments { get; set; } = [];
    public ConversationParticipant Sender { get; set; } = new();
    public string AttachmentSummary => Attachments.Count == 0
        ? ""
        : $"{Attachments.Count} attachment{(Attachments.Count == 1 ? "" : "s")} · tap to download";
}

public sealed class MessageAttachment
{
    public string Id { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string MimeType { get; set; } = "";
    public long SizeBytes { get; set; }
}

public sealed class NotificationItem
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public string? OrderId { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string IconGlyph => Type switch
    {
        "NEW_MESSAGE" => "✉",
        "ORDER_ACCEPTED" or "ORDER_COMPLETED" => "✓",
        _ => "↗",
    };
}

public sealed class StudentProfile
{
    public string SchoolId { get; set; } = "";
    public string? Program { get; set; }
    public int? YearLevel { get; set; }
    public string? Bio { get; set; }
    public string VerificationStatus { get; set; } = "";
    public SchoolItem School { get; set; } = new();
}

public sealed class VerificationRequest
{
    public string Id { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTimeOffset SubmittedAt { get; set; }
    public DateTimeOffset? ReviewedAt { get; set; }
    public string? RejectionReason { get; set; }
}

public sealed class ProviderProfile
{
    public string UserId { get; set; } = "";
    public string Headline { get; set; } = "";
    public string Bio { get; set; } = "";
    public List<string> Skills { get; set; } = [];
    public bool IsAvailable { get; set; }
}

public sealed class MfaStatus
{
    public bool Enabled { get; set; }
    public DateTimeOffset? EnabledAt { get; set; }
    public int RecoveryCodesRemaining { get; set; }
    public bool Required { get; set; }
    public int TrustedDeviceCount { get; set; }
}

public sealed class MfaSetup
{
    public string Secret { get; set; } = "";
    public string OtpAuthUri { get; set; } = "";
    public string QrCodeDataUrl { get; set; } = "";
}

public sealed class ApiMessage
{
    public string Message { get; set; } = "";
    public string? DevelopmentCode { get; set; }
}

public sealed class PasswordChangeResult
{
    public string Id { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? CreatedAt { get; set; }
    public string? ConfirmationMethod { get; set; }
    public int RevokedTrustedDevices { get; set; }
    public string Message { get; set; } = "";
}
