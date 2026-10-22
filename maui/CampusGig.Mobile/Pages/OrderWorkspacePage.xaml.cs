using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using CampusGig.Mobile.Controls;

namespace CampusGig.Mobile.Pages;

public partial class OrderWorkspacePage : ContentPage
{
    private const string PendingPaymentOrderKey = "campusgig_pending_payment_order";
    private const string PendingRevisionPaymentOrderKey = "campusgig_pending_revision_payment_order";
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly RealtimeService realtime;
    private readonly string orderId;
    private readonly PageActivityGuard pageActivity = new();
    private OrderDetail? detail;
    private OrderDispute? dispute;
    private RefundEligibility? refundEligibility;
    private ExtraRevisionQuote? extraRevisionQuote;
    private CancellationTokenSource? refreshCancellation;
    private bool isLoading;
    private bool isActing;
    private readonly List<FileResult> deliveryFiles = [];
    private string? deliverySubmissionRequestId;
    private bool entrancePlayed;
    private bool buttonMotionAttached;
    private bool isClosing;
    private string previousStatus = "";
    private int selectedRating;

    public OrderWorkspacePage(CampusGigApi api, SessionService session, RealtimeService realtime, string orderId)
    {
        InitializeComponent();
        NavigationPage.SetHasNavigationBar(this, false);
        this.api = api;
        this.session = session;
        this.realtime = realtime;
        this.orderId = orderId;
        UpdateRatingButtons();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        pageActivity.Activate();
        var pageGeneration = pageActivity.Capture();
        App.AppResumed -= OnAppResumedAsync;
        App.AppResumed += OnAppResumedAsync;
        realtime.OrderChanged -= OnRealtimeOrderChanged;
        realtime.PaymentChanged -= OnRealtimeOrderChanged;
        realtime.OrderChanged += OnRealtimeOrderChanged;
        realtime.PaymentChanged += OnRealtimeOrderChanged;
        realtime.ReconciliationRequired -= OnRealtimeReconciliationRequired;
        realtime.ReconciliationRequired += OnRealtimeReconciliationRequired;
        try
        {
            await realtime.SubscribeAsync(orderId);
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Order realtime subscription failed: {exception.Message}");
        }
        if (!pageActivity.CanUpdate(pageGeneration)) return;
        if (detail is null) await LoadAsync();
        else await LoadAsync(false);
        if (!pageActivity.CanUpdate(pageGeneration)) return;
        AttachButtonMotion();
        if (!entrancePlayed)
        {
            entrancePlayed = true;
            WorkspaceContent.Opacity = 0;
            WorkspaceContent.TranslationY = 12;
            await Task.WhenAll(
                WorkspaceContent.FadeToAsync(1, 190, Easing.CubicOut),
                WorkspaceContent.TranslateToAsync(0, 0, 220, Easing.CubicOut));
        }
        if (!pageActivity.CanUpdate(pageGeneration)) return;
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        refreshCancellation = new CancellationTokenSource();
        _ = RefreshInBackgroundAsync(refreshCancellation.Token);
    }

    protected override void OnDisappearing()
    {
        pageActivity.Deactivate();
        App.AppResumed -= OnAppResumedAsync;
        realtime.OrderChanged -= OnRealtimeOrderChanged;
        realtime.PaymentChanged -= OnRealtimeOrderChanged;
        realtime.ReconciliationRequired -= OnRealtimeReconciliationRequired;
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        refreshCancellation = null;
        base.OnDisappearing();
    }

    private Task OnAppResumedAsync() => LoadAsync(false);
    private void OnRealtimeOrderChanged(string changedOrderId)
    {
        if (changedOrderId == orderId) _ = LoadAsync(false);
    }
    private async void OnRealtimeReconciliationRequired()
    {
        var pageGeneration = pageActivity.Capture();
        while (isLoading && pageActivity.CanUpdate(pageGeneration)) await Task.Delay(50);
        if (!pageActivity.CanUpdate(pageGeneration)) return;
        await LoadAsync(false);
    }

