using System.Text.Json.Serialization;
using System.ComponentModel;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Models;

public static class PricingModels
{
    public const string LegacyPackages = "LEGACY_PACKAGES";
    public const string SinglePriceV2 = "SINGLE_PRICE_V2";
    public const string LegacyPackageV1 = "LEGACY_PACKAGE_V1";
}

public sealed class ApiList<T>
{
    public List<T> Data { get; set; } = [];
    public CursorPagination Pagination { get; set; } = new();
    public int? UnreadCount { get; set; }
}

public sealed class CursorPagination
{
    public bool HasMore { get; set; }
    public string? NextCursor { get; set; }
}

public sealed class ServicePage
{
    public List<ServiceItem> Data { get; set; } = [];
    public int Page { get; set; } = 1;
    public int PageSize { get; set; }
    public int Total { get; set; }
    public bool HasMore { get; set; }
}

public sealed class MessagePage
{
    public List<ConversationMessage> Data { get; set; } = [];
    public PageCursor Page { get; set; } = new();
}

public sealed class PageCursor
{
    public string? NextCursor { get; set; }
    public int Limit { get; set; }
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
    public string? RefreshToken { get; set; }
    public int ExpiresIn { get; set; }
    public double RefreshExpiresIn { get; set; }
    public AuthUser? User { get; set; }
    public bool RequiresTwoFactor { get; set; }
    public string? ChallengeToken { get; set; }
    public string? TrustedDeviceToken { get; set; }
}

public sealed class LoginRequest
{
    public required string Email { get; init; }
    public required string Password { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? TrustedDeviceToken { get; init; }

    public string ClientType => "MOBILE";
    public string DeviceName { get; init; } = "Mobile device";
}

public sealed class GoogleSocialLoginRequest
{
    public string Provider => "GOOGLE";
    public required string IdToken { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? TrustedDeviceToken { get; init; }

    public string ClientType => "MOBILE";
    public string DeviceName { get; init; } = "Mobile device";
}

public sealed class AuthSessionItem
{
    public string Id { get; set; } = "";
    public string ClientType { get; set; } = "";
    public string DeviceName { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset LastUsedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public bool Current { get; set; }
    public string ClientLabel => ClientType == "MOBILE" ? "Mobile app" : "Web browser";
    public string ActivityLabel => $"{ClientLabel} · Active {LastUsedAt.LocalDateTime:g}";
}

public sealed class SessionRevocationResult
{
    public int Revoked { get; set; }
}

public sealed class SupportTicketReceipt
{
    public string Reference { get; set; } = "";
    public string Message { get; set; } = "";
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
    public bool IsActive { get; set; } = true;
}

public sealed class ServiceItem : System.ComponentModel.INotifyPropertyChanged
{
    private bool isSaved;
    public event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged;
    public bool IsSaved
    {
        get => isSaved;
        set
        {
            if (isSaved == value) return;
            isSaved = value;
            PropertyChanged?.Invoke(this, new(nameof(IsSaved)));
            PropertyChanged?.Invoke(this, new(nameof(SaveLabel)));
        }
    }
    public string SaveLabel => IsSaved ? "♥" : "♡";
    public string Id { get; set; } = "";
      public string PricingModel { get; set; } = PricingModels.LegacyPackages;
      public int? BasePriceCentavos { get; set; }
      public int? NormalDeliveryMinutes { get; set; }
      public int? IncludedRevisionLimit { get; set; }
      public bool AcceptsRushOrders { get; set; }
      public string? FastestRushTier { get; set; }
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
    public bool AcceptingOrders { get; set; } = true;
    public string Delivery { get; set; } = "";
    public DateTimeOffset PublishedAt { get; set; }
    public List<ServicePackage> Packages { get; set; } = [];
    public string? CoverMediaId { get; set; }
    public List<ServiceMedia> Portfolio { get; set; } = [];
    public string? CoverImageUrl { get; set; }
    public string? ProviderAvatarUrl { get; set; }
    public string ProviderInitial => string.IsNullOrWhiteSpace(Provider) ? "C" : Provider[..1].ToUpperInvariant();
    public bool ShowCoverPlaceholder => string.IsNullOrWhiteSpace(CoverImageUrl);
    public string RatingLabel => Rating > 0 ? Rating.ToString("0.0") : "New";
    public string DeliveryLabel => string.IsNullOrWhiteSpace(Delivery) ? "Delivery varies" : Delivery;
      public string PriceLabel => PricingModel == PricingModels.SinglePriceV2
          ? $"₱{(BasePriceCentavos ?? 0) / 100m:N0} fixed"
          : PricingModel == PricingModels.LegacyPackages
              ? $"From ₱{Price:N0}"
              : "Price unavailable";
      public bool IsFixedPrice => PricingModel == PricingModels.SinglePriceV2;
      public string PriceAmountLabel => IsFixedPrice
          ? $"₱{(BasePriceCentavos ?? 0) / 100m:N0}"
          : PricingModel == PricingModels.LegacyPackages
              ? $"₱{Price:N0}"
              : "Unavailable";
      public string PriceContextLabel => IsFixedPrice ? "PRICE" : "STARTING AT";
      public string V2TermsLabel => $"{PricingModelRules.FormatDeliveryMinutes(NormalDeliveryMinutes)} delivery · {IncludedRevisionLimit ?? 0} revision{(IncludedRevisionLimit == 1 ? "" : "s")}";
    public string ProviderLabel => $"{Provider} · {School}";
}

public sealed class ServiceMedia
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string MimeType { get; set; } = "";
    public int SizeBytes { get; set; }
}

public sealed class PublicProviderProfile
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool HasAvatar { get; set; }
    public long AvatarVersion { get; set; }
    public DateTimeOffset MemberSince { get; set; }
    public string Headline { get; set; } = "";
    public string Bio { get; set; } = "";
    public List<string> Skills { get; set; } = [];
    public bool IsAvailable { get; set; }
    public ProviderSocialLinks SocialLinks { get; set; } = new();
    public bool Verified { get; set; }
    public string? Program { get; set; }
    public PublicProviderSchool School { get; set; } = new();
    public double Rating { get; set; }
    public int ReviewCount { get; set; }
    public int CompletedOrders { get; set; }
    public List<ServiceItem> Services { get; set; } = [];
    public string? AvatarUrl { get; set; }
    public string Initials => string.Join("", DisplayName.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(2).Select(part => part[..1])).ToUpperInvariant();
}

public sealed class PublicProviderSchool
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string ShortName { get; set; } = "";
    public string City { get; set; } = "";
}

