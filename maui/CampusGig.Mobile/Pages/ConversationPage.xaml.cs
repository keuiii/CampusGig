using System.Collections.ObjectModel;
using System.Globalization;
using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using CampusGig.Mobile.Controls;

namespace CampusGig.Mobile.Pages;

public partial class ConversationPage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly RealtimeService? realtime;
    private readonly ConversationItem conversation;
    private readonly Func<Task>? onClosed;
    private readonly List<FileResult> files = [];
    private ObservableCollection<ConversationMessage> messages = [];
    private readonly SemaphoreSlim loadGate = new(1, 1);
    private IDispatcherTimer? timer;
    private CancellationTokenSource? lifetimeCancellation;
    private bool hasLoaded;
    private bool isClosing;

    public ConversationPage(CampusGigApi api, ConversationItem conversation, Func<Task>? onClosed = null, RealtimeService? realtime = null)
    {
        InitializeComponent();
        NavigationPage.SetHasNavigationBar(this, false);
        this.api = api;
        this.realtime = realtime;
        this.conversation = conversation;
        this.onClosed = onClosed;
        MessageList.ItemsSource = messages;
        ParticipantLabel.Text = conversation.Participant.DisplayName;
        OrderLabel.Text = $"{conversation.Order.OrderNumber}  •  {conversation.Order.Title}";
        OrderLabel.Text = $"{conversation.Order.OrderNumber} · {conversation.Order.Title}";
        ParticipantInitialLabel.Text = conversation.Participant.Initial;
        OrderLabel.Text = $"{conversation.Order.OrderNumber}  •  {conversation.Order.Title}";
        ParticipantImage.IsVisible = conversation.Participant.HasAvatar;
        ParticipantInitialLabel.IsVisible = !conversation.Participant.HasAvatar;
        ParticipantImage.Source = conversation.Participant.HasAvatar
            ? $"{api.BaseUrl}/profile/avatar/{conversation.Participant.Id}?v={conversation.Participant.AvatarVersion}"
            : null;
        UpdateComposerState();
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        HeaderBar.Opacity = 1;
        HeaderBar.TranslationY = 0;
        ComposerBar.Opacity = 1;
        ComposerBar.TranslationY = 0;
        if (realtime is not null)
        {
            realtime.MessageCreated += OnRealtimeMessageCreated;
            realtime.ConversationRead += OnConversationRead;
            realtime.ConnectionChanged += OnRealtimeConnectionChanged;
            OnRealtimeConnectionChanged(realtime.IsConnected);
        }
        lifetimeCancellation?.Cancel();
        lifetimeCancellation?.Dispose();
        lifetimeCancellation = new CancellationTokenSource();
        _ = InitializeAsync(lifetimeCancellation.Token);
        timer = Dispatcher.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(20);
        timer.Tick += async (_, _) => await LoadAsync(false);
        timer.Start();
    }

    protected override void OnDisappearing()
    {
        lifetimeCancellation?.Cancel();
        lifetimeCancellation?.Dispose();
        lifetimeCancellation = null;
        timer?.Stop();
        timer = null;
        if (realtime is not null)
        {
            realtime.MessageCreated -= OnRealtimeMessageCreated;
            realtime.ConversationRead -= OnConversationRead;
            realtime.ConnectionChanged -= OnRealtimeConnectionChanged;
        }
        base.OnDisappearing();
    }

    private async Task InitializeAsync(CancellationToken cancellationToken)
    {
        // Let Android present the page before starting network and collection work.
        await Task.Delay(50, cancellationToken);
        await LoadAsync();
        if (realtime is null || cancellationToken.IsCancellationRequested) return;
        try
        {
            await Task.Run(() => realtime.SubscribeAsync(conversation.Order.Id, cancellationToken), cancellationToken);
        }
        catch (OperationCanceledException) { }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine(exception);
            RealtimeStatusLabel.Text = "Refreshing automatically every 20 seconds";
            RealtimeStatusLabel.Opacity = 0.7;
        }
    }

    private void OnRealtimeMessageCreated(string orderId, ConversationMessage message)
    {
        if (orderId != conversation.Order.Id || messages.Any(item => item.Id == message.Id)) return;
        messages.Add(message);
        MessageList.ScrollTo(message, position: ScrollToPosition.End, animate: true);
    }

    private void OnConversationRead(string orderId, string userId)
    {
        if (orderId != conversation.Order.Id) return;
        foreach (var message in messages.Where(item => item.IsMine)) message.IsRead = true;
    }

    private void OnRealtimeConnectionChanged(bool connected)
    {
        RealtimeStatusLabel.Text = connected ? "● Live private conversation" : "Reconnecting live updates…";
        RealtimeStatusLabel.Opacity = connected ? 1 : 0.7;
    }

    private async Task LoadAsync(bool showError = true)
    {
        if (!await loadGate.WaitAsync(0)) return;
        LoadingMessages.IsVisible = !hasLoaded;
        MessageList.IsVisible = hasLoaded;
        Exception? loadError = null;
        try
        {
            var response = await api.GetAsync<ApiList<ConversationMessage>>($"orders/{conversation.Order.Id}/messages");
            if (!hasLoaded)
            {
                messages = new ObservableCollection<ConversationMessage>(response.Data);
                MessageList.ItemsSource = messages;
                if (messages.Count > 0)
                    MessageList.ScrollTo(messages[^1], position: ScrollToPosition.End, animate: false);
                hasLoaded = true;
                MessageList.IsVisible = true;
                return;
            }
            var existingIds = messages.Select(m => m.Id).ToHashSet();
            var newMessages = response.Data.Where(m => !existingIds.Contains(m.Id)).ToList();
            if (newMessages.Count > 0)
            {
                foreach (var msg in newMessages)
                    messages.Add(msg);
                MessageList.ScrollTo(messages[^1], position: ScrollToPosition.End, animate: messages.Count > newMessages.Count);
            }
            MessageList.IsVisible = true;
        }
        catch (Exception exception) when (!showError) { System.Diagnostics.Debug.WriteLine(exception); }
        catch (Exception exception) { loadError = exception; }
        finally
        {
            LoadingMessages.IsVisible = false;
            Refresh.IsRefreshing = false;
            loadGate.Release();
        }

        if (loadError is not null)
            await AppDialog.AlertAsync(this, "Unable to load conversation", loadError.Message);
    }

    private async void OnAttachClicked(object? sender, EventArgs e)
    {
        IReadOnlyList<FileResult> selected;
        try
        {
            selected = (await FilePicker.Default.PickMultipleAsync(new PickOptions { PickerTitle = "Attach up to three files" }))
                .Where(file => file is not null)
                .Cast<FileResult>()
                .ToList();
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Unable to choose files", exception.Message);
            return;
        }
        if (selected.Count > MobileFileRules.MaximumMessageAttachments)
        {
            await AppDialog.AlertAsync(this, "Too many files", $"Choose up to {MobileFileRules.MaximumMessageAttachments} attachments.");
            return;
        }
        if (selected.Any(file => !MobileFileRules.IsSupportedMessageAttachment(file.FileName)))
        {
            await AppDialog.AlertAsync(this, "Unsupported file",
                "Attachments must be JPG, PNG, WebP, PDF, ZIP, DOCX, or XLSX files.");
            return;
        }
        foreach (var file in selected)
        {
            if (await ExceedsAttachmentLimitAsync(file))
            {
                await AppDialog.AlertAsync(this, "File is too large", $"{file.FileName} exceeds the 15 MB attachment limit.");
                return;
            }
        }
        files.Clear();
        files.AddRange(selected);
        SelectedFilesLabel.Text = string.Join("  •  ", files.Select(file => file.FileName));
        SelectedFilesLabel.Text = string.Join(" · ", files.Select(file => file.FileName));
        SelectedFilesLabel.Text = string.Join(" | ", files.Select(file => file.FileName));
        SelectedFilesLabel.IsVisible = true;
        SelectedFilesPanel.IsVisible = files.Count > 0;
        UpdateComposerState();
    }

    private void OnClearAttachmentsClicked(object? sender, EventArgs e)
    {
        files.Clear();
        SelectedFilesLabel.Text = "";
        SelectedFilesPanel.IsVisible = false;
        UpdateComposerState();
        DraftEntry.Focus();
    }

    private async void OnSendClicked(object? sender, EventArgs e)
    {
        var body = DraftEntry.Text?.Trim() ?? "";
        if (SendButton.IsBusy || !MobileFileRules.CanSendMessage(body, files.Count)) return;
        SendButton.IsBusy = true;
        Exception? failure = null;
        try
        {
            if (files.Count > 0)
            {
                var uploads = files.Select(file => new ApiUpload("files", file.FileName, file.ContentType ?? "application/octet-stream", file.OpenReadAsync)).ToList();
                await api.PostMultipartAsync<ApiResult<ConversationMessage>>($"orders/{conversation.Order.Id}/messages/attachments", new Dictionary<string, string?> { ["body"] = body }, uploads);
            }
            else
                await api.PostAsync<ApiResult<ConversationMessage>>($"orders/{conversation.Order.Id}/messages", new { body });
            DraftEntry.Text = "";
            files.Clear();
            SelectedFilesPanel.IsVisible = false;
            UpdateComposerState();
            await LoadAsync();
        }
        catch (Exception exception) { failure = exception; }
        finally
        {
            SendButton.IsBusy = false;
            UpdateComposerState();
        }
        if (failure is not null)
            await AppDialog.AlertAsync(this, "Message not sent", failure.Message, "Try again");
    }

    private void OnDraftChanged(object? sender, TextChangedEventArgs e) => UpdateComposerState();

    private void UpdateComposerState()
    {
        SendButton.IsEnabled = !SendButton.IsBusy && MobileFileRules.CanSendMessage(DraftEntry.Text, files.Count);
        SendButton.Opacity = SendButton.IsEnabled ? 1 : 0.45;
    }

    private static async Task<bool> ExceedsAttachmentLimitAsync(FileResult file)
    {
        await using var stream = await file.OpenReadAsync();
        if (stream.CanSeek)
            return MobileFileRules.ExceedsMessageAttachmentLimit(stream.Length);

        var buffer = new byte[81920];
        long total = 0;
        int read;
        while ((read = await stream.ReadAsync(buffer)) > 0)
        {
            total += read;
            if (MobileFileRules.ExceedsMessageAttachmentLimit(total)) return true;
        }
        return false;
    }

    private async void OnRefreshing(object? sender, EventArgs e) => await LoadAsync();
    private async void OnMessageTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not ConversationMessage message) return;
        if (message.Attachments.Count == 0) return;
        if (sender is TapGestureRecognizer { Parent: VisualElement bubble })
            await PlayTapAsync(bubble);
        var names = message.Attachments.Select(file => file.OriginalName).ToArray();
        var selected = await DisplayActionSheetAsync("Download attachment", "Cancel", null, names);
        var file = message.Attachments.FirstOrDefault(item => item.OriginalName == selected);
        if (file is null) return;
        try { var path = await api.DownloadAsync($"orders/{conversation.Order.Id}/files/{file.Id}", file.OriginalName); await Launcher.Default.OpenAsync(new OpenFileRequest("Open attachment", new ReadOnlyFile(path))); }
        catch (Exception exception) { await AppDialog.AlertAsync(this, "Download failed", exception.Message); }
    }
    private async void OnCloseClicked(object? sender, EventArgs e) => await CloseAsync();

    protected override bool OnBackButtonPressed()
    {
        _ = CloseAsync();
        return true;
    }

    private async Task CloseAsync()
    {
        if (isClosing) return;
        isClosing = true;
        if (Navigation.NavigationStack.Count > 1)
            await Navigation.PopAsync();
        else
            await Navigation.PopModalAsync();

        if (onClosed is not null)
            await onClosed();
    }

    private static async Task PlayTapAsync(VisualElement element)
    {
        await element.ScaleToAsync(0.975, 60, Easing.CubicOut);
        await element.ScaleToAsync(1, 105, Easing.CubicOut);
    }
}

public sealed class MessageAlignmentConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) => value is true ? LayoutOptions.End : LayoutOptions.Start;
    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();
}
public sealed class MessageBubbleConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        Color.FromArgb(MessagePalette.Bubble(value is true, IsDarkMode));
    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();

    private static bool IsDarkMode => Application.Current?.UserAppTheme == AppTheme.Dark;
}
public sealed class MessageTextConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        Color.FromArgb(MessagePalette.Text(value is true, IsDarkMode));
    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) => throw new NotSupportedException();

    private static bool IsDarkMode => Application.Current?.UserAppTheme == AppTheme.Dark;
}
