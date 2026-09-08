using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using CampusGig.Mobile.Controls;

namespace CampusGig.Mobile.Pages;

public partial class OrderWorkspacePage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly string orderId;
    private OrderDetail? detail;
    private CancellationTokenSource? refreshCancellation;
    private bool isLoading;
    private bool isActing;
    private readonly List<FileResult> deliveryFiles = [];
    private bool entrancePlayed;
    private bool buttonMotionAttached;
    private bool isClosing;
    private string previousStatus = "";

    public OrderWorkspacePage(CampusGigApi api, SessionService session, string orderId)
    {
        InitializeComponent();
        NavigationPage.SetHasNavigationBar(this, false);
        this.api = api;
        this.session = session;
        this.orderId = orderId;
        RatingPicker.SelectedIndex = 0;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (detail is null) await LoadAsync();
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
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        refreshCancellation = new CancellationTokenSource();
        _ = RefreshInBackgroundAsync(refreshCancellation.Token);
    }

    protected override void OnDisappearing()
    {
        refreshCancellation?.Cancel();
        refreshCancellation?.Dispose();
        refreshCancellation = null;
        base.OnDisappearing();
    }

    private async Task LoadAsync(bool showError = true)
    {
        if (isLoading) return;
        isLoading = true;
        Exception? failure = null;
        try
        {
            detail = (await api.GetAsync<ApiResult<OrderDetail>>($"orders/{orderId}")).Data;
            TitleLabel.Text = detail.Title;
            StatusLabel.Text = detail.Status.Replace('_', ' ');
            OrderMetaLabel.Text = $"{detail.OrderNumber} · Provider {detail.Provider.DisplayName}";
            RequirementsLabel.Text = detail.Requirements;
            PackageLabel.Text = detail.Package.Name;
            TotalLabel.Text = detail.PriceLabel;
            DueLabel.Text = detail.DueAt.ToString("MMM d, yyyy");
            EmptyFilesLabel.IsVisible = detail.Files.Count == 0;
            BindableLayout.SetItemsSource(FileList, detail.Files);
            var isProvider = OrderWorkflowRules.IsProvider(detail, session.User?.Id);
            WorkspaceRoleLabel.Text = isProvider ? "PROVIDER WORKSPACE" : "CLIENT WORKSPACE";
            CounterpartyLabel.Text = isProvider
                ? $"Project for {detail.Client.DisplayName}"
                : $"Working with {detail.Provider.DisplayName}";
            RoleIconLabel.Text = isProvider ? "↗" : "✓";
            StatusGuidanceLabel.Text = StatusGuidance(detail.Status, isProvider);
            var canRequestRevision = detail.RevisionsUsed < detail.RevisionLimit;
            ProviderDecisionPanel.IsVisible = OrderWorkflowRules.CanDecide(detail.Status, isProvider);
            ClientCancelPanel.IsVisible = OrderWorkflowRules.CanCancel(detail.Status, isProvider);
            ProviderStartPanel.IsVisible = OrderWorkflowRules.CanStart(detail.Status, isProvider);
            ProviderDeliveryPanel.IsVisible = OrderWorkflowRules.CanDeliver(detail.Status, isProvider);
            DeliveryTitleLabel.Text = detail.Status == "REVISION_REQUESTED" ? "Submit revised work" : "Submit deliverables";
            DeliveryButton.Text = detail.Status == "REVISION_REQUESTED" ? "Submit revision" : "Submit delivery";
            SubmittedActions.IsVisible = OrderWorkflowRules.CanReviewDelivery(detail.Status, isProvider);
            RevisionGroup.IsVisible = canRequestRevision;
            NoRevisionsLeftLabel.IsVisible = !canRequestRevision;
            RevisionsRemainingLabel.Text = $"Revisions used: {detail.RevisionsUsed} of {detail.RevisionLimit}";
            ReviewActions.IsVisible = OrderWorkflowRules.CanReviewProvider(detail.Status, isProvider, detail.Review is not null);
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
        finally { isLoading = false; Refresh.IsRefreshing = false; }
        if (showError && failure is not null)
            await DisplayAlertAsync("Unable to load order", failure.Message, "OK");
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
                                new Label { Text = item.ToStatus.Replace('_', ' '), FontAttributes = FontAttributes.Bold, FontSize = 11, TextColor = primaryText },
                                new Label { Text = item.Note ?? $"Updated by {item.Actor.DisplayName}", FontSize = 10, TextColor = mutedText },
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
        await ActAsync(sender as BusyButton, "revision", new { instructions }, "Revision requested");
    }

    private async void OnCompleteClicked(object? sender, EventArgs e)
    {
        if (!await ConfirmTransitionAsync("Accept this delivery?", "This completes the order. Review the submitted files before continuing.", "Accept delivery")) return;
        await ActAsync(sender as BusyButton, "complete", null, "Delivery accepted");
    }

    private async void OnReviewClicked(object? sender, EventArgs e)
    {
        var rating = 5 - Math.Max(0, RatingPicker.SelectedIndex);
        if (!await ConfirmTransitionAsync("Submit this review?", $"You are giving the provider {rating} out of 5 stars.", "Submit review")) return;
        await ActAsync(sender as BusyButton, "review", new { overallRating = rating, qualityRating = rating, communicationRating = rating, timelinessRating = rating, comment = ReviewEntry.Text?.Trim() }, "Review submitted");
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
        UpdateDeliveryButton();
    }

    private void OnDeliveryNoteChanged(object? sender, TextChangedEventArgs e) => UpdateDeliveryButton();

    private void UpdateDeliveryButton()
    {
        DeliveryButton.IsEnabled = OrderWorkflowRules.CanSubmitDelivery(
            DeliveryNoteEntry.Text, deliveryFiles.Count, hasOversizedFile: false);
    }

    private async void OnDeliverClicked(object? sender, EventArgs e)
    {
        if (!OrderWorkflowRules.CanSubmitDelivery(DeliveryNoteEntry.Text, deliveryFiles.Count, false)) return;
        if (isActing || sender is not BusyButton button) return;
        isActing = true;
        button.IsBusy = true;
        Exception? failure = null;
        string successMessage = "Delivery submitted.";
        try
        {
            var uploads = deliveryFiles.Select(file =>
                new ApiUpload("files", file.FileName, MobileFileRules.DeliverableContentType(file.FileName, file.ContentType), file.OpenReadAsync)).ToList();
            var result = await api.PostMultipartAsync<ApiResult<OrderDetail>>(
                $"orders/{orderId}/deliver",
                new Dictionary<string, string?> { ["note"] = DeliveryNoteEntry.Text!.Trim() }, uploads);
            successMessage = result.Message;
            deliveryFiles.Clear();
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

    private async Task ActAsync(BusyButton? button, string action, object? body, string title)
    {
        if (isActing) return;
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

    private static string StatusGuidance(string status, bool isProvider) => (status, isProvider) switch
    {
        ("REQUESTED", true) => "Review the brief and decide whether this project fits your availability.",
        ("REQUESTED", false) => "Waiting for the provider to review your request.",
        ("ACCEPTED", true) => "The project is reserved. Start it when you are ready to work.",
        ("ACCEPTED", false) => "Your request was accepted and work will begin soon.",
        ("IN_PROGRESS", true) => "Work is active. Upload the completed deliverables when ready.",
        ("IN_PROGRESS", false) => "The provider is currently working on your project.",
        ("SUBMITTED", true) => "Delivery sent. Waiting for the client to accept it or request changes.",
        ("SUBMITTED", false) => "Your delivery is ready to download and review.",
        ("REVISION_REQUESTED", true) => "The client requested changes. Submit revised deliverables here.",
        ("REVISION_REQUESTED", false) => "Your revision request was sent to the provider.",
        ("COMPLETED", _) => "This project is complete. Its files and timeline remain available.",
        ("REJECTED", _) => "This request was declined. Review the timeline for the reason.",
        ("CANCELLED", _) => "This request was cancelled. Review the timeline for the reason.",
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