    private async Task<bool> LoadAsync(bool showError = true)
    {
        var pageGeneration = pageActivity.Capture();
        if (isLoading || !pageActivity.CanUpdate(pageGeneration)) return false;
        isLoading = true;
        Exception? failure = null;
        var applied = false;
        try
        {
            var loadedDetail = (await api.GetAsync<ApiResult<OrderDetail>>($"orders/{orderId}")).Data;
            var loadedDispute = (await api.GetAsync<ApiResult<OrderDispute?>>($"orders/{orderId}/disputes")).Data;
            if (!pageActivity.CanUpdate(pageGeneration)) return false;
            detail = loadedDetail;
            dispute = loadedDispute;
            extraRevisionQuote = null;
            var isProvider = OrderWorkflowRules.IsProvider(detail, session.User?.Id);
            refundEligibility = null;
            if (!isProvider)
            {
                try
                {
                    refundEligibility = (await api.GetAsync<ApiResult<RefundEligibility>>(
                        $"orders/{orderId}/payments/refund-eligibility")).Data;
                }
                catch (CampusGigApiException)
                {
                    refundEligibility = null;
                }
            }
            var activeDispute = DisputePresentation.IsActive(dispute);
            if (!isProvider && detail.Status == "SUBMITTED" && detail.ReviewActionable && detail.RevisionsUsed >= detail.RevisionLimit)
            {
                try
                {
                    extraRevisionQuote = (await api.GetAsync<ApiResult<ExtraRevisionQuote>>(
                        $"orders/{orderId}/payments/revision-quote")).Data;
                }
                catch (CampusGigApiException)
                {
                    extraRevisionQuote = null;
                }
            }
            applied = true;
            TitleLabel.Text = detail.Title;
            StatusLabel.Text = MarketplacePresentation.StatusLabel(detail.Status);
            OrderMetaLabel.Text = $"ORDER  {detail.OrderNumber}";
            RequirementsLabel.Text = detail.Requirements;
            var v2Order = detail.PricingModel == PricingModels.SinglePriceV2;
            PackageHeadingLabel.Text = v2Order ? "SELECTED DELIVERY" : "PACKAGE";
            PackageLabel.Text = v2Order
                ? detail.DeliveryOption == "NORMAL"
                    ? $"Normal · {PricingModelRules.FormatDeliveryMinutes(detail.DeliveryDurationMinutes)}"
                    : $"{PricingModelRules.FormatDeliveryMinutes(detail.DeliveryDurationMinutes)} Rush"
                : detail.Package?.Name ?? "Legacy package";
            TotalLabel.Text = detail.PriceLabel;
            DeliveryDateHeadingLabel.Text = v2Order && detail.DueAt is null
                ? "DEADLINE"
                : detail.Status == "REQUESTED" ? "REQUESTED DELIVERY" : "DUE";
            DueLabel.Text = detail.DueAt?.ToLocalTime().ToString("MMM d, yyyy h:mm tt")
                ?? "Starts after payment confirmation";
            var canAccessFiles = isProvider || detail.PaymentStatus == "PAID";
            var legacyDeliveryFiles = detail.Files
                .Where(file => file.Purpose is "DELIVERABLE" or "REVISION")
                .ToList();
            var hasDeliveryEvidence = detail.DeliverySubmissions.Count > 0 || legacyDeliveryFiles.Count > 0;
            EmptyFilesLabel.IsVisible = !hasDeliveryEvidence || !canAccessFiles;
            EmptyFilesTitleLabel.Text = canAccessFiles ? "Waiting for delivery" : "Payment required";
            EmptyFilesBodyLabel.Text = canAccessFiles
                ? "No files have been submitted yet."
                : "Complete payment before downloading submitted deliverables.";
            DeliverySubmissionList.IsVisible = canAccessFiles && detail.DeliverySubmissions.Count > 0;
            LegacyFileList.IsVisible = canAccessFiles && detail.DeliverySubmissions.Count == 0;
            DeliveryPolicyLabel.IsVisible = canAccessFiles && !isProvider && hasDeliveryEvidence;
            BindableLayout.SetItemsSource(
                DeliverySubmissionList,
                canAccessFiles ? detail.DeliverySubmissions : []);
            BindableLayout.SetItemsSource(
                LegacyFileList,
                canAccessFiles && detail.DeliverySubmissions.Count == 0 ? legacyDeliveryFiles : []);
            var counterparty = isProvider ? detail.Client : detail.Provider;
            counterparty.ResolveAvatarUrl(api.BaseUrl);
            CounterpartyAvatarImage.Source = counterparty.AvatarUrl;
            WorkspaceRoleLabel.Text = isProvider ? "CLIENT FOR THIS ORDER" : "YOUR VERIFIED PROVIDER";
            CounterpartyLabel.Text = counterparty.DisplayName;
            CounterpartyDetailLabel.Text = isProvider
                ? "Service requester · keep project communication here"
                : "CampusGig provider · project contact";
            RoleIconLabel.Text = string.IsNullOrWhiteSpace(counterparty.DisplayName)
                ? "C"
                : counterparty.DisplayName[..1].ToUpperInvariant();
            StatusGuidanceLabel.Text = StatusGuidance(detail.Status, isProvider, detail.PaymentStatus);
            var canRequestRevision = detail.RevisionsUsed < detail.RevisionLimit;
            var pendingCorrection = detail.Revisions.LastOrDefault(revision =>
                revision.Type == "PROVIDER_CORRECTION" && revision.Status == "AWAITING_PROVIDER_ACKNOWLEDGEMENT");
            var activeRevision = detail.Revisions.LastOrDefault(revision =>
                revision.Status is "OPEN" or "AWAITING_PROVIDER_ACKNOWLEDGEMENT");
            ProviderDecisionPanel.IsVisible = OrderWorkflowRules.CanDecide(detail.Status, isProvider);
            ClientCancelPanel.IsVisible = OrderWorkflowRules.CanCancel(detail.Status, isProvider);
            PaymentPanel.IsVisible = OrderWorkflowRules.ShouldShowPayment(detail.Status, isProvider, detail.PaymentStatus);
            var pendingPaymentOrderId = Preferences.Default.Get(PendingPaymentOrderKey, "");
            var awaitingReturnVerification = PaymentReturnRules.IsAwaitingConfirmation(
                orderId, pendingPaymentOrderId, detail.PaymentStatus);
            if (PaymentReturnRules.ShouldClearPendingCheckout(
                orderId, pendingPaymentOrderId, detail.PaymentStatus))
                Preferences.Default.Remove(PendingPaymentOrderKey);
            PaymentCheckoutButton.IsVisible = OrderWorkflowRules.CanOpenCheckout(detail.Status, isProvider, detail.PaymentStatus) && !awaitingReturnVerification;
            PaymentCheckButton.IsVisible = awaitingReturnVerification;
            PaymentStatusLabel.Text = OrderWorkflowRules.PaymentStatusLabel(detail.PaymentStatus);
            PaymentGuidanceLabel.Text = PaymentReturnRules.Guidance(
                detail.PaymentStatus, awaitingReturnVerification);
            RefundRequestButton.IsVisible = refundEligibility?.CanRequest == true;
            RefundRequestButton.Text = RefundPresentation.ActionLabel(refundEligibility);
            RefundGuidanceLabel.Text = RefundPresentation.Guidance(refundEligibility);
            RefundGuidanceLabel.IsVisible = !string.IsNullOrWhiteSpace(RefundGuidanceLabel.Text);
            PaymentTotalLabel.Text = detail.PriceLabel;
            PaymentBreakdownLabel.Text = v2Order && detail.RushSurchargeCentavos > 0
                ? $"Base {FormatMoney(detail.BasePriceCentavos ?? 0)}  •  Rush {FormatMoney(detail.RushSurchargeCentavos.Value)}  •  CampusGig fee {FormatMoney(detail.PlatformFeeCentavos)}"
                : $"Service {FormatMoney(detail.SubtotalCentavos)}  •  CampusGig fee {FormatMoney(detail.PlatformFeeCentavos)}";
            ProviderStartPanel.IsVisible = OrderWorkflowRules.CanStart(detail.Status, isProvider, detail.PaymentStatus);
            ProviderDeliveryPanel.IsVisible = !activeDispute && OrderWorkflowRules.CanDeliver(detail.Status, isProvider, detail.PaymentStatus);
            DeliveryTitleLabel.Text = detail.Status == "REVISION_REQUESTED" ? "Submit revised work" : "Submit deliverables";
            DeliveryButton.Text = detail.Status == "REVISION_REQUESTED" ? "Submit revision" : "Submit delivery";
            SubmittedActions.IsVisible = !activeDispute && OrderWorkflowRules.CanReviewDelivery(detail.Status, isProvider, detail.PaymentStatus);
            RevisionGroup.IsVisible = canRequestRevision;
            if (!canRequestRevision || !SubmittedActions.IsVisible)
                RevisionComposer.IsVisible = false;
            NoRevisionsLeftLabel.IsVisible = !canRequestRevision;
            RevisionsRemainingLabel.Text = OrderWorkflowRules.RevisionUsageLabel(detail.RevisionsUsed, detail.RevisionLimit);
            RequestRevisionToggleButton.Text = "Request Included Revision";
            ExtraRevisionPanel.IsVisible = !isProvider && detail.Status == "SUBMITTED" && extraRevisionQuote is not null;
            if (extraRevisionQuote is not null)
            {
                ExtraRevisionPriceLabel.Text = $"Provider {ProviderEarningsPresentation.FormatAmount(extraRevisionQuote.ProviderSubtotalCentavos, extraRevisionQuote.Currency)}  •  CampusGig fee {ProviderEarningsPresentation.FormatAmount(extraRevisionQuote.PlatformFeeCentavos, extraRevisionQuote.Currency)}  •  Total {ProviderEarningsPresentation.FormatAmount(extraRevisionQuote.ClientTotalCentavos, extraRevisionQuote.Currency)}";
                ExtraRevisionTurnaroundLabel.Text = $"Provider turnaround: {PricingModelRules.FormatDeliveryMinutes(extraRevisionQuote.TurnaroundMinutes)}. Payment is optional and activates only after PayMongo confirmation.";
            }
            var latestPurchase = detail.RevisionPurchases.FirstOrDefault();
            var pendingRevisionOrderId = Preferences.Default.Get(PendingRevisionPaymentOrderKey, "");
            if (pendingRevisionOrderId == orderId && latestPurchase is not null &&
                (latestPurchase.ActivationStatus != "PENDING" || latestPurchase.PaymentStatus is "FAILED" or "CANCELLED"))
                Preferences.Default.Remove(PendingRevisionPaymentOrderKey);
            var reconciliationRequired = latestPurchase?.ActivationStatus == "RECONCILIATION_REQUIRED";
            ExtraRevisionEntry.IsVisible = !reconciliationRequired;
            ExtraRevisionCheckoutButton.IsVisible = !reconciliationRequired;
            ExtraRevisionStateLabel.Text = reconciliationRequired
                ? "Payment was recorded but this stale checkout could not activate. Contact support; no refund was fabricated."
                : latestPurchase?.PaymentStatus == "REQUIRES_ACTION"
                    ? "Checkout is pending. Returning from PayMongo does not confirm payment."
                    : "";
            CorrectionClaimPanel.IsVisible = !activeDispute && !isProvider && detail.Status == "SUBMITTED" && detail.ReviewActionable;
            CorrectionEntry.IsVisible = pendingCorrection is null;
            CorrectionClaimButton.IsVisible = pendingCorrection is null;
            CorrectionStateLabel.Text = pendingCorrection is null ? "" : "Waiting for provider acknowledgement.";
            ProviderRevisionPanel.IsVisible = !activeDispute && isProvider && activeRevision is not null;
            if (activeRevision is not null)
            {
                ProviderRevisionTypeLabel.Text = (activeRevision.Type ?? "LEGACY").Replace('_', ' ');
                ProviderRevisionInstructionsLabel.Text = activeRevision.Instructions;
                ProviderRevisionDeadlineLabel.Text = activeRevision.RevisionDeadlineAt is { } revisionDeadline
                    ? $"Submit by {revisionDeadline.ToLocalTime():MMM d, yyyy h:mm tt}{(revisionDeadline < DateTimeOffset.UtcNow ? " • OVERDUE" : "")}"
                    : "Waiting for provider acknowledgement";
                ProviderRevisionEarningLabel.Text = activeRevision.Type == "PAID_EXTRA" && activeRevision.Purchase is not null
                    ? $"Extra earning: {ProviderEarningsPresentation.FormatAmount(activeRevision.Purchase.ProviderSubtotalCentavos, activeRevision.Purchase.Currency)} • {activeRevision.Purchase.PaymentStatus}"
                    : "No additional earning for this revision.";
                CorrectionDecisionButtons.IsVisible = activeRevision.Type == "PROVIDER_CORRECTION" && activeRevision.Status == "AWAITING_PROVIDER_ACKNOWLEDGEMENT";
            }
            ReviewActions.IsVisible = OrderWorkflowRules.CanReviewProvider(
                detail.Status, isProvider, detail.Review is not null, detail.PaymentStatus);
            var activeReviewWindow = OrderReviewPresentation.HasActiveWindow(detail);
            var completionExplanation = OrderReviewPresentation.CompletionExplanation(detail);
            DeliveryReviewPanel.IsVisible = activeReviewWindow || completionExplanation is not null;
            if (activeReviewWindow && detail.ReviewDeadlineAt is { } reviewDeadline)
            {
                DeliveryReviewKickerLabel.Text = "48-HOUR DELIVERY REVIEW";
                var reviewTimeRemaining = OrderReviewPresentation.TimeRemaining(reviewDeadline, DateTimeOffset.UtcNow);
                DeliveryReviewTitleLabel.Text = isProvider ? "Awaiting client review" : reviewTimeRemaining;
                DeliveryReviewBodyLabel.Text = $"Review by {OrderReviewPresentation.DeadlineLabel(reviewDeadline)}. If no revision or dispute is active, CampusGig will complete the order and make the provider earning available automatically.";
                DeliveryReviewStateLabel.Text = detail.ReviewState == "BLOCKED_BY_DISPUTE"
                    ? "Automatic completion is paused while the dispute is active. Review or respond in the dispute section below."
                    : isProvider
                        ? $"{reviewTimeRemaining}. Your earning remains pending while the client reviews this delivery."
                        : "Downloading files does not accept the delivery. Use the actions below to accept it or request changes.";
            }
            else if (completionExplanation is not null)
            {
                DeliveryReviewKickerLabel.Text = "ORDER COMPLETED";
                DeliveryReviewTitleLabel.Text = detail.CompletionSource == "AUTO_REVIEW_TIMEOUT"
                    ? "Completed automatically after the review period"
                    : "Delivery accepted";
                DeliveryReviewBodyLabel.Text = completionExplanation;
                DeliveryReviewStateLabel.Text = "";
            }
            RenderDispute(isProvider);
            RenderHistory(detail.History);
            if (!string.IsNullOrWhiteSpace(previousStatus) && previousStatus != detail.Status)
            {
                StatusLabel.Scale = 0.84;
                await StatusLabel.ScaleToAsync(1, 180, Easing.SpringOut);
            }
            previousStatus = detail.Status;
        }
        catch (Exception exception)
        {
            failure = exception;
        }
        finally
        {
            isLoading = false;
            if (pageActivity.CanUpdate(pageGeneration)) Refresh.IsRefreshing = false;
        }
        if (showError && failure is not null && pageActivity.CanUpdate(pageGeneration))
            await DisplayAlertAsync("Unable to load order", failure.Message, "OK");
        return applied && failure is null;
    }

