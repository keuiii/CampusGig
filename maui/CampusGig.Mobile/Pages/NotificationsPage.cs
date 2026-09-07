using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public sealed class NotificationsPage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly CollectionView list = new();
    private readonly Func<Task>? onUnreadChanged;
    private readonly List<NotificationItem> notificationItems;
    private readonly Button readAllButton;
    private bool readingAll;

    public NotificationsPage(CampusGigApi api, SessionService session, IEnumerable<NotificationItem> items, Func<Task>? onUnreadChanged = null)
    {
        NavigationPage.SetHasNavigationBar(this, false);
        this.api = api;
        this.session = session;
        this.onUnreadChanged = onUnreadChanged;
        Title = "Notifications";
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F7FAF8"), Color.FromArgb("#111713"));

        var close = new Button
        {
            Text = "‹ Discover",
            BackgroundColor = Colors.Transparent,
            TextColor = Color.FromArgb("#0F6B4F"),
            HorizontalOptions = LayoutOptions.Start,
            Padding = new Thickness(0, 8),
        };
        close.Clicked += async (_, _) => await CloseAsync();

        var eyebrow = new Label
        {
            Text = "NOTIFICATIONS",
            FontSize = 9,
            CharacterSpacing = 1.5,
            FontAttributes = FontAttributes.Bold,
            TextColor = Color.FromArgb("#0F6B4F"),
        };
        var heading = new Label { Text = "Account activity", FontSize = 28, FontAttributes = FontAttributes.Bold };
        SetPrimaryText(heading);

        notificationItems = items.ToList();
        list.ItemsSource = notificationItems;
        list.SelectionMode = SelectionMode.Single;
        list.SelectionChanged += OpenAsync;
        list.EmptyView = new VerticalStackLayout
        {
            VerticalOptions = LayoutOptions.Center,
            HorizontalOptions = LayoutOptions.Center,
            Spacing = 8,
            Children =
            {
                new Label { Text = "No notifications yet", FontSize = 16, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center },
                CreateMutedLabel("Order updates and messages will appear here.", 11, true),
            },
        };
        list.ItemTemplate = new DataTemplate(CreateNotificationRow);

        readAllButton = new Button
        {
            Text = "Read all",
            HeightRequest = 40,
            Padding = new Thickness(15, 0),
            CornerRadius = 20,
            FontSize = 11,
            FontAttributes = FontAttributes.Bold,
            HorizontalOptions = LayoutOptions.End,
            VerticalOptions = LayoutOptions.Center,
        };
        readAllButton.SetAppThemeColor(Button.BackgroundColorProperty, Color.FromArgb("#E2F1E8"), Color.FromArgb("#244035"));
        readAllButton.SetAppThemeColor(Button.TextColorProperty, Color.FromArgb("#08543D"), Color.FromArgb("#71D7B1"));
        readAllButton.Clicked += OnReadAllClicked;
        UpdateReadAllButton();

        var headingRow = new Grid { ColumnDefinitions = { new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto) } };
        var headingCopy = new VerticalStackLayout { Spacing = 4, Children = { eyebrow, heading } };
        headingRow.Add(headingCopy, 0);
        headingRow.Add(readAllButton, 1);

        var layout = new Grid
        {
            Padding = new Thickness(22, 12, 22, 24),
            RowDefinitions = { new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star) },
            Children = { new VerticalStackLayout { Spacing = 4, Children = { close, headingRow } }, list },
        };
        Grid.SetRow(list, 1);
        Content = layout;
    }

    private View CreateNotificationRow()
    {
        var icon = new Label { FontSize = 17, HorizontalTextAlignment = TextAlignment.Center, VerticalTextAlignment = TextAlignment.Center };
        icon.SetBinding(Label.TextProperty, nameof(NotificationItem.IconGlyph));
        var iconBox = new Border
        {
            WidthRequest = 38,
            HeightRequest = 38,
            StrokeThickness = 0,
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 19 },
            Content = icon,
        };
        iconBox.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#E2F1E8"), Color.FromArgb("#203B30"));
        var title = new Label { FontAttributes = FontAttributes.Bold, FontSize = 13 };
        title.SetBinding(Label.TextProperty, nameof(NotificationItem.Title));
        SetPrimaryText(title);
        var body = CreateMutedLabel(fontSize: 10);
        body.LineBreakMode = LineBreakMode.WordWrap;
        body.SetBinding(Label.TextProperty, nameof(NotificationItem.Body));
        var time = CreateMutedLabel(fontSize: 9);
        time.SetBinding(Label.TextProperty, new Binding(nameof(NotificationItem.CreatedAt), converter: new NotificationTimeConverter()));
        var unread = new Border
        {
            WidthRequest = 8,
            HeightRequest = 8,
            StrokeThickness = 0,
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 4 },
            BackgroundColor = Color.FromArgb("#0F6B4F"),
            IsVisible = false,
        };
        unread.SetBinding(IsVisibleProperty, nameof(NotificationItem.ReadAt), converter: new UnreadVisibilityConverter());
        var rowGrid = new Grid
        {
            ColumnDefinitions = { new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto) },
            ColumnSpacing = 11,
        };
        var copy = new VerticalStackLayout { Spacing = 4, Children = { title, body, time } };
        rowGrid.Add(iconBox, 0);
        rowGrid.Add(copy, 1);
        rowGrid.Add(unread, 2);
        unread.VerticalOptions = LayoutOptions.Center;

        var row = new Border
        {
            Margin = new Thickness(0, 0, 0, 10),
            Padding = 14,
            Stroke = Color.FromArgb("#DCE6E0"),
            StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 14 },
            Content = rowGrid,
        };
        row.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#FFFFFF"), Color.FromArgb("#1C2520"));
        row.SetAppThemeColor(Border.StrokeProperty, Color.FromArgb("#DCE6E0"), Color.FromArgb("#385046"));
        return row;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        list.Opacity = 0;
        list.TranslationY = 12;
        await Task.WhenAll(
            list.FadeToAsync(1, 180, Easing.CubicOut),
            list.TranslateToAsync(0, 0, 220, Easing.CubicOut));
    }

    private static void SetPrimaryText(Label label) => label.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#17211D"), Color.FromArgb("#F2F6F3"));
    private static Label CreateMutedLabel(string text = "", double fontSize = 10, bool centered = false)
    {
        var label = new Label { Text = text, FontSize = fontSize, HorizontalTextAlignment = centered ? TextAlignment.Center : TextAlignment.Start };
        label.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#66716B"), Color.FromArgb("#AAB6AF"));
        return label;
    }

    protected override bool OnBackButtonPressed()
    {
        _ = CloseAsync();
        return true;
    }

    private async Task CloseAsync()
    {
        if (Navigation.NavigationStack.Count > 1)
            await Navigation.PopAsync();
        else
            await Navigation.PopModalAsync();

        if (onUnreadChanged is not null)
            await onUnreadChanged();
    }

    private void UpdateReadAllButton()
    {
        var unreadCount = notificationItems.Count(item => item.ReadAt is null);
        readAllButton.IsVisible = unreadCount > 0;
        readAllButton.IsEnabled = unreadCount > 0 && !readingAll;
        readAllButton.Text = readingAll ? "Marking..." : "Read all";
    }

    private async void OnReadAllClicked(object? sender, EventArgs e)
    {
        var unreadCount = notificationItems.Count(item => item.ReadAt is null);
        if (readingAll || unreadCount == 0) return;
        var confirmed = await DisplayAlertAsync(
            "Mark all as read?",
            $"Mark all {unreadCount} unread notification{(unreadCount == 1 ? "" : "s")} as read?",
            "Read all",
            "Cancel");
        if (!confirmed) return;

        readingAll = true;
        UpdateReadAllButton();
        Exception? failure = null;
        NotificationReadAllResult? result = null;
        try
        {
            result = await api.PatchAsync<NotificationReadAllResult>("notifications/read-all");
            var readAt = DateTimeOffset.UtcNow;
            foreach (var item in notificationItems.Where(item => item.ReadAt is null)) item.ReadAt = readAt;
            list.ItemsSource = notificationItems.ToList();
            if (onUnreadChanged is not null) await onUnreadChanged();
        }
        catch (Exception exception) { failure = exception; }
        finally
        {
            readingAll = false;
            UpdateReadAllButton();
        }

        await DisplayAlertAsync(
            failure is null ? "Notifications updated" : "Unable to mark notifications",
            failure?.Message ?? result?.Message ?? "All notifications were marked as read.",
            "OK");
    }

    private async void OpenAsync(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is not NotificationItem item) return;
        await list.ScaleToAsync(0.992, 45, Easing.CubicOut);
        await list.ScaleToAsync(1, 80, Easing.CubicOut);
        list.SelectedItem = null;
        try
        {
            if (item.ReadAt is null)
            {
                await api.PatchAsync<ApiResult<NotificationItem>>($"notifications/{item.Id}/read");
                item.ReadAt = DateTimeOffset.UtcNow;
                list.ItemsSource = notificationItems.ToList();
                UpdateReadAllButton();
                if (onUnreadChanged is not null)
                    await onUnreadChanged();
            }
            if (string.IsNullOrWhiteSpace(item.OrderId)) return;
            if (item.Type == "NEW_MESSAGE")
            {
                var conversations = (await api.GetAsync<ApiList<ConversationItem>>("conversations")).Data;
                var conversation = conversations.FirstOrDefault(value => value.Order.Id == item.OrderId);
                if (conversation is not null) { await Navigation.PushAsync(new ConversationPage(api, conversation)); return; }
            }
            await Navigation.PushAsync(new OrderWorkspacePage(api, session, item.OrderId));
        }
        catch (Exception ex) { await DisplayAlertAsync("Unable to open notification", ex.Message, "OK"); }
    }
}

internal sealed class NotificationTimeConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, System.Globalization.CultureInfo culture) =>
        value is DateTimeOffset timestamp ? timestamp.LocalDateTime.ToString("MMM d, yyyy · h:mm tt") : "";

    public object ConvertBack(object? value, Type targetType, object? parameter, System.Globalization.CultureInfo culture) => throw new NotSupportedException();
}

internal sealed class UnreadVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, System.Globalization.CultureInfo culture) => value is null;

    public object ConvertBack(object? value, Type targetType, object? parameter, System.Globalization.CultureInfo culture) => throw new NotSupportedException();
}
