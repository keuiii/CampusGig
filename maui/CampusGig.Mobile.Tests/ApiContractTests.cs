using System.Text.Json;
using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class ApiContractTests
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true,
    };

    [TestMethod]
    public void AuthResponseDeserializesTheExistingApiContract()
    {
        const string json = """
            {
              "accessToken": "jwt-token",
              "trustedDeviceToken": "trusted-token",
              "user": {
                "id": "user-1",
                "email": "student@example.com",
                "displayName": "Campus Student",
                "status": "ACTIVE",
                "roles": ["CLIENT"]
              }
            }
            """;

        var response = JsonSerializer.Deserialize<AuthResponse>(json, JsonOptions);

        Assert.IsNotNull(response);
        Assert.AreEqual("jwt-token", response.AccessToken);
        Assert.AreEqual("Campus Student", response.User?.DisplayName);
        CollectionAssert.Contains(response.User?.Roles, "CLIENT");
    }

    [TestMethod]
    public void ServiceAndOrderPricesUsePhilippinePesoDisplay()
    {
        var service = new ServiceItem { Price = 1250 };
        var order = new OrderItem { TotalCentavos = 125050 };

        Assert.AreEqual("From ₱1,250", service.PriceLabel);
        Assert.AreEqual("₱1,250.50", order.PriceLabel);
    }

    [TestMethod]
    public void GoogleIdentityUsesTheBackendWebClientAsTokenAudience()
    {
        Assert.IsTrue(GoogleIdentityOptions.IsConfigured);
        StringAssert.EndsWith(
            GoogleIdentityOptions.ServerClientId,
            ".apps.googleusercontent.com");
    }

    [TestMethod]
    public void GoogleSocialLoginSerializesTheExistingApiContract()
    {
        var request = new GoogleSocialLoginRequest
        {
            IdToken = "signed-google-id-token",
            TrustedDeviceToken = "trusted-device-token",
        };

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(request, JsonOptions));
        Assert.AreEqual("GOOGLE", json.RootElement.GetProperty("provider").GetString());
        Assert.AreEqual("signed-google-id-token", json.RootElement.GetProperty("idToken").GetString());
        Assert.AreEqual("trusted-device-token", json.RootElement.GetProperty("trustedDeviceToken").GetString());
    }

    [TestMethod]
    public void SlidingControlsUseDeterministicRestingPositions()
    {
        Assert.AreEqual(0, InteractionMotion.ThemeThumbOffset(false));
        Assert.AreEqual(32, InteractionMotion.ThemeThumbOffset(true));
        Assert.AreEqual(0, InteractionMotion.AuthTabOffset(false, 320, 4, 4));
        Assert.AreEqual(156, InteractionMotion.AuthTabOffset(true, 320, 4, 4));
        Assert.AreEqual(0, InteractionMotion.AuthTabOffset(true, 8, 4, 4));
        Assert.AreEqual(0, InteractionMotion.SegmentOffset(false, 122, 4));
        Assert.AreEqual(126, InteractionMotion.SegmentOffset(true, 122, 4));
    }

    [TestMethod]
    public void MobileNavigationDefinesFourUniqueSvgTabs()
    {
        Assert.HasCount(4, MobileNavigation.Tabs);
        Assert.HasCount(4, MobileNavigation.Tabs.Select(tab => tab.Route).Distinct().ToArray());
        Assert.IsTrue(MobileNavigation.Tabs.All(tab => tab.IconFile.EndsWith(".svg", StringComparison.Ordinal)));
        CollectionAssert.AreEqual(
            new[] { "Discover", "Orders", "Messages", "Profile" },
            MobileNavigation.Tabs.Select(tab => tab.Title).ToArray());
    }

    [TestMethod]
    public void OrderWorkspaceDeserializesFilesAndHistory()
    {
        const string json = """
            {"data":{"id":"o1","orderNumber":"CG-1","title":"Logo","status":"SUBMITTED","requirements":"Create a logo","totalCentavos":50000,"dueAt":"2026-09-05T00:00:00Z","provider":{"id":"p1","displayName":"Provider"},"client":{"id":"c1","displayName":"Client"},"package":{"id":"pk1","name":"Basic"},"files":[{"id":"f1","originalName":"logo.png","sizeBytes":2048}],"history":[{"id":"h1","toStatus":"SUBMITTED","createdAt":"2026-09-02T00:00:00Z","actor":{"id":"p1","displayName":"Provider"}}]}}
            """;
        var response = JsonSerializer.Deserialize<ApiResult<OrderDetail>>(json, JsonOptions);
        Assert.IsNotNull(response);
        Assert.AreEqual("logo.png", response.Data.Files.Single().OriginalName);
        Assert.AreEqual("SUBMITTED", response.Data.History.Single().ToStatus);
    }

    [TestMethod]
    public void ConversationAttachmentSummaryMatchesExistingMobileBehavior()
    {
        var message = new ConversationMessage { Attachments = [new() { OriginalName = "brief.pdf" }, new() { OriginalName = "photo.png" }] };
        Assert.AreEqual("2 attachments · tap to download", message.AttachmentSummary);
    }

    [TestMethod]
    public void RoleAwareProfilesDeserializeStudentProviderAndMfaContracts()
    {
        var student = JsonSerializer.Deserialize<ApiResult<StudentProfile>>("{\"data\":{\"schoolId\":\"s1\",\"program\":\"BSIT\",\"yearLevel\":3,\"verificationStatus\":\"APPROVED\"}}", JsonOptions);
        var provider = JsonSerializer.Deserialize<ApiResult<ProviderProfile>>("{\"data\":{\"headline\":\"Designer\",\"bio\":\"Experienced student designer\",\"skills\":[\"Figma\"],\"isAvailable\":true}}", JsonOptions);
        var mfa = JsonSerializer.Deserialize<MfaStatus>("{\"enabled\":true,\"recoveryCodesRemaining\":8,\"trustedDeviceCount\":1}", JsonOptions);
        Assert.AreEqual("APPROVED", student?.Data.VerificationStatus);
        Assert.IsTrue(provider?.Data.IsAvailable);
        Assert.AreEqual(8, mfa?.RecoveryCodesRemaining);
    }

    [TestMethod]
    public void OrderStatusLabelFormatsUnderscoresAsReadableSpacing()
    {
        var inProgress = new OrderItem { Status = "IN_PROGRESS" };
        var pendingRequirements = new OrderItem { Status = "PENDING_REQUIREMENTS" };
        var completed = new OrderItem { Status = "COMPLETED" };

        Assert.AreEqual("IN PROGRESS", inProgress.StatusLabel);
        Assert.AreEqual("PENDING REQUIREMENTS", pendingRequirements.StatusLabel);
        Assert.AreEqual("COMPLETED", completed.StatusLabel);
    }

    [TestMethod]
    public void ConversationParticipantInitialExtractsUpToTwoInitialsWithFallback()
    {
        var twoNames = new ConversationParticipant { DisplayName = "Jane Doe" };
        var singleName = new ConversationParticipant { DisplayName = "Student" };
        var threeNames = new ConversationParticipant { DisplayName = "John Michael Smith" };
        var emptyName = new ConversationParticipant { DisplayName = "" };
        var whitespaceName = new ConversationParticipant { DisplayName = "   " };
        var lowercasePadded = new ConversationParticipant { DisplayName = "  kevin   bacon  " };

        Assert.AreEqual("JD", twoNames.Initial);
        Assert.AreEqual("S", singleName.Initial);
        Assert.AreEqual("JM", threeNames.Initial);
        Assert.AreEqual("C", emptyName.Initial);
        Assert.AreEqual("C", whitespaceName.Initial);
        Assert.AreEqual("KB", lowercasePadded.Initial);
    }

    [TestMethod]
    public void ProfileUploadRulesHandlePhysicalAndContentUriFiles()
    {
        Assert.IsFalse(MobileFileRules.ExceedsProfileUploadLimit(null));
        Assert.IsFalse(MobileFileRules.ExceedsProfileUploadLimit(5 * 1024 * 1024));
        Assert.IsTrue(MobileFileRules.ExceedsProfileUploadLimit(5 * 1024 * 1024 + 1));
        Assert.AreEqual("Document selected", MobileFileRules.DescribeSelection(null));
        Assert.AreEqual("2 KB selected", MobileFileRules.DescribeSelection(2048));
    }

    [TestMethod]
    public void ProviderRoleMayLegitimatelyHaveNoProviderProfileYet()
    {
        var response = JsonSerializer.Deserialize<ApiResult<ProviderProfile?>>("{\"data\":null}", JsonOptions);

        Assert.IsNotNull(response);
        Assert.IsNull(response.Data);
    }

    [TestMethod]
    public void BookingRequiresAnAvailablePackageAndMeaningfulRequirements()
    {
        var package = new ServicePackage { Id = "package-1", Name = "Basic" };

        Assert.IsFalse(ServiceBookingRules.CanSubmit(null, "A complete project brief"));
        Assert.IsFalse(ServiceBookingRules.CanSubmit(package, "too short"));
        Assert.IsTrue(ServiceBookingRules.CanSubmit(package, "  A complete project brief  "));
        Assert.IsFalse(ServiceBookingRules.CanStartSubmission(true, package, "A complete project brief"));
        Assert.IsTrue(ServiceBookingRules.CanStartSubmission(false, package, "A complete project brief"));
    }

    [TestMethod]
    public void BusyActionsRejectDuplicateTapsAndMeetMobileTouchSizing()
    {
        Assert.IsTrue(UiInteractionRules.CanInvoke(isEnabled: true, isBusy: false));
        Assert.IsFalse(UiInteractionRules.CanInvoke(isEnabled: true, isBusy: true));
        Assert.IsFalse(UiInteractionRules.CanInvoke(isEnabled: false, isBusy: false));
        Assert.IsGreaterThanOrEqualTo(48, UiInteractionRules.MinimumTouchTarget);
        Assert.IsTrue(UiInteractionRules.ShouldShowBusy(operationRunning: true, awaitingUserFeedback: false));
        Assert.IsFalse(UiInteractionRules.ShouldShowBusy(operationRunning: false, awaitingUserFeedback: true));
    }

    [TestMethod]
    public void ProfileActionsEnableOnlyWhenTheirInputsAreActuallyValid()
    {
        Assert.IsTrue(ProfileActionRules.CanSaveStudent(true, "school-1", "BSIT", "3"));
        Assert.IsFalse(ProfileActionRules.CanSaveStudent(false, "school-1", "BSIT", "3"));
        Assert.IsFalse(ProfileActionRules.CanSaveStudent(true, "school-1", "BSIT", "11"));
        Assert.IsTrue(ProfileActionRules.CanChangePassword("old-pass", "new-pass", "new-pass", false, null));
        Assert.IsFalse(ProfileActionRules.CanChangePassword("old-pass", "new-pass", "different", false, null));
        Assert.IsFalse(ProfileActionRules.CanChangePassword("old-pass", "new-pass", "new-pass", true, "123"));
        Assert.IsTrue(ProfileActionRules.CanConfirmMfa("123456"));
        Assert.IsFalse(ProfileActionRules.CanSubmitVerification(true, false));
    }

    [TestMethod]
    public void ProfileAvatarRequiresServerMetadataAndUsesTheApiRoute()
    {
        Assert.IsTrue(ProfileImageRules.CanDisplay(true, "user-1"));
        Assert.IsFalse(ProfileImageRules.CanDisplay(false, "user-1"));
        Assert.IsFalse(ProfileImageRules.CanDisplay(true, ""));
        Assert.AreEqual(
            "http://10.0.2.2:4000/api/v1/profile/avatar/user-1?v=42",
            ProfileImageRules.BuildUrl("http://10.0.2.2:4000/api/v1/", "user-1", 42));
    }

    [TestMethod]
    public void MarketplaceRendersPartialSuccessWithoutBlankSections()
    {
        Assert.IsTrue(MarketplaceLoadRules.HasAnySuccessfulResponse(false, true, false));
        Assert.IsFalse(MarketplaceLoadRules.HasAnySuccessfulResponse(false, false, false));
        Assert.IsTrue(MarketplaceLoadRules.ShouldShowSection(1));
        Assert.IsFalse(MarketplaceLoadRules.ShouldShowSection(0));
    }

    [TestMethod]
    public void MarketplaceFilterMatchesCategoryByStableCategoryName()
    {
        Assert.IsTrue(MarketplaceLoadRules.MatchesService(
            "", "", "Graphic Design", "Logo Design", "DOX", "Graphic Design", "University of Batangas", "ub"));
        Assert.IsFalse(MarketplaceLoadRules.MatchesService(
            "", "", "Tutoring", "Logo Design", "DOX", "Graphic Design", "University of Batangas", "ub"));
        Assert.IsTrue(MarketplaceLoadRules.MatchesService(
            "logo", "ub", null, "Logo Design", "DOX", "Graphic Design", "University of Batangas", "ub"));
        Assert.IsTrue(MarketplaceLoadRules.MatchesService(
            "UB", "", null, "Logo Design", "DOX", "Graphic Design", "University of Batangas", "ub"));
        Assert.IsTrue(MarketplaceLoadRules.MatchesService(
            "BSU", "", null, "Tutoring", "Kai", "Tutoring", "Batangas State University", "bsu"));
        Assert.IsTrue(MarketplaceLoadRules.MatchesService(
            "NU", "", null, "Programming", "Sam", "Programming", "National University Lipa", "nu"));
    }

    [TestMethod]
    public void MarketplaceDeserializesMillisecondAvatarVersionsFromTheApi()
    {
        const string json = """
            {"data":[{"id":"service-1","title":"Logo Design","category":"Graphic Design","providerAvatarVersion":1788724560985,"packages":[]}]}
            """;

        var response = System.Text.Json.JsonSerializer.Deserialize<ApiList<ServiceItem>>(
            json,
            new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));

        Assert.IsNotNull(response);
        Assert.AreEqual(1788724560985L, response.Data.Single().ProviderAvatarVersion);
    }

    [TestMethod]
    public void AuthenticationFormsRequireTheSameFieldsAsExpo()
    {
        Assert.IsFalse(AuthFormRules.IsReady(AuthFormMode.Login, "student@example.com", "short", null, null, false));
        Assert.IsTrue(AuthFormRules.IsReady(AuthFormMode.Login, "student@example.com", "password", null, null, false));
        Assert.IsFalse(AuthFormRules.IsReady(AuthFormMode.Register, "student@example.com", "password", "K", null, false));
        Assert.IsTrue(AuthFormRules.IsReady(AuthFormMode.Register, "student@example.com", "password", "Kevin", null, false));
        Assert.IsTrue(AuthFormRules.IsReady(AuthFormMode.Forgot, "student@example.com", null, null, null, false));
        Assert.IsTrue(AuthFormRules.IsReady(AuthFormMode.Verify, null, null, null, "123456", false));
        Assert.IsTrue(AuthFormRules.IsReady(AuthFormMode.Reset, null, "password", null, "123456", false));
        Assert.IsTrue(AuthFormRules.IsReady(AuthFormMode.Mfa, null, null, null, "123456", false));
        Assert.IsTrue(AuthFormRules.IsReady(AuthFormMode.Mfa, null, null, null, "ABCDE-12345", true));
    }

    [TestMethod]
    public void AuthenticationCodesAreSanitizedAndLengthLimited()
    {
        Assert.AreEqual("123456", AuthFormRules.NormalizeCode("12a-345678", false));
        Assert.AreEqual("ABCDE12345", AuthFormRules.NormalizeCode("abcde-12345-extra", true));
    }

    [TestMethod]
    public void MessageComposerRequiresContentAndRejectsOversizedAttachments()
    {
        Assert.IsFalse(MobileFileRules.CanSendMessage("   ", 0));
        Assert.IsTrue(MobileFileRules.CanSendMessage("Hello", 0));
        Assert.IsTrue(MobileFileRules.CanSendMessage(null, 1));
        Assert.IsFalse(MobileFileRules.ExceedsMessageAttachmentLimit(15 * 1024 * 1024));
        Assert.IsTrue(MobileFileRules.ExceedsMessageAttachmentLimit(15 * 1024 * 1024 + 1));
    }

    [TestMethod]
    public void NotificationsUsePurposeSpecificIcons()
    {
        Assert.AreEqual("✉", new NotificationItem { Type = "NEW_MESSAGE" }.IconGlyph);
        Assert.AreEqual("✓", new NotificationItem { Type = "ORDER_ACCEPTED" }.IconGlyph);
        Assert.AreEqual("↗", new NotificationItem { Type = "ORDER_SUBMITTED" }.IconGlyph);
    }

    [TestMethod]
    public void PasswordChangeFlowDistinguishesEmailApprovalFromImmediateMfa()
    {
        var pending = JsonSerializer.Deserialize<PasswordChangeResult>("{\"id\":\"request-1\",\"status\":\"PENDING\",\"expiresAt\":\"2026-09-08T12:00:00Z\"}", JsonOptions);
        var immediate = JsonSerializer.Deserialize<PasswordChangeResult>("{\"status\":\"CONFIRMED\",\"confirmationMethod\":\"AUTHENTICATOR\",\"message\":\"Password changed\"}", JsonOptions);

        Assert.IsTrue(PasswordChangeFlowRules.IsPending(pending));
        Assert.IsFalse(PasswordChangeFlowRules.IsImmediate(pending));
        Assert.IsTrue(PasswordChangeFlowRules.IsImmediate(immediate));
        Assert.IsTrue(PasswordChangeFlowRules.IsTerminal(immediate));
        Assert.IsTrue(PasswordChangeFlowRules.WasSuccessful(immediate));
        Assert.IsFalse(PasswordChangeFlowRules.WasSuccessful(new PasswordChangeResult { Status = "REJECTED" }));
    }

    [TestMethod]
    public void UnauthorizedLoginDoesNotResetThePageButExpiredAuthenticatedSessionDoes()
    {
        Assert.IsFalse(AuthorizationFailureRules.ShouldClearSession(
            System.Net.HttpStatusCode.Unauthorized, requestHadBearerToken: false));
        Assert.IsTrue(AuthorizationFailureRules.ShouldClearSession(
            System.Net.HttpStatusCode.Unauthorized, requestHadBearerToken: true));
        Assert.IsFalse(AuthorizationFailureRules.ShouldClearSession(
            System.Net.HttpStatusCode.BadRequest, requestHadBearerToken: true));
    }

    [TestMethod]
    public void ProfileRefreshRejectsOverlappingLoads()
    {
        Assert.IsTrue(RefreshRequestRules.CanStart(isLoading: false));
        Assert.IsFalse(RefreshRequestRules.CanStart(isLoading: true));
    }

    [TestMethod]
    [DataRow("Discover")]
    [DataRow("Orders")]
    [DataRow("Messages")]
    [DataRow("Profile")]
    public void ReparentedTabDialogsUseTheVisibleWindowHost(string tabName)
    {
        Assert.IsFalse(string.IsNullOrWhiteSpace(tabName));
        Assert.IsTrue(DialogPresentationRules.ShouldUseWindowHost(
            hostAvailable: true, hostIsSourcePage: false));
        Assert.IsFalse(DialogPresentationRules.ShouldUseWindowHost(
            hostAvailable: true, hostIsSourcePage: true));
        Assert.IsFalse(DialogPresentationRules.ShouldUseWindowHost(
            hostAvailable: false, hostIsSourcePage: false));
    }

    [TestMethod]
    public void MfaSecuritySummaryReflectsProtectionAndPluralizesCounts()
    {
        Assert.AreEqual("OFF", MfaPresentationRules.StatusLabel(false));
        StringAssert.Contains(MfaPresentationRules.Summary(false, 0, 0), "Set up an authenticator");
        Assert.AreEqual("PROTECTED", MfaPresentationRules.StatusLabel(true));
        Assert.AreEqual("1 recovery code remaining  ·  1 remembered device",
            MfaPresentationRules.Summary(true, 1, 1));
        Assert.AreEqual("10 recovery codes remaining  ·  2 remembered devices",
            MfaPresentationRules.Summary(true, 10, 2));
    }

    [TestMethod]
    public void OptionalApiResponsesAcceptEmptyAndJsonNullPayloads()
    {
        Assert.IsTrue(ApiPayloadRules.IsEmptyOptionalPayload(""));
        Assert.IsTrue(ApiPayloadRules.IsEmptyOptionalPayload("  "));
        Assert.IsTrue(ApiPayloadRules.IsEmptyOptionalPayload("null"));
        Assert.IsTrue(ApiPayloadRules.IsEmptyOptionalPayload(" NULL \r\n"));
        Assert.IsFalse(ApiPayloadRules.IsEmptyOptionalPayload("{}"));
    }

    [TestMethod]
    public void OrderWorkflowActionsAreRoleAndStatusAware()
    {
        var order = new OrderDetail { Provider = new OrderParty { Id = "provider-1" } };
        Assert.IsTrue(OrderWorkflowRules.IsProvider(order, "provider-1"));
        Assert.IsTrue(OrderWorkflowRules.CanDecide("REQUESTED", true));
        Assert.IsTrue(OrderWorkflowRules.CanStart("ACCEPTED", true));
        Assert.IsTrue(OrderWorkflowRules.CanDeliver("IN_PROGRESS", true));
        Assert.IsTrue(OrderWorkflowRules.CanDeliver("REVISION_REQUESTED", true));
        Assert.IsFalse(OrderWorkflowRules.CanReviewDelivery("SUBMITTED", true));
        Assert.IsTrue(OrderWorkflowRules.CanReviewDelivery("SUBMITTED", false));
        Assert.IsTrue(OrderWorkflowRules.CanReviewProvider("COMPLETED", false, false));
        Assert.IsFalse(OrderWorkflowRules.CanReviewProvider("COMPLETED", false, true));
        Assert.IsTrue(OrderWorkflowRules.CanSubmitDelivery("Final files", 2, false));
        Assert.IsFalse(OrderWorkflowRules.CanSubmitDelivery("", 2, false));
        Assert.IsFalse(OrderWorkflowRules.CanSubmitDelivery("Final files", 6, false));
        Assert.IsTrue(MobileFileRules.IsSupportedDeliverable("final-design.PDF"));
        Assert.IsFalse(MobileFileRules.IsSupportedDeliverable("installer.exe"));
        Assert.AreEqual("application/pdf", MobileFileRules.DeliverableContentType("brief.pdf", null));
    }
}