    private async Task RefreshInBackgroundAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
            while (await timer.WaitForNextTickAsync(cancellationToken))
                await LoadAsync(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
        }
    }

    private void RenderDispute(bool isProvider)
    {
        var eligible = detail is not null && detail.Status is "ACCEPTED" or "IN_PROGRESS" or "SUBMITTED" or "REVISION_REQUESTED" or "COMPLETED";
        DisputePanel.IsVisible = eligible;
        if (!eligible) return;

        var active = DisputePresentation.IsActive(dispute);
        DisputeOpenForm.IsVisible = !active;
        DisputeResponseGroup.IsVisible = DisputePresentation.CanRespond(dispute, isProvider);
        if (dispute is null)
        {
            DisputeTitleLabel.Text = "Report an order problem";
            DisputeStateLabel.Text = "An authorized client or provider may open a meaningful dispute. Normal completion pauses only after the server accepts it.";
            DisputeDeadlineLabel.Text = "";
            DisputeHistoryLabel.Text = "No dispute has been opened for this order.";
            return;
        }

            DisputeTitleLabel.Text = MarketplacePresentation.StatusLabel(dispute.Status);
        DisputeStateLabel.Text = $"{dispute.Reason.Replace('_', ' ')} · {dispute.Details}\n{DisputePresentation.FinancialLabel(dispute)}";
        DisputeDeadlineLabel.Text = dispute.Status is "WAITING_FOR_CLIENT" or "WAITING_FOR_PROVIDER"
            ? DisputePresentation.DeadlineLabel(dispute, DateTimeOffset.UtcNow)
            : "";
        var responseSummary = dispute.Responses.Count == 0
            ? "No party responses yet."
            : string.Join("\n", dispute.Responses.Select(item => $"{item.Responder.DisplayName}: {item.Details}"));
        var evidenceSummary = dispute.Evidence.Count == 0
            ? "No uploaded evidence."
            : $"Evidence: {string.Join(", ", dispute.Evidence.Select(item => item.OriginalName))}";
        var timelineSummary = dispute.Timeline.Count == 0
            ? ""
            : $"\nTimeline: {string.Join(" → ", dispute.Timeline.Select(item => item.Type.Replace('_', ' ')))}";
        var resolution = string.IsNullOrWhiteSpace(dispute.ResolutionNote)
            ? ""
            : $"\nResolution: {dispute.ResolutionNote}";
        DisputeHistoryLabel.Text = $"{responseSummary}\n{evidenceSummary}{timelineSummary}{resolution}";
    }

    private void OnDisputeDetailsChanged(object? sender, TextChangedEventArgs e) =>
        OpenDisputeButton.IsEnabled = (e.NewTextValue?.Trim().Length ?? 0) >= 10;

    private void OnDisputeResponseChanged(object? sender, TextChangedEventArgs e) =>
        SubmitDisputeResponseButton.IsEnabled = (e.NewTextValue?.Trim().Length ?? 0) >= 10;

    private async void OnOpenDisputeClicked(object? sender, EventArgs e)
    {
        var details = DisputeDetailsEntry.Text?.Trim() ?? "";
        var reason = DisputeReasonPicker.SelectedItem?.ToString() ?? "OTHER";
        if (details.Length < 10 || isActing) return;
        if (!await ConfirmTransitionAsync(
            "Open this dispute?",
            "CampusGig will pause normal completion, freeze the affected earning where applicable, and request the other party's response for 48 hours.",
            "Open dispute")) return;
        isActing = true;
        if (sender is BusyButton button) button.IsBusy = true;
        try
        {
            var result = await api.PostAsync<ApiResult<OrderDispute>>(
                $"orders/{orderId}/disputes",
                new { reason, details });
            dispute = result.Data;
            DisputeDetailsEntry.Text = "";
            await LoadAsync(false);
            await AppDialog.AlertAsync(this, "Dispute opened", result.Message);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Dispute not opened", exception.Message);
        }
        finally
        {
            isActing = false;
            if (sender is BusyButton busyButton) busyButton.IsBusy = false;
        }
    }

    private async void OnSubmitDisputeResponseClicked(object? sender, EventArgs e)
    {
        var details = DisputeResponseEntry.Text?.Trim() ?? "";
        if (details.Length < 10 || dispute is null || isActing) return;
        isActing = true;
        if (sender is BusyButton button) button.IsBusy = true;
        try
        {
            var result = await api.PostAsync<ApiResult<OrderDispute>>(
                $"orders/{orderId}/disputes/{dispute.Id}/responses",
                new { details });
            dispute = result.Data;
            DisputeResponseEntry.Text = "";
            await LoadAsync(false);
            await AppDialog.AlertAsync(this, "Response submitted", result.Message);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Response not submitted", exception.Message);
        }
        finally
        {
            isActing = false;
            if (sender is BusyButton busyButton) busyButton.IsBusy = false;
        }
    }

    private void RenderHistory(IEnumerable<OrderHistoryItem> items)
    {
        HistoryList.Clear();
        var isDark = Application.Current?.UserAppTheme == AppTheme.Dark;
        var primaryText = Color.FromArgb(isDark ? "#F2F6F3" : "#17211D");
        var mutedText = Color.FromArgb(isDark ? "#AAB6AF" : "#66716B");
        foreach (var item in items.Reverse())
        {
            HistoryList.Add(new Border
            {
                Padding = 14,
                BackgroundColor = Color.FromArgb(isDark ? "#1C2520" : "#FFFFFF"),
                Stroke = Color.FromArgb(isDark ? "#314239" : "#DCE6E0"),
                StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 15 },
                Content = new HorizontalStackLayout
                {
                    Spacing = 11,
                    Children =
                    {
                        new Border
                        {
                            WidthRequest = 34,
                            HeightRequest = 34,
                            StrokeThickness = 0,
                            BackgroundColor = Color.FromArgb(isDark ? "#244035" : "#E7F1EC"),
                            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 17 },
                            Content = new Label
                            {
                                Text = "✓",
                                TextColor = Color.FromArgb("#0F6B4F"),
                                FontAttributes = FontAttributes.Bold,
                                HorizontalTextAlignment = TextAlignment.Center,
                                VerticalTextAlignment = TextAlignment.Center,
                            },
                        },
                        new VerticalStackLayout
                        {
                            Spacing = 3,
                            HorizontalOptions = LayoutOptions.Fill,
                            Children =
                            {
                            new Label { Text = MarketplacePresentation.StatusLabel(item.ToStatus), FontAttributes = FontAttributes.Bold, FontSize = 12, TextColor = primaryText },
                                new Label { Text = item.Note ?? $"Updated by {item.Actor?.DisplayName ?? "CampusGig"}", FontSize = 10, TextColor = mutedText },
                                new Label { Text = item.CreatedAt.LocalDateTime.ToString("MMM d, yyyy · h:mm tt"), FontSize = 8, TextColor = mutedText },
                            },
                        },
                    }
                }
            });
        }
    }

    private async void OnRevisionClicked(object? sender, EventArgs e)
    {
        var instructions = RevisionEntry.Text?.Trim() ?? "";
        if (instructions.Length < 10) { await DisplayAlertAsync("Add instructions", "Use at least 10 characters.", "OK"); return; }
        if (!await ConfirmTransitionAsync("Request a revision?", "The provider will be asked to submit updated deliverables.", "Request revision")) return;
        if (await ActAsync(sender as BusyButton, "revision", new { instructions }, "Revision requested"))
        {
            RevisionEntry.Text = "";
            RevisionComposer.IsVisible = false;
        }
    }

    private async void OnRevisionComposerClicked(object? sender, EventArgs e)
    {
        RevisionComposer.IsVisible = true;
        if (sender is VisualElement element) await PlayTapAsync(element);
        RevisionEntry.Focus();
    }

    private void OnRevisionCancelClicked(object? sender, EventArgs e)
    {
        RevisionEntry.Unfocus();
        RevisionComposer.IsVisible = false;
    }

    private void OnRevisionTextChanged(object? sender, TextChangedEventArgs e)
    {
        var length = e.NewTextValue?.Length ?? 0;
        RevisionCounterLabel.Text = $"{length}/2000 · minimum 10 characters";
        RequestRevisionButton.IsEnabled = (e.NewTextValue?.Trim().Length ?? 0) >= 10;
    }

    private void OnExtraRevisionTextChanged(object? sender, TextChangedEventArgs e) =>
        ExtraRevisionCheckoutButton.IsEnabled = (e.NewTextValue?.Trim().Length ?? 0) >= 10;

    private void OnCorrectionTextChanged(object? sender, TextChangedEventArgs e) =>
        CorrectionClaimButton.IsEnabled = (e.NewTextValue?.Trim().Length ?? 0) >= 10;

    private async void OnCorrectionClaimClicked(object? sender, EventArgs e)
    {
        var instructions = CorrectionEntry.Text?.Trim() ?? "";
        if (instructions.Length < 10) return;
        if (!await ConfirmTransitionAsync(
            "Ask the provider to acknowledge a correction?",
            "Use this only when the delivery does not meet the original requirements. The provider must acknowledge it before a free correction becomes active.",
            "Send correction claim")) return;
        if (isActing) return;
        isActing = true;
        if (sender is BusyButton button) button.IsBusy = true;
        try
        {
            var result = await api.PostAsync<ApiResult<object>>(
                $"orders/{orderId}/revisions/correction-claim",
                new { instructions });
            CorrectionEntry.Text = "";
            await LoadAsync(false);
            await AppDialog.AlertAsync(this, "Correction claim recorded", result.Message);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Correction claim not sent", exception.Message);
        }
        finally
        {
            isActing = false;
            if (sender is BusyButton busyButton) busyButton.IsBusy = false;
        }
    }

    private async void OnExtraRevisionCheckoutClicked(object? sender, EventArgs e)
    {
        var instructions = ExtraRevisionEntry.Text?.Trim() ?? "";
        if (instructions.Length < 10 || extraRevisionQuote is null || isActing) return;
        if (!await ConfirmTransitionAsync(
            "Purchase this extra revision?",
            $"Total {ProviderEarningsPresentation.FormatAmount(extraRevisionQuote.ClientTotalCentavos, extraRevisionQuote.Currency)}. Payment is optional and becomes authoritative only after PayMongo confirms it.",
            "Open checkout")) return;
        isActing = true;
        if (sender is BusyButton button) button.IsBusy = true;
        try
        {
            var checkout = await api.PostAsync<ExtraRevisionCheckoutResult>(
                $"orders/{orderId}/payments/revision-checkout",
                new { instructions, returnTarget = "MOBILE" });
            if (!Uri.TryCreate(checkout.CheckoutUrl, UriKind.Absolute, out var checkoutUri) || checkoutUri.Scheme != Uri.UriSchemeHttps)
                throw new CampusGigApiException("PayMongo returned an invalid checkout address.");
            Preferences.Default.Set(PendingRevisionPaymentOrderKey, orderId);
            await Browser.Default.OpenAsync(checkoutUri, BrowserLaunchMode.SystemPreferred);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Extra-revision checkout unavailable", exception.Message);
        }
        finally
        {
            isActing = false;
            if (sender is BusyButton busyButton) busyButton.IsBusy = false;
        }
    }

    private async void OnCorrectionAcknowledgeClicked(object? sender, EventArgs e) =>
        await DecideCorrectionAsync(true);

    private async void OnCorrectionDeclineClicked(object? sender, EventArgs e) =>
        await DecideCorrectionAsync(false);

    private async Task DecideCorrectionAsync(bool accepted)
    {
        var revision = detail?.Revisions.LastOrDefault(item =>
            item.Type == "PROVIDER_CORRECTION" && item.Status == "AWAITING_PROVIDER_ACKNOWLEDGEMENT");
        if (revision is null || isActing) return;
        if (!await ConfirmTransitionAsync(
            accepted ? "Acknowledge this correction?" : "Decline this correction claim?",
            accepted
                ? "Acknowledgement creates a free provider correction without consuming the client's included revision allowance."
                : "No correction will activate. The client may use the separate dispute workflow.",
            accepted ? "Acknowledge" : "Decline")) return;
        isActing = true;
        try
        {
            var result = await api.PostAsync<ApiResult<object>>(
                $"orders/{orderId}/revisions/{revision.Id}/correction-decision",
                new { accepted });
            await LoadAsync(false);
            await AppDialog.AlertAsync(this, accepted ? "Correction acknowledged" : "Claim declined", result.Message);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Correction decision not saved", exception.Message);
        }
        finally
        {
            isActing = false;
        }
    }

    private async void OnCompleteClicked(object? sender, EventArgs e)
    {
        if (!await ConfirmTransitionAsync("Accept this delivery?", "This completes the order. Review the submitted files before continuing.", "Accept delivery")) return;
        await ActAsync(sender as BusyButton, "complete", null, "Delivery accepted");
    }

    private async void OnReviewClicked(object? sender, EventArgs e)
    {
        if (!OrderWorkflowRules.IsValidRating(selectedRating))
        {
            await AppDialog.AlertAsync(this, "Choose a rating", "Select between one and five stars before submitting your review.");
            return;
        }
        var rating = selectedRating;
        if (!await ConfirmTransitionAsync("Submit this review?", $"You are giving the provider {rating} out of 5 stars.", "Submit review")) return;
        if (await ActAsync(sender as BusyButton, "review", new { overallRating = rating, qualityRating = rating, communicationRating = rating, timelinessRating = rating, comment = ReviewEntry.Text?.Trim() }, "Review submitted"))
        {
            selectedRating = 0;
            ReviewEntry.Text = "";
            UpdateRatingButtons();
        }
    }

    private void OnRatingClicked(object? sender, EventArgs e)
    {
        if (sender is not Button { CommandParameter: string value } || !int.TryParse(value, out var rating)) return;
        selectedRating = rating;
        UpdateRatingButtons();
    }

    private void OnReviewTextChanged(object? sender, TextChangedEventArgs e) =>
        ReviewCounterLabel.Text = $"{e.NewTextValue?.Length ?? 0}/1000";

    private void UpdateRatingButtons()
    {
        var isDark = Application.Current?.UserAppTheme == AppTheme.Dark;
        var inactiveBackground = Color.FromArgb(isDark ? "#243129" : "#EEF3F0");
        var inactiveText = Color.FromArgb(isDark ? "#92A199" : "#7A8580");
        var buttons = new[] { Rating1Button, Rating2Button, Rating3Button, Rating4Button, Rating5Button };
        for (var index = 0; index < buttons.Length; index++)
        {
            var selected = index < selectedRating;
            buttons[index].BackgroundColor = selected ? Color.FromArgb("#0F6B4F") : inactiveBackground;
            buttons[index].TextColor = selected ? Colors.White : inactiveText;
            SemanticProperties.SetDescription(buttons[index], $"{index + 1} star rating");
        }
        RatingSummaryLabel.Text = OrderWorkflowRules.IsValidRating(selectedRating)
            ? $"{selectedRating} of 5 · {OrderWorkflowRules.RatingDescription(selectedRating)}"
            : OrderWorkflowRules.RatingDescription(selectedRating);
        SubmitReviewButton.IsEnabled = OrderWorkflowRules.IsValidRating(selectedRating);
    }

    private async void OnAcceptClicked(object? sender, EventArgs e)
    {
        if (!await ConfirmTransitionAsync("Accept this request?", "The client will be notified and the project will be reserved for you.", "Accept request")) return;
        await ActAsync(sender as BusyButton, "accept", null, "Request accepted");
    }

    private void OnRejectReasonChanged(object? sender, TextChangedEventArgs e) =>
        RejectRequestButton.IsEnabled = OrderWorkflowRules.CanDecline(e.NewTextValue);

    private async void OnRejectClicked(object? sender, EventArgs e)
    {
        var reason = RejectReasonEntry.Text?.Trim() ?? "";
        if (!OrderWorkflowRules.CanDecline(reason))
        {
            await DisplayAlertAsync("Add a reason", "Tell the client why you cannot accept this request.", "OK");
            return;
        }
        if (!await ConfirmTransitionAsync("Decline this request?", "The client will be notified and this action cannot be undone.", "Decline request")) return;
        await ActAsync(sender as BusyButton, "reject", new { reason }, "Request declined");
    }

    private async void OnStartClicked(object? sender, EventArgs e)
    {
        if (!await ConfirmTransitionAsync("Start this order?", "The client will be notified that work is now in progress.", "Start working")) return;
        await ActAsync(sender as BusyButton, "start", null, "Work started");
    }

    private async void OnPaymentCheckoutClicked(object? sender, EventArgs e)
    {
        if (isActing || sender is not BusyButton button || detail is null) return;
        if (!OrderWorkflowRules.CanOpenCheckout(detail.Status, false, detail.PaymentStatus)) return;
        if (!await ConfirmTransitionAsync(
                "Continue to secure payment?",
                $"Pay {detail.PriceLabel} through PayMongo. CampusGig will confirm the result automatically.",
                "Continue")) return;

        isActing = true;
        button.IsBusy = true;
        Exception? failure = null;
        var browserOpened = false;
        try
        {
            var checkout = await api.PostAsync<PaymentCheckoutResult>(
                $"orders/{orderId}/payments/checkout",
                new { returnTarget = "MOBILE" });
            if (!Uri.TryCreate(checkout.CheckoutUrl, UriKind.Absolute, out var checkoutUri) || checkoutUri.Scheme != Uri.UriSchemeHttps)
                throw new CampusGigApiException("PayMongo returned an invalid checkout address.");
            Preferences.Default.Set(PendingPaymentOrderKey, orderId);
            await Browser.Default.OpenAsync(checkoutUri, BrowserLaunchMode.SystemPreferred);
            browserOpened = true;
            await LoadAsync(false);
        }
        catch (Exception exception)
        {
            failure = exception;
        }
        finally
        {
            button.IsBusy = false;
            isActing = false;
        }
        if (failure is not null && !browserOpened)
            Preferences.Default.Remove(PendingPaymentOrderKey);
        if (failure is not null)
            await AppDialog.AlertAsync(this, "Unable to open payment", failure.Message);
    }

    private async void OnCheckPaymentClicked(object? sender, EventArgs e)
    {
        if (isActing || sender is not BusyButton button) return;
        isActing = true;
        button.IsBusy = true;
        try
        {
            if (!await LoadAsync()) return;
            if (detail?.PaymentStatus != "PAID")
            {
                Preferences.Default.Remove(PendingPaymentOrderKey);
                PaymentCheckButton.IsVisible = false;
                PaymentCheckoutButton.IsVisible = OrderWorkflowRules.CanOpenCheckout(
                    detail?.Status ?? "", false, detail?.PaymentStatus);
                PaymentGuidanceLabel.Text = "Payment is not confirmed yet. You can safely return to the existing checkout.";
            }
        }
        finally
        {
            button.IsBusy = false;
            isActing = false;
        }
    }

    private async void OnRefundRequestClicked(object? sender, EventArgs e)
    {
        if (isActing || refundEligibility?.CanRequest != true) return;
        var reason = refundEligibility.EligibleReasons.Contains("MISSED_RUSH_DEADLINE")
            ? "MISSED_RUSH_DEADLINE"
            : "PAID_NOT_STARTED";
        var amount = refundEligibility.Payment is null
            ? "the complete payment"
            : ProviderEarningsPresentation.FormatAmount(
                refundEligibility.Payment.RefundTotalCentavos,
                refundEligibility.Payment.Currency);
        var confirmed = await AppDialog.ConfirmAsync(
            this,
            "Request full refund?",
            $"This requests {amount}, including the CampusGig service fee. Work and delivery will be blocked while PayMongo processes it.",
            "Request full refund",
            "Not now");
        if (!confirmed) return;
        isActing = true;
        RefundRequestButton.IsBusy = true;
        try
        {
            var result = await api.PostAsync<ApiResult<MarketplaceRefund>>(
                $"orders/{orderId}/payments/refunds",
                new { reason });
            await LoadAsync(false);
            var message = result.Data.Status == "SUCCEEDED"
                ? "PayMongo confirmed the full refund. Provider earnings and the CampusGig fee were reversed."
                : "The full refund is being processed. CampusGig will wait for PayMongo confirmation.";
            await AppDialog.AlertAsync(this, "Refund update", message);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(
                this,
                "Refund needs attention",
                $"{exception.Message} Do not submit another request while CampusGig reconciles the provider outcome.");
            await LoadAsync(false);
        }
        finally
        {
            RefundRequestButton.IsBusy = false;
            isActing = false;
        }
    }

    private async void OnCancelClicked(object? sender, EventArgs e)
    {
        var reason = CancelReasonEntry.Text?.Trim() ?? "";
        if (reason.Length < 3)
        {
            await AppDialog.AlertAsync(this, "Add a reason", "Tell the provider why you are cancelling this request.");
            return;
        }
        if (!await ConfirmTransitionAsync("Cancel this request?", "The provider will be notified and this action cannot be undone.", "Cancel request")) return;
        await ActAsync(sender as BusyButton, "cancel", new { reason }, "Request cancelled");
    }

    private async void OnChooseDeliveryFilesClicked(object? sender, EventArgs e)
    {
        IEnumerable<FileResult?>? picked;
        try
        {
            picked = await FilePicker.Default.PickMultipleAsync(new PickOptions { PickerTitle = "Choose up to five deliverables" });
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Unable to choose files", exception.Message);
            return;
        }
        if (picked is null) return;
        var selected = picked.OfType<FileResult>().ToList();
        if (selected.Count > MobileFileRules.MaximumDeliverableFiles)
        {
            await AppDialog.AlertAsync(this, "Too many files", $"Choose up to {MobileFileRules.MaximumDeliverableFiles} deliverables.");
            return;
        }
        deliveryFiles.Clear();
        deliveryFiles.AddRange(selected);
        var unsupported = deliveryFiles.Where(file => !MobileFileRules.IsSupportedDeliverable(file.FileName)).Select(file => file.FileName).ToList();
        if (unsupported.Count > 0)
        {
            deliveryFiles.Clear();
            DeliveryFilesLabel.Text = "No files selected";
            await DisplayAlertAsync("Unsupported file", $"Choose JPG, PNG, WebP, PDF, ZIP, DOCX, or XLSX files: {string.Join(", ", unsupported)}", "OK");
            return;
        }
        var oversized = new List<string>();
        foreach (var file in deliveryFiles)
        {
            var size = await GetFileSizeAsync(file);
            if (MobileFileRules.ExceedsDeliverableLimit(size)) oversized.Add(file.FileName);
        }
        if (oversized.Count > 0)
        {
            deliveryFiles.Clear();
            DeliveryFilesLabel.Text = "No files selected";
            await DisplayAlertAsync("File too large", $"Each deliverable must be 15 MB or smaller: {string.Join(", ", oversized)}", "OK");
            return;
        }
        DeliveryFilesLabel.Text = deliveryFiles.Count == 0
            ? "No files selected"
            : $"{deliveryFiles.Count} selected · {string.Join(", ", deliveryFiles.Select(file => file.FileName))}";
        deliverySubmissionRequestId = null;
        UpdateDeliveryButton();
    }

    private void OnDeliveryNoteChanged(object? sender, TextChangedEventArgs e)
    {
        deliverySubmissionRequestId = null;
        UpdateDeliveryButton();
    }

    private void UpdateDeliveryButton()
    {
        DeliveryButton.IsEnabled = OrderWorkflowRules.CanSubmitDelivery(
            DeliveryNoteEntry.Text, deliveryFiles.Count, hasOversizedFile: false);
    }

    private async void OnDeliverClicked(object? sender, EventArgs e)
    {
        if (!OrderWorkflowRules.CanSubmitDelivery(DeliveryNoteEntry.Text, deliveryFiles.Count, false)) return;
        if (detail?.PaymentStatus != "PAID")
        {
            await AppDialog.AlertAsync(this, "Payment required", "Wait for PayMongo to confirm the client payment before submitting deliverables.");
            return;
        }
        if (isActing || sender is not BusyButton button) return;
        isActing = true;
        button.IsBusy = true;
        Exception? failure = null;
        string successMessage = "Delivery submitted.";
        try
        {
            deliverySubmissionRequestId ??= Guid.NewGuid().ToString();
            var uploads = deliveryFiles.Select(file =>
                new ApiUpload("files", file.FileName, MobileFileRules.DeliverableContentType(file.FileName, file.ContentType), file.OpenReadAsync)).ToList();
            var result = await api.PostMultipartAsync<ApiResult<OrderDetail>>(
                $"orders/{orderId}/deliver",
                new Dictionary<string, string?>
                {
                    ["note"] = DeliveryNoteEntry.Text!.Trim(),
                    ["clientRequestId"] = deliverySubmissionRequestId,
                }, uploads);
            successMessage = result.Message;
            deliveryFiles.Clear();
            deliverySubmissionRequestId = null;
            DeliveryNoteEntry.Text = "";
            DeliveryFilesLabel.Text = "No files selected";
            await LoadAsync();
        }
        catch (Exception exception) { failure = exception; }
        finally
        {
            button.IsBusy = false;
            isActing = false;
            UpdateDeliveryButton();
        }
        await DisplayAlertAsync(failure is null ? "Delivery submitted" : "Unable to submit delivery",
            failure?.Message ?? successMessage, "OK");
    }

    private async Task<bool> ActAsync(BusyButton? button, string action, object? body, string title)
    {
        if (isActing) return false;
        isActing = true;
        if (button is not null) button.IsBusy = true;
        Exception? failure = null;
        string successMessage = "The order was updated successfully.";
        try
        {
            var result = await api.PostAsync<ApiResult<object>>($"orders/{orderId}/{action}", body);
            successMessage = result.Message;
            await LoadAsync();
        }
        catch (Exception exception) { failure = exception; }
        finally
        {
            if (button is not null) button.IsBusy = false;
            isActing = false;
        }
        await DisplayAlertAsync(failure is null ? title : "Unable to update order",
            failure?.Message ?? successMessage, "OK");
        return failure is null;
    }

    private async Task<bool> ConfirmTransitionAsync(string title, string message, string accept)
    {
        if (isActing) return false;
        isActing = true;
        try { return await AppDialog.ConfirmAsync(this, title, message, accept, "Not now"); }
        finally { isActing = false; }
    }

    private async void OnFileTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not OrderFileItem file) return;
        try
        {
            if (sender is TapGestureRecognizer { Parent: VisualElement card })
                await PlayTapAsync(card);
            var path = await api.DownloadAsync($"orders/{orderId}/files/{file.Id}", file.OriginalName);
            await Launcher.Default.OpenAsync(new OpenFileRequest("Open downloaded file", new ReadOnlyFile(path)));
        }
        catch (Exception exception) { await DisplayAlertAsync("Download failed", exception.Message, "OK"); }
    }

    private async void OnRefreshing(object? sender, EventArgs e) => await LoadAsync();

    private static async Task<long?> GetFileSizeAsync(FileResult file)
    {
        if (!string.IsNullOrWhiteSpace(file.FullPath) && File.Exists(file.FullPath))
            return new FileInfo(file.FullPath).Length;
        await using var stream = await file.OpenReadAsync();
        return stream.CanSeek ? stream.Length : null;
    }
    private static string FormatMoney(int centavos) => $"₱{centavos / 100m:N2}";
    private async void OnCloseClicked(object? sender, EventArgs e) => await CloseAsync();

    protected override bool OnBackButtonPressed()
    {
        _ = CloseAsync();
        return true;
    }

    private Task CloseAsync() => Navigation.NavigationStack.Count > 1
        ? CloseOnceAsync(Navigation.PopAsync)
        : CloseOnceAsync(Navigation.PopModalAsync);

    private async Task CloseOnceAsync(Func<Task> close)
    {
        if (isClosing) return;
        isClosing = true;
        await close();
    }

    private static async Task PlayTapAsync(VisualElement element)
    {
        await element.ScaleToAsync(0.975, 65, Easing.CubicOut);
        await element.ScaleToAsync(1, 115, Easing.CubicOut);
    }

    private void AttachButtonMotion()
    {
        if (buttonMotionAttached) return;
        buttonMotionAttached = true;
        foreach (var button in WorkspaceContent.GetVisualTreeDescendants().OfType<Button>())
        {
            button.Pressed += OnButtonPressed;
            button.Released += OnButtonReleased;
        }
    }

    private static string StatusGuidance(string status, bool isProvider, string? paymentStatus) =>
        (status, isProvider, paymentStatus == "PAID") switch
    {
        ("REQUESTED", true, _) => "Review the brief and decide whether this project fits your availability.",
        ("REQUESTED", false, _) => "Waiting for the provider to review your request.",
        ("ACCEPTED", true, false) => "The project is reserved. Wait for the client payment before starting work.",
        ("ACCEPTED", false, false) => "Your request was accepted. Complete payment so work can begin.",
        ("ACCEPTED", true, true) => "Payment is confirmed. Start the project when you are ready.",
        ("ACCEPTED", false, true) => "Payment is confirmed and work can begin.",
        ("IN_PROGRESS", true, true) => "Work is active. Upload the completed deliverables when ready.",
        ("IN_PROGRESS", false, true) => "The provider is currently working on your project.",
        ("SUBMITTED", true, true) => "Delivery sent. Waiting for the client to accept it or request changes.",
        ("SUBMITTED", false, true) => "Your delivery is ready to download and review.",
        ("REVISION_REQUESTED", true, true) => "The client requested changes. Submit revised deliverables here.",
        ("REVISION_REQUESTED", false, true) => "Your revision request was sent to the provider.",
        ("COMPLETED", _, _) => "This project is complete. Its files and timeline remain available.",
        ("REJECTED", _, _) => "This request was declined. Review the timeline for the reason.",
        ("CANCELLED", _, _) => "This request was cancelled. Review the timeline for the reason.",
        (_, _, false) => "Payment is required before this order can continue.",
        _ => "Follow the latest project activity below.",
    };

    private async void OnButtonPressed(object? sender, EventArgs e)
    {
        if (sender is VisualElement element)
            await element.ScaleToAsync(0.975, 50, Easing.CubicOut);
    }

    private async void OnButtonReleased(object? sender, EventArgs e)
    {
        if (sender is VisualElement element)
            await element.ScaleToAsync(1, 95, Easing.CubicOut);
    }
}