public sealed class PublicProviderReview
{
    public string Id { get; set; } = "";
    public int OverallRating { get; set; }
    public int? QualityRating { get; set; }
    public int? CommunicationRating { get; set; }
    public int? TimelinessRating { get; set; }
    public string? Comment { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string ReviewerLabel { get; set; } = "CampusGig client";
    public string ServiceTitle { get; set; } = "";
}

public sealed class PublicProviderReviewSummary
{
    public double Average { get; set; }
    public int Total { get; set; }
    public List<PublicProviderRatingCount> Distribution { get; set; } = [];
}

public sealed class PublicProviderRatingCount
{
    public int Rating { get; set; }
    public int Count { get; set; }
}

public sealed class PublicProviderReviewPagination
{
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int Total { get; set; }
    public int TotalPages { get; set; }
}

public sealed class PublicProviderReviews
{
    public List<PublicProviderReview> Data { get; set; } = [];
    public PublicProviderReviewSummary Summary { get; set; } = new();
    public PublicProviderReviewPagination Pagination { get; set; } = new();
}

public class OrderItem
{
    public string Id { get; set; } = "";
    public string PricingModel { get; set; } = PricingModels.LegacyPackageV1;
    public int TermsSnapshotVersion { get; set; } = 1;
    public string OrderNumber { get; set; } = "";
    public string Title { get; set; } = "";
    public string Status { get; set; } = "";
    [JsonIgnore] public bool IsCompleted => Status == "COMPLETED";
    [JsonIgnore] public bool IsNotCompleted => !IsCompleted;
    [JsonIgnore] public bool IsArchived { get; set; }
    [JsonIgnore] public string ArchiveActionLabel => IsArchived ? "Restore order" : "Archive order";
    public string? PaymentStatus { get; set; }
    public string Requirements { get; set; } = "";
    public int TotalCentavos { get; set; }
    public string Currency { get; set; } = "PHP";
    public DateTimeOffset? DueAt { get; set; }
    public DateTimeOffset? PaymentConfirmedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? CompletionSource { get; set; }
    public int? ReviewPolicyVersion { get; set; }
    public DateTimeOffset? ReviewStartedAt { get; set; }
    public DateTimeOffset? ReviewDeadlineAt { get; set; }
    public string? ReviewDeliverySubmissionId { get; set; }
    public string? ReviewState { get; set; }
    public bool ReviewActionable { get; set; }
    public int? BasePriceCentavos { get; set; }
    public int? RushSurchargeCentavos { get; set; }
    public string? DeliveryOption { get; set; }
    public int? DeliveryDurationMinutes { get; set; }
    public int? PricingPolicyVersion { get; set; }
    public int? PlatformFeeBasisPoints { get; set; }
    public int? RushBasisPoints { get; set; }
    public OrderParty Provider { get; set; } = new();
    public OrderParty Client { get; set; } = new();
    [JsonPropertyName("package")]
    public ServicePackage? Package { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string StatusLabel => Status.Replace('_', ' ');
    public bool HasPaymentStatus => !string.IsNullOrWhiteSpace(PaymentStatus);
    public string PaymentStatusLabel => PaymentStatus switch
    {
        "PAID" => "PAID",
        "REQUIRES_ACTION" => "PAYMENT DUE",
        "FAILED" => "PAYMENT FAILED",
        "REFUND_PENDING" => "REFUND PENDING",
        "PARTIALLY_REFUNDED" => "PARTIAL REFUND",
        "REFUNDED" => "REFUNDED",
        "CANCELLED" => "PAYMENT CANCELLED",
        _ => "PAYMENT PENDING",
    };
    public string PriceLabel => $"₱{TotalCentavos / 100m:N2}";
    public string DeliveryDateHeading => Status == "REQUESTED" ? "REQUESTED DELIVERY" : "DUE";
    public string DeliveryDateLabel => DueAt?.ToLocalTime().ToString("MMM d, yyyy h:mm tt") ?? "Starts after payment";
    [JsonIgnore]
    public string RelationshipRole { get; set; } = "PROVIDER";
    [JsonIgnore]
    public string RelationshipName { get; set; } = "";
    [JsonIgnore]
    public string? RelationshipAvatarUrl { get; set; }
    [JsonIgnore]
    public string RelationshipInitial => string.IsNullOrWhiteSpace(RelationshipName)
        ? "C"
        : RelationshipName[..1].ToUpperInvariant();
    public string OrderNumberLabel => $"ORDER  {OrderNumber}";
    public string ProviderLabel => $"Provider · {Provider.DisplayName}";
}

public sealed class OrderDetail : OrderItem
{
    public int SubtotalCentavos { get; set; }
    public int PlatformFeeCentavos { get; set; }
    public int RevisionsUsed { get; set; }
    public int RevisionLimit { get; set; }
    public List<OrderFileItem> Files { get; set; } = [];
    public List<DeliverySubmissionItem> DeliverySubmissions { get; set; } = [];
    public DeliverySubmissionItem? CurrentDeliverySubmission { get; set; }
    public List<OrderRevisionItem> Revisions { get; set; } = [];
    public List<OrderRevisionPurchaseItem> RevisionPurchases { get; set; } = [];
    public OrderReviewItem? Review { get; set; }
    public List<OrderHistoryItem> History { get; set; } = [];
}

public sealed class MarketplaceQuote
{
    public string PricingModel { get; set; } = PricingModels.SinglePriceV2;
    public string Currency { get; set; } = "PHP";
    public int BasePriceCentavos { get; set; }
    public string DeliveryOption { get; set; } = "NORMAL";
    public int DeliveryDurationMinutes { get; set; }
    public int RushSurchargeCentavos { get; set; }
    public int ProviderServiceSubtotalCentavos { get; set; }
    public int PlatformFeeCentavos { get; set; }
    public int ClientTotalCentavos { get; set; }
    public int PlatformFeeBasisPoints { get; set; }
    public int RushBasisPoints { get; set; }
    public int PricingPolicyVersion { get; set; }
    public List<string> EligibleDeliveryOptions { get; set; } = [];
}

public sealed class OrderPayment
{
    public string Id { get; set; } = "";
    public string Provider { get; set; } = "PAYMONGO";
    public int AmountCentavos { get; set; }
    public int PlatformFeeCentavos { get; set; }
    public int ProviderNetCentavos { get; set; }
    public int RefundedCentavos { get; set; }
    public string Currency { get; set; } = "PHP";
    public string Status { get; set; } = "PENDING";
    public DateTimeOffset? PaidAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<MarketplaceRefund> Refunds { get; set; } = [];
}

public sealed class RefundEligibility
{
    public bool CanRequest { get; set; }
    public List<string> EligibleReasons { get; set; } = [];
    public string? SourceType { get; set; }
    public RefundPaymentSnapshot? Payment { get; set; }
    public MarketplaceRefund? Refund { get; set; }
}

public sealed class RefundPaymentSnapshot
{
    public string Id { get; set; } = "";
    public int ProviderPrincipalCentavos { get; set; }
    public int PlatformFeeCentavos { get; set; }
    public int RefundTotalCentavos { get; set; }
    public string Currency { get; set; } = "PHP";
    public string Status { get; set; } = "";
}

public sealed class MarketplaceRefund
{
    public string Id { get; set; } = "";
    public string? OrderId { get; set; }
    public string? PaymentId { get; set; }
    public string? RevisionPurchaseId { get; set; }
    public string? SourceType { get; set; }
    public string? ReasonCode { get; set; }
    public int ProviderPrincipalCentavos { get; set; }
    public int PlatformFeeCentavos { get; set; }
    public int RefundTotalCentavos { get; set; }
    public string Currency { get; set; } = "PHP";
    public string Status { get; set; } = "";
    public string? ProviderStatus { get; set; }
    public string? FailureCode { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? ProcessedAt { get; set; }
    public DateTimeOffset? ReconciliationRequiredAt { get; set; }
}

public sealed class OrderDispute
{
    public string Id { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string Reason { get; set; } = "";
    public string Details { get; set; } = "";
    public string Status { get; set; } = "";
    public string? ResponseRequestedFrom { get; set; }
    public DateTimeOffset? ResponseRequestedAt { get; set; }
    public DateTimeOffset? ResponseDeadlineAt { get; set; }
    public string? ResolutionNote { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<DisputeAffectedEarning> AffectedEarnings { get; set; } = [];
    public List<DisputeResponse> Responses { get; set; } = [];
    public List<DisputeEvidence> Evidence { get; set; } = [];
    public List<DisputeTimelineEvent> Timeline { get; set; } = [];
}

public sealed class DisputeAffectedEarning
{
    public string Id { get; set; } = "";
    public string PreFreezeStatus { get; set; } = "";
    public DateTimeOffset FrozenAt { get; set; }
    public DateTimeOffset? RestoredAt { get; set; }
    public DisputeEarning ProviderEarning { get; set; } = new();
}

public sealed class DisputeEarning
{
    public string Id { get; set; } = "";
    public string SourceType { get; set; } = "";
    public string Status { get; set; } = "";
    public string Currency { get; set; } = "PHP";
    public int GrossServiceAmountCentavos { get; set; }
}

public sealed class DisputeResponse
{
    public string Id { get; set; } = "";
    public int RequestSequence { get; set; }
    public string RequestedFrom { get; set; } = "";
    public string Details { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public OrderParty Responder { get; set; } = new();
}

public sealed class DisputeEvidence
{
    public string Id { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string MimeType { get; set; } = "";
    public long SizeBytes { get; set; }
    public string Checksum { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class DisputeTimelineEvent
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "";
    public string? Details { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public OrderParty? Actor { get; set; }
}

public sealed class PaymentCheckoutResult
{
    public OrderPayment Data { get; set; } = new();
    public string CheckoutUrl { get; set; } = "";
}

public sealed class OrderFileItem
{
    public string Id { get; set; } = "";
    public string Purpose { get; set; } = "";
    public string OriginalName { get; set; } = "";
    public string MimeType { get; set; } = "";
    public long SizeBytes { get; set; }
    public string? Sha256 { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public string SizeLabel => SizeBytes < 1024 * 1024
        ? $"{Math.Max(1, SizeBytes / 1024d):N0} KB"
        : $"{SizeBytes / 1024d / 1024d:N1} MB";
}

public sealed class DeliverySubmissionItem
{
    public string Id { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public int Version { get; set; }
    public string? Note { get; set; }
    public string? RevisionRequestId { get; set; }
    public DateTimeOffset SubmittedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public bool IsCurrent { get; set; }
    public List<OrderFileItem> Files { get; set; } = [];
    public string VersionLabel => IsCurrent ? $"VERSION {Version}  ·  CURRENT" : $"VERSION {Version}";
    public string SubmittedLabel => SubmittedAt.ToLocalTime().ToString("MMM d, yyyy h:mm tt");
    public string NoteLabel => string.IsNullOrWhiteSpace(Note) ? "No delivery note was recorded." : Note;
}

public sealed class OrderRevisionItem
{
    public string Id { get; set; } = "";
    public int SequenceNumber { get; set; }
    public string? Type { get; set; }
    public string Instructions { get; set; } = "";
    public string Status { get; set; } = "";
    public string? SourceDeliverySubmissionId { get; set; }
    public DateTimeOffset? RevisionDeadlineAt { get; set; }
    public int? TurnaroundMinutes { get; set; }
    public DateTimeOffset? ProviderAcknowledgedAt { get; set; }
    public DateTimeOffset? DeclinedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? ResolvedAt { get; set; }
    public OrderRevisionPurchaseItem? Purchase { get; set; }
}

public sealed class ExtraRevisionQuote
{
    public string RevisionType { get; set; } = "PAID_EXTRA";
    public int ProviderSubtotalCentavos { get; set; }
    public int PlatformFeeCentavos { get; set; }
    public int ClientTotalCentavos { get; set; }
    public string Currency { get; set; } = "PHP";
    public int TurnaroundMinutes { get; set; }
    public int PricingPolicyVersion { get; set; }
    public int PricingBasisCentavos { get; set; }
    public int DeliveryDurationBasisMinutes { get; set; }
    public string SourceOrderId { get; set; } = "";
    public string CurrentDeliverySubmissionId { get; set; } = "";
}

public sealed class OrderRevisionPurchaseItem
{
    public string Id { get; set; } = "";
    public string SourceDeliverySubmissionId { get; set; } = "";
    public int ProviderSubtotalCentavos { get; set; }
    public int PlatformFeeCentavos { get; set; }
    public int TotalCentavos { get; set; }
    public string Currency { get; set; } = "PHP";
    public int TurnaroundMinutes { get; set; }
    public int PricingPolicyVersion { get; set; }
    public string PaymentStatus { get; set; } = "PENDING";
    public string ActivationStatus { get; set; } = "PENDING";
    public string? FailureCode { get; set; }
    public DateTimeOffset? PaidAt { get; set; }
    public DateTimeOffset? ActivatedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class ExtraRevisionCheckoutResult
{
    public OrderRevisionPurchaseItem Data { get; set; } = new();
    public string CheckoutUrl { get; set; } = "";
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
    public OrderParty? Actor { get; set; }
}

public sealed class OrderParty
{
    public string Id { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public bool HasAvatar { get; set; }
    public long AvatarVersion { get; set; }
    [JsonIgnore] public string? AvatarUrl { get; set; }
    public void ResolveAvatarUrl(string apiBaseUrl)
    {
        AvatarUrl = HasAvatar && !string.IsNullOrWhiteSpace(Id)
            ? $"{apiBaseUrl.TrimEnd('/')}/profile/avatar/{Uri.EscapeDataString(Id)}?v={AvatarVersion}"
            : null;
    }
}

public sealed class ConversationItem
{
    private OrderItem? order;
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "ORDER";
    public string Subject { get; set; } = "";
    public string ContextLabel { get; set; } = "";
    public int UnreadCount { get; set; }
    public bool IsPinned { get; set; }
    public bool IsArchived { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public ConversationParticipant Participant { get; set; } = new();
    public ConversationMessage? LatestMessage { get; set; }
    public OrderItem Order
    {
        get => order ??= new OrderItem();
        set => order = value;
    }
    public bool IsInquiry => string.Equals(Kind, "INQUIRY", StringComparison.OrdinalIgnoreCase);
    public bool CanAttachFiles => !IsInquiry && !string.IsNullOrWhiteSpace(Order.Id);
    public string HeaderLabel => string.IsNullOrWhiteSpace(ContextLabel)
        ? Order.OrderNumber ?? "CONVERSATION"
        : ContextLabel;
    public string HeaderTitle => string.IsNullOrWhiteSpace(Subject)
        ? Order.Title ?? "Conversation"
        : Subject;
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

public sealed class ConversationPreferenceState
{
    public bool IsPinned { get; set; }
    public bool IsArchived { get; set; }
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
    public int MaxActiveOrders { get; set; } = 5;
    public int MaxPendingOrders { get; set; } = 50;
    public string? InstagramUrl { get; set; }
    public string? LinkedinUrl { get; set; }
    public string? XUrl { get; set; }
    public string? PortfolioUrl { get; set; }
}

  public sealed class ProviderListing
{
    public string Id { get; set; } = "";
      public string PricingModel { get; set; } = PricingModels.LegacyPackages;
      public int? BasePriceCentavos { get; set; }
      public int? NormalDeliveryMinutes { get; set; }
      public int? IncludedRevisionLimit { get; set; }
      public bool AcceptsRushOrders { get; set; }
      public string? FastestRushTier { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Status { get; set; } = "DRAFT";
    public string DeliveryMethod { get; set; } = "ONLINE";
    public string? CampusLocation { get; set; }
    public string? RejectionReason { get; set; }
    public CategoryItem Category { get; set; } = new();
    public List<ServicePackage> Packages { get; set; } = [];
    public List<ServiceMedia> Media { get; set; } = [];
    public DateTimeOffset UpdatedAt { get; set; }
    public string StatusLabel => Status.Replace('_', ' ');
      public string SummaryLabel => PricingModel == PricingModels.SinglePriceV2
          ? $"{Category.Name}  ·  single price"
          : $"{Category.Name}  ·  {Packages.Count} package{(Packages.Count == 1 ? "" : "s")}";
      public string PriceLabel => PricingModel == PricingModels.SinglePriceV2
          ? $"₱{(BasePriceCentavos ?? 0) / 100m:N0} fixed"
          : $"From ₱{(Packages.FirstOrDefault()?.PriceCentavos ?? 0) / 100m:N0}";
  }

public sealed class ProviderSocialLinks
{
    public string? Instagram { get; set; }
    public string? Linkedin { get; set; }
    public string? X { get; set; }
    public string? Portfolio { get; set; }
}

public sealed class ProviderDashboardStats
{
    public int ActiveOrders { get; set; }
    public int PendingRequests { get; set; }
    public int CompletedOrders { get; set; }
    public double AverageRating { get; set; }
    public int ReviewCount { get; set; }
    public int ProfileStrength { get; set; }
    public bool Verified { get; set; }
    public int MaxActiveOrders { get; set; } = 5;
    public int MaxPendingOrders { get; set; } = 50;
    public bool AcceptingOrders { get; set; }
}

public sealed class ProviderEarningsSummaryItem
{
    public string Currency { get; set; } = "";
    public int PendingCentavos { get; set; }
    public int AvailableCentavos { get; set; }
    public int WithdrawableCentavos { get; set; }
    public int FrozenCentavos { get; set; }
    public int PayoutProcessingCentavos { get; set; }
    public int PaidOutCentavos { get; set; }
    public int RefundedCentavos { get; set; }
}

public sealed class ProviderEarningItem
{
    public string Id { get; set; } = "";
    public string OrderId { get; set; } = "";
    public string OrderNumber { get; set; } = "";
    public string ServiceTitle { get; set; } = "";
    public string SourceType { get; set; } = "ORIGINAL_ORDER";
    public int? RevisionSequence { get; set; }
    public int AmountCentavos { get; set; }
    public string Currency { get; set; } = "";
    public string Status { get; set; } = "PENDING";
    public DateTimeOffset PendingAt { get; set; }
    public DateTimeOffset? AvailableAt { get; set; }
    public DateTimeOffset? WithdrawalEligibleAt { get; set; }
    public bool IsWithdrawable { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public List<ProviderEarningLedgerEntryItem> Entries { get; set; } = [];
    public string AmountLabel => ProviderEarningsPresentation.FormatAmount(AmountCentavos, Currency);
    public string StatusLabel => Status.Replace('_', ' ');
    public string SourceLabel => SourceType == "PAID_EXTRA_REVISION"
        ? $"PAID EXTRA REVISION{(RevisionSequence is int sequence ? $" #{sequence}" : "")}"
        : "ORIGINAL ORDER EARNING";
    public string PendingLabel => PendingAt.ToLocalTime().ToString("MMM d, yyyy h:mm tt");
    public string EligibilityLabel => Status == "AVAILABLE" && WithdrawalEligibleAt is DateTimeOffset eligibleAt
        ? IsWithdrawable
            ? "Withdrawable now"
            : $"Withdrawable {eligibleAt.ToLocalTime():MMM d, yyyy h:mm tt}"
        : "";
}

public sealed class ProviderEarningLedgerEntryItem
{
    public string Type { get; set; } = "";
    public int AmountCentavos { get; set; }
    public string Currency { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
}

public sealed class PayoutDestinationItem
{
    public string Id { get; set; } = "";
    public string Type { get; set; } = "E_WALLET";
    public string DisplayLabel { get; set; } = "";
    public string MaskedAccountIdentifier { get; set; } = "";
    public string AccountHolderName { get; set; } = "";
    public string VerificationStatus { get; set; } = "UNVERIFIED";
    public DateTimeOffset? ReviewedAt { get; set; }
    public bool IsActive { get; set; }
    public bool CanReceivePayout => IsActive &&
        (VerificationStatus == "ADMIN_REVIEWED" || VerificationStatus == "PROVIDER_VERIFIED");
}

public sealed class ProviderPayoutItem
{
    public string Id { get; set; } = "";
    public string ProviderId { get; set; } = "";
    public string DestinationId { get; set; } = "";
    public string Currency { get; set; } = "";
    public int RequestedPrincipalCentavos { get; set; }
    public int PayoutFeeCentavos { get; set; }
    public int NetDisbursementCentavos { get; set; }
    public string Status { get; set; } = "REQUESTED";
    public PayoutDestinationItem DestinationSnapshot { get; set; } = new();
    public string? SettlementMethod { get; set; }
    public string? ExternalStatus { get; set; }
    public DateTimeOffset RequestedAt { get; set; }
    public DateTimeOffset? PaidAt { get; set; }
    public List<ProviderPayoutEarningItem> Items { get; set; } = [];
    public string AmountLabel => ProviderEarningsPresentation.FormatAmount(NetDisbursementCentavos, Currency);
    public string StatusLabel => Status.Replace('_', ' ');
}

public sealed class ProviderPayoutEarningItem
{
    public string Id { get; set; } = "";
    public string ProviderEarningId { get; set; } = "";
    public int PrincipalCentavos { get; set; }
    public string Currency { get; set; } = "";
    public bool ReservationActive { get; set; }
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
