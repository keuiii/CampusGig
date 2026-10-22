using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using CampusGig.Mobile.Controls;
using Microsoft.Maui.Controls.Shapes;
using Microsoft.Maui.Layouts;

namespace CampusGig.Mobile.Pages;

public sealed class ProviderListingsPage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly RealtimeService realtime;
    private readonly CollectionView list;
    private readonly RefreshView refresh;
    private readonly VerticalStackLayout loading;
    private readonly Border statusSummary;
    private readonly Label publishedCount = new() { FontSize = 16, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center };
    private readonly Label reviewCount = new() { FontSize = 16, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center };
    private readonly Label draftCount = new() { FontSize = 16, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center };
    private bool isLoading;
    private bool subscribed;

    public ProviderListingsPage(CampusGigApi api, RealtimeService realtime)
    {
        this.api = api;
        this.realtime = realtime;
        Title = "My listings";
        NavigationPage.SetHasNavigationBar(this, false);
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F3F5F3"), Color.FromArgb("#111713"));

        var close = new Button
        {
            Text = "< Profile",
            BackgroundColor = Colors.Transparent,
            TextColor = Color.FromArgb("#0F6B4F"),
            FontAttributes = FontAttributes.Bold,
            Padding = new Thickness(2, 4),
            MinimumHeightRequest = 44,
            HorizontalOptions = LayoutOptions.Start,
        };
        close.Clicked += async (_, _) => await Navigation.PopModalAsync();

        var create = new Button
        {
            Text = "+",
            AutomationId = "ProviderNewListing",
            BackgroundColor = Color.FromArgb("#0F6B4F"),
            TextColor = Colors.White,
            FontAttributes = FontAttributes.Bold,
            FontSize = 26,
            WidthRequest = 48,
            HeightRequest = 48,
            CornerRadius = 24,
            Padding = 0,
            HorizontalOptions = LayoutOptions.End,
            VerticalOptions = LayoutOptions.Center,
        };
        SemanticProperties.SetDescription(create, "Create a new listing");
        SemanticProperties.SetHint(create, "Opens the service listing editor");
        ToolTipProperties.SetText(create, "New listing");
        create.Clicked += async (_, _) => await OpenEditorAsync();

        var header = new Grid
        {
            Padding = new Thickness(20, 14, 18, 9),
            RowDefinitions = new RowDefinitionCollection
            {
                new(GridLength.Auto),
                new(GridLength.Auto),
            },
            ColumnDefinitions = new ColumnDefinitionCollection
            {
                new(GridLength.Star),
                new(GridLength.Auto),
            },
            RowSpacing = 5,
        };
        header.Add(close);
        header.Add(new VerticalStackLayout
        {
            Spacing = 3,
            Children =
            {
                new Label { Text = "PROVIDER WORKSPACE", FontSize = 9, CharacterSpacing = 1.4, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F8060") },
                new Label { Text = "My listings", AutomationId = "ProviderListingsTitle", FontSize = 26, FontAttributes = FontAttributes.Bold },
                new Label { Text = "Preview and control marketplace visibility.", FontSize = 12, TextColor = Color.FromArgb("#66716B") },
            },
        }, 0, 1);
        header.Add(create, 1, 1);

        var summaryGrid = new Grid
        {
            ColumnDefinitions =
            {
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Star),
            },
            ColumnSpacing = 8,
        };
        summaryGrid.Add(StatusSummaryItem(publishedCount, "PUBLISHED"));
        summaryGrid.Add(StatusSummaryItem(reviewCount, "UNDER REVIEW"), 1);
        summaryGrid.Add(StatusSummaryItem(draftCount, "DRAFT"), 2);
        statusSummary = new Border
        {
            IsVisible = false,
            Margin = new Thickness(0, 0, 0, 12),
            Padding = new Thickness(12, 10),
            Stroke = Color.FromArgb("#DDE4DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 16 },
            Content = summaryGrid,
        };
        statusSummary.SetAppThemeColor(Border.BackgroundColorProperty, Colors.White, Color.FromArgb("#1A231F"));

        list = new CollectionView
        {
            Margin = new Thickness(20, 4, 20, 24),
            SelectionMode = SelectionMode.None,
            ItemSizingStrategy = ItemSizingStrategy.MeasureAllItems,
            ItemsLayout = new LinearItemsLayout(ItemsLayoutOrientation.Vertical) { ItemSpacing = 12 },
            EmptyView = new VerticalStackLayout
            {
                Padding = new Thickness(24, 44),
                Spacing = 8,
                Children =
                {
                    new Label { Text = "No listings yet", FontSize = 20, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center },
                    new Label { Text = "Create your first service here, then submit it for administrator review.", FontSize = 12, TextColor = Color.FromArgb("#66716B"), HorizontalTextAlignment = TextAlignment.Center },
                },
            },
            Header = statusSummary,
            ItemTemplate = new DataTemplate(CreateListingCard),
        };

        refresh = new RefreshView { Content = list, Command = new Command(async () => await LoadAsync()) };
        loading = new VerticalStackLayout
        {
            IsVisible = false,
            Margin = new Thickness(20, 4, 20, 0),
            Spacing = 12,
            VerticalOptions = LayoutOptions.Start,
            Children =
            {
                new SkeletonCard { Kind = SkeletonCardKind.Listing },
                new SkeletonCard { Kind = SkeletonCardKind.Listing },
            },
        };
        SemanticProperties.SetDescription(loading, "Loading provider listings");
        var body = new Grid();
        body.Add(refresh);
        body.Add(loading);

        var root = new Grid
        {
            RowDefinitions = new RowDefinitionCollection
            {
                new(GridLength.Auto),
                new(GridLength.Star),
            },
        };
        root.Add(header);
        root.Add(body, 0, 1);
        Content = root;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (!subscribed)
        {
            realtime.MarketplaceChanged += OnMarketplaceChanged;
            realtime.AccountChanged += OnAccountChanged;
            subscribed = true;
        }
        await LoadAsync();
    }

    protected override void OnDisappearing()
    {
        if (subscribed)
        {
            realtime.MarketplaceChanged -= OnMarketplaceChanged;
            realtime.AccountChanged -= OnAccountChanged;
            subscribed = false;
        }
        base.OnDisappearing();
    }

    private View CreateListingCard()
    {
        ProviderListing? current = null;
        var title = new Label { FontSize = 17, FontAttributes = FontAttributes.Bold };
        var summary = new Label { FontSize = 11, TextColor = Color.FromArgb("#66716B") };
        var price = new Label { FontSize = 16, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F6B4F") };
        var badge = new Border
        {
            Padding = new Thickness(9, 5),
            MinimumHeightRequest = 28,
            HorizontalOptions = LayoutOptions.End,
            VerticalOptions = LayoutOptions.Center,
            StrokeThickness = 0,
            StrokeShape = new RoundRectangle { CornerRadius = 12 },
            Content = new Label
            {
                FontSize = 9,
                FontAttributes = FontAttributes.Bold,
                HorizontalTextAlignment = TextAlignment.Center,
                VerticalTextAlignment = TextAlignment.Center,
            },
        };
        var statusCopy = new Label { FontSize = 11, TextColor = Color.FromArgb("#66716B") };
        var preview = ActionIconButton("listing_preview.svg", "Preview listing");
        preview.AutomationId = "ProviderListingPreview";
        var edit = ActionIconButton("listing_edit.svg", "Edit listing");
        edit.AutomationId = "ProviderListingEdit";
        var primary = ActionIconButton("listing_submit.svg", "Submit listing", primary: true);
        primary.AutomationId = "ProviderListingPrimaryAction";
        var archive = ActionIconButton("listing_archive.svg", "Archive listing", destructive: true);

        preview.Clicked += async (_, _) =>
        {
            if (current is not null) await Navigation.PushAsync(new ProviderListingPreviewPage(api, current));
        };
        edit.Clicked += async (_, _) =>
        {
            if (current is not null) await BeginEditingAsync(current);
        };
        primary.Clicked += async (_, _) =>
        {
            if (current is null || primary.CommandParameter is not string action) return;
            if (action == "submit")
                await SubmitAsync(current);
            else
                await TransitionAsync(current, action);
        };
        archive.Clicked += async (_, _) =>
        {
            if (current is not null) await TransitionAsync(current, "archive");
        };

        var heading = new Grid
        {
            ColumnDefinitions = new ColumnDefinitionCollection
            {
                new(GridLength.Star),
                new(GridLength.Auto),
            },
            ColumnSpacing = 10,
        };
        heading.Add(new VerticalStackLayout { Spacing = 4, Children = { title, summary } });
        heading.Add(badge, 1, 0);

        var actions = new HorizontalStackLayout
        {
            Spacing = 10,
            HorizontalOptions = LayoutOptions.Start,
        };
        actions.Add(preview);
        actions.Add(edit);
        actions.Add(primary);
        actions.Add(archive);
        var card = new Border
        {
            Padding = 17,
            Stroke = Color.FromArgb("#DDE4DF"),
            StrokeThickness = 1,
            StrokeShape = new RoundRectangle { CornerRadius = 18 },
            Content = new VerticalStackLayout
            {
                Spacing = 11,
                Children = { heading, price, statusCopy, actions },
            },
        };
        card.SetAppThemeColor(Border.BackgroundColorProperty, Colors.White, Color.FromArgb("#1A231F"));
        card.BindingContextChanged += (_, _) =>
        {
            current = card.BindingContext as ProviderListing;
            if (current is null) return;
            title.Text = current.Title;
            summary.Text = current.SummaryLabel;
            price.Text = current.PriceLabel;
            statusCopy.Text = ProviderListingLifecycleRules.StatusCopy(current.Status);
            ((Label)badge.Content).Text = current.StatusLabel;
            ApplyStatusPalette(badge, current.Status);
            var available = ProviderListingLifecycleRules.Actions(current.Status);
            var supportedPricing = PricingModelRules.IsLegacy(current.PricingModel) ||
                PricingModelRules.IsSinglePriceV2(current.PricingModel);
            edit.IsVisible = supportedPricing && available.Contains("edit");
            var mainAction = available.FirstOrDefault(action => action is "submit" or "pause" or "resume" or "restore");
            if (!supportedPricing && mainAction == "submit") mainAction = null;
            primary.IsVisible = mainAction is not null;
            primary.CommandParameter = mainAction;
            if (mainAction is not null) ConfigurePrimaryAction(primary, mainAction);
            archive.IsVisible = available.Contains("archive");
        };
        return card;
    }

    private async Task LoadAsync()
    {
        if (isLoading)
        {
            refresh.IsRefreshing = false;
            return;
        }
        isLoading = true;
        loading.IsVisible = list.ItemsSource is null;
        try
        {
            var result = await api.GetAsync<ApiList<ProviderListing>>("provider/services");
            list.ItemsSource = result.Data;
            publishedCount.Text = result.Data.Count(item => item.Status == "PUBLISHED").ToString();
            reviewCount.Text = result.Data.Count(item => item.Status == "PENDING_REVIEW").ToString();
            draftCount.Text = result.Data.Count(item => item.Status == "DRAFT").ToString();
            statusSummary.IsVisible = result.Data.Count > 0;
        }
        catch (Exception exception)
        {
            await DisplayAlertAsync("Unable to load listings", exception.Message, "OK");
        }
        finally
        {
            isLoading = false;
            loading.IsVisible = false;
            refresh.IsRefreshing = false;
        }
    }

    private static View StatusSummaryItem(Label count, string label) => new VerticalStackLayout
    {
        Spacing = 2,
        Children =
        {
            count,
            new Label
            {
                Text = label,
                FontSize = 8,
                CharacterSpacing = 0.7,
                FontAttributes = FontAttributes.Bold,
                TextColor = Color.FromArgb("#66716B"),
                HorizontalTextAlignment = TextAlignment.Center,
                MaxLines = 1,
            },
        },
    };

    private async Task TransitionAsync(ProviderListing listing, string action)
    {
        if (action == "archive")
        {
            var confirmed = await DisplayAlertAsync(
                "Archive this listing?",
                "Clients will no longer see it. Restoring it later returns it in a paused state.",
                "Archive",
                "Cancel");
            if (!confirmed) return;
        }

        try
        {
            var endpointAction = ProviderListingLifecycleRules.EndpointAction(action);
            var result = await api.PostAsync<ApiResult<ProviderListing>>(
                $"provider/services/{listing.Id}/{endpointAction}");
            await LoadAsync();
            await DisplayAlertAsync("Listing updated", result.Message ?? ProviderListingLifecycleRules.StatusCopy(result.Data.Status), "OK");
        }
        catch (Exception exception)
        {
            await LoadAsync();
            await DisplayAlertAsync("Unable to update listing", exception.Message, "OK");
        }
    }

    private Task OpenEditorAsync(ProviderListing? listing = null) => Navigation.PushAsync(
        new ProviderListingEditorPage(api, listing, LoadAsync));

    private async Task BeginEditingAsync(ProviderListing listing)
    {
        if (listing.Status is not ("PUBLISHED" or "PAUSED"))
        {
            await OpenEditorAsync(listing);
            return;
        }

        var confirmed = await DisplayAlertAsync(
            "Edit this approved listing?",
            "The listing will become a private draft and disappear from Discover until an administrator approves it again. Existing orders will not change.",
            "Create private draft",
            "Cancel");
        if (!confirmed) return;

        try
        {
            var result = await api.PostAsync<ApiResult<ProviderListing>>(
                $"provider/services/{listing.Id}/revise");
            await LoadAsync();
            await OpenEditorAsync(result.Data);
        }
        catch (Exception exception)
        {
            await LoadAsync();
            await DisplayAlertAsync("Unable to edit listing", exception.Message, "OK");
        }
    }

    private async Task SubmitAsync(ProviderListing listing)
    {
        var confirmed = await DisplayAlertAsync(
            "Submit for review?",
            "You will not be able to edit the listing while an administrator reviews it.",
            "Submit",
            "Cancel");
        if (!confirmed) return;
        try
        {
            await api.PostAsync<ApiResult<ProviderListing>>($"provider/services/{listing.Id}/submit");
            await LoadAsync();
            await DisplayAlertAsync(
                "Submitted for review",
                "Your listing remains private until an administrator approves it.",
                "OK");
        }
        catch (Exception exception)
        {
            await LoadAsync();
            await DisplayAlertAsync("Unable to submit listing", exception.Message, "OK");
        }
    }

    private void OnMarketplaceChanged() => _ = LoadAsync();
    private void OnAccountChanged(string resource)
    {
        if (resource == "services") _ = LoadAsync();
    }

    private static ImageButton ActionIconButton(
        string icon,
        string description,
        bool primary = false,
        bool destructive = false)
    {
        var button = new ImageButton
        {
            Source = icon,
            WidthRequest = 46,
            HeightRequest = 46,
            MinimumWidthRequest = 46,
            MinimumHeightRequest = 46,
            CornerRadius = 23,
            Padding = new Thickness(12),
            Aspect = Aspect.AspectFit,
            BackgroundColor = destructive
                ? Color.FromArgb("#FDE9E6")
                : primary
                    ? Color.FromArgb("#0F6B4F")
                    : Color.FromArgb("#E8F3EE"),
        };
        SetActionDescription(button, description);
        return button;
    }

    private static void ConfigurePrimaryAction(ImageButton button, string action)
    {
        button.Source = action switch
        {
            "pause" => "listing_pause.svg",
            "resume" => "listing_resume.svg",
            "restore" => "listing_restore.svg",
            _ => "listing_submit.svg",
        };
        SetActionDescription(button, $"{ProviderListingLifecycleRules.ActionLabel(action)} listing");
    }

    private static void SetActionDescription(ImageButton button, string description)
    {
        SemanticProperties.SetDescription(button, description);
        SemanticProperties.SetHint(button, $"Activates {description.ToLowerInvariant()}");
        ToolTipProperties.SetText(button, description);
    }

    private static void ApplyStatusPalette(Border badge, string status)
    {
        var (background, foreground) = status switch
        {
            "PUBLISHED" => ("#DFF2E8", "#176643"),
            "PAUSED" => ("#E8EEF8", "#3B5F8C"),
            "ARCHIVED" => ("#EDECEA", "#68645F"),
            "REJECTED" => ("#FFF0EE", "#A33E36"),
            "PENDING_REVIEW" => ("#FFF4D5", "#8A6811"),
            _ => ("#EDF0EE", "#58635E"),
        };
        badge.BackgroundColor = Color.FromArgb(background);
        if (badge.Content is Label label)
            label.TextColor = Color.FromArgb(foreground);
    }
}

internal sealed class ProviderListingPreviewPage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly ProviderListing listing;
    private readonly ServiceMedia? coverMedia;
    private readonly Border? coverFrame;
    private readonly Image? coverImage;
    private bool coverLoadAttempted;

    public ProviderListingPreviewPage(CampusGigApi api, ProviderListing listing)
    {
        this.api = api;
        this.listing = listing;
        coverMedia = listing.Media.FirstOrDefault(item =>
            string.Equals(item.Kind, "COVER", StringComparison.OrdinalIgnoreCase));
        Title = "Listing preview";
        NavigationPage.SetHasNavigationBar(this, false);
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F3F5F3"), Color.FromArgb("#111713"));
        var content = new VerticalStackLayout { Padding = 20, Spacing = 16 };
        if (coverMedia is not null)
        {
            coverImage = new Image
            {
                Aspect = Aspect.AspectFill,
                HeightRequest = 190,
                AutomationId = "ListingPreviewCover",
            };
            coverFrame = new Border
            {
                HeightRequest = 190,
                Padding = 0,
                StrokeThickness = 0,
                StrokeShape = new RoundRectangle { CornerRadius = 18 },
                BackgroundColor = Color.FromArgb("#EAF1EC"),
                Content = coverImage,
            };
            content.Add(coverFrame);
        }
        content.Add(new Label { Text = "CLIENT PREVIEW", FontSize = 9, CharacterSpacing = 1.4, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F8060") });
        content.Add(new Label { Text = listing.Title, FontSize = 29, FontAttributes = FontAttributes.Bold, LineBreakMode = LineBreakMode.WordWrap });
        content.Add(new Label { Text = $"{listing.Category.Name}  ·  {listing.DeliveryMethod.ToLowerInvariant().Replace('_', ' ')}", FontSize = 12, TextColor = Color.FromArgb("#66716B") });
        content.Add(new Label { Text = listing.Description, FontSize = 14, LineHeight = 1.45, LineBreakMode = LineBreakMode.WordWrap });
        if (!string.IsNullOrWhiteSpace(listing.CampusLocation))
            content.Add(InfoRow("Campus location", listing.CampusLocation));
        content.Add(new Label
        {
            Text = PricingModelRules.IsSinglePriceV2(listing.PricingModel) ? "SINGLE-PRICE TERMS" : "CHOOSE A PACKAGE",
            Margin = new Thickness(0, 10, 0, 0),
            FontSize = 9,
            CharacterSpacing = 1.3,
            FontAttributes = FontAttributes.Bold,
            TextColor = Color.FromArgb("#0F8060"),
        });
        if (PricingModelRules.IsSinglePriceV2(listing.PricingModel))
            content.Add(InfoRow(
                $"₱{(listing.BasePriceCentavos ?? 0) / 100m:N0} fixed price",
                $"{PricingModelRules.FormatDeliveryMinutes(listing.NormalDeliveryMinutes)} delivery · {listing.IncludedRevisionLimit ?? 0} revisions"));
        else if (PricingModelRules.IsLegacy(listing.PricingModel))
            foreach (var package in listing.Packages.Where(item => item.IsActive))
                content.Add(PackageCard(package));
        else
            content.Add(InfoRow("Unsupported pricing", "Update CampusGig to view these terms."));
        content.Add(new Label
        {
            Text = "Preview only. Clients can book this service only while it is published.",
            Margin = new Thickness(0, 8, 0, 24),
            FontSize = 11,
            TextColor = Color.FromArgb("#66716B"),
        });
        var back = new Button
        {
            Text = "< Listing preview",
            AutomationId = "ListingPreviewBack",
            BackgroundColor = Colors.Transparent,
            TextColor = Color.FromArgb("#0F6B4F"),
            FontAttributes = FontAttributes.Bold,
            FontSize = 16,
            Padding = new Thickness(2, 4),
            MinimumHeightRequest = 44,
            HorizontalOptions = LayoutOptions.Start,
        };
        SemanticProperties.SetDescription(back, "Back to listings");
        back.Clicked += async (_, _) => await Navigation.PopAsync();
        var header = new Border
        {
            Padding = new Thickness(18, 12),
            StrokeThickness = 0,
            Content = back,
        };
        header.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#F9FBF9"), Color.FromArgb("#142019"));
        var surface = new Border
        {
            Margin = new Thickness(18, 16, 18, 30),
            Padding = 0,
            VerticalOptions = LayoutOptions.Start,
            HorizontalOptions = LayoutOptions.Fill,
            Stroke = Color.FromArgb("#DDE4DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 22 },
            Content = content,
        };
        surface.SetAppThemeColor(Border.BackgroundColorProperty, Colors.White, Color.FromArgb("#1A231F"));
        var root = new Grid
        {
            RowDefinitions =
            {
                new RowDefinition(GridLength.Auto),
                new RowDefinition(GridLength.Star),
            },
        };
        root.Add(header);
        root.Add(new ScrollView { Content = surface }, 0, 1);
        Content = root;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (coverLoadAttempted || coverMedia is null || coverImage is null || coverFrame is null) return;
        coverLoadAttempted = true;
        try
        {
            var path = await api.DownloadAsync(
                $"provider/services/{listing.Id}/media/{coverMedia.Id}",
                coverMedia.OriginalName);
            coverImage.Source = ImageSource.FromFile(path);
        }
        catch (Exception exception) when (exception is CampusGigApiException or HttpRequestException or IOException)
        {
            System.Diagnostics.Debug.WriteLine($"Listing preview cover could not be loaded: {exception.Message}");
            coverFrame.IsVisible = false;
        }
    }

    private static View InfoRow(string label, string value)
    {
        var grid = new Grid
        {
            ColumnDefinitions = new ColumnDefinitionCollection
            {
                new(GridLength.Star),
                new(GridLength.Auto),
            },
        };
        grid.Add(new Label { Text = label, FontAttributes = FontAttributes.Bold, FontSize = 12 });
        grid.Add(new Label { Text = value, FontSize = 12, TextColor = Color.FromArgb("#66716B") }, 1, 0);
        return new Border
        {
            Padding = 14,
            Stroke = Color.FromArgb("#DDE4DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 13 },
            Content = grid,
        };
    }

    private static View PackageCard(ServicePackage package)
    {
        var card = new Border
        {
            Padding = 17,
            Stroke = Color.FromArgb("#DDE4DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 17 },
            Content = new VerticalStackLayout
            {
                Spacing = 7,
                Children =
                {
                    new Label { Text = package.Tier, FontSize = 9, CharacterSpacing = 1.2, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F8060") },
                    new Label { Text = package.Name, FontSize = 17, FontAttributes = FontAttributes.Bold, LineBreakMode = LineBreakMode.WordWrap },
                    new Label { Text = package.Description, FontSize = 12, TextColor = Color.FromArgb("#66716B"), LineBreakMode = LineBreakMode.WordWrap },
                    new Label { Text = $"₱{package.PriceCentavos / 100:N0}", FontSize = 21, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F6B4F") },
                    new Label { Text = $"{package.DeliveryDays} day delivery  ·  {package.RevisionLimit} revision{(package.RevisionLimit == 1 ? "" : "s")}", FontSize = 11, TextColor = Color.FromArgb("#66716B") },
                },
            },
        };
        card.SetAppThemeColor(Border.BackgroundColorProperty, Colors.White, Color.FromArgb("#1A231F"));
        return card;
    }
}
