using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using Microsoft.Maui.Controls.Shapes;

namespace CampusGig.Mobile.Pages;

public partial class ProviderListingEditorPage : ContentPage
{
    private sealed record DeliveryOption(string Value, string Label);
    private sealed record PricingOption(string Value, string Label);
    private sealed record RushOption(string Value, string Label);

    private sealed class PackageEditor
    {
        public required string Tier { get; init; }
        public required Switch EnabledSwitch { get; init; }
        public required VerticalStackLayout Fields { get; init; }
        public required Entry NameEntry { get; init; }
        public required Editor DescriptionEditor { get; init; }
        public required Entry PriceEntry { get; init; }
        public required Entry DeliveryEntry { get; init; }
        public required Entry RevisionEntry { get; init; }
        public required Grid NumericFieldsGrid { get; init; }
    }

    private static readonly DeliveryOption[] DeliveryOptions =
    [
        new("ONLINE", "Online"),
        new("IN_PERSON", "In person"),
        new("HYBRID", "Hybrid"),
    ];
    private static readonly PricingOption[] PricingOptions =
    [
        new(PricingModels.SinglePriceV2, "One fixed price"),
        new(PricingModels.LegacyPackages, "Legacy packages"),
    ];
    private static readonly RushOption[] RushOptions =
    [
        new("HOURS_24", "24 hours"),
        new("HOURS_12", "12 hours"),
        new("HOURS_6", "6 hours"),
        new("HOURS_3", "3 hours"),
    ];

    private readonly CampusGigApi api;
    private readonly Func<Task> onSaved;
    private readonly List<PackageEditor> packageEditors = [];
    private readonly List<FileResult> selectedPortfolio = [];
    private ProviderListing? listing;
    private FileResult? selectedCover;
    private bool categoriesLoaded;
    private bool coverPreviewLoadAttempted;
    private bool applyingValues;
    private bool isDirty;
    private bool isNavigatingStep;
    private bool isSaving;
    private int currentStep;

    private static readonly string[] StepNames = ["Details", "Fixed price", "Media", "Review"];

    public ProviderListingEditorPage(CampusGigApi api, ProviderListing? listing, Func<Task> onSaved)
    {
        InitializeComponent();
        this.api = api;
        this.listing = listing;
        this.onSaved = onSaved;

        DeliveryPicker.ItemsSource = DeliveryOptions;
        DeliveryPicker.ItemDisplayBinding = new Binding(nameof(DeliveryOption.Label));
        PricingModelPicker.ItemsSource = PricingOptions;
        PricingModelPicker.ItemDisplayBinding = new Binding(nameof(PricingOption.Label));
        FastestRushPicker.ItemsSource = RushOptions;
        FastestRushPicker.ItemDisplayBinding = new Binding(nameof(RushOption.Label));
        foreach (var tier in new[] { "BASIC", "STANDARD", "PREMIUM" })
            AddPackageEditor(tier);
        ApplyListing();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (!categoriesLoaded)
            await LoadCategoriesAsync();
        await LoadCurrentCoverAsync();
    }

    private async Task LoadCategoriesAsync()
    {
        try
        {
            var categories = (await api.GetAsync<ApiList<CategoryItem>>("categories")).Data;
            applyingValues = true;
            CategoryPicker.ItemsSource = categories;
            CategoryPicker.ItemDisplayBinding = new Binding(nameof(CategoryItem.Name));
            CategoryPicker.SelectedItem = listing is null
                ? categories.FirstOrDefault()
                : categories.FirstOrDefault(item => item.Id == listing.Category.Id);
            categoriesLoaded = true;
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Unable to load categories", exception.Message);
        }
        finally
        {
            applyingValues = false;
            UpdatePresentation();
        }
    }

    private void ApplyListing()
    {
        applyingValues = true;
        try
        {
            HeaderTitle.Text = listing is null ? "Create listing" : "Edit listing";
            TitleEntry.Text = listing?.Title ?? "";
            DescriptionEditor.Text = listing?.Description ?? "";
            CampusLocationEntry.Text = listing?.CampusLocation ?? "";
            DeliveryPicker.SelectedIndex = Math.Max(
                0,
                Array.FindIndex(DeliveryOptions, item => item.Value == (listing?.DeliveryMethod ?? "ONLINE")));
            var pricingModel = listing?.PricingModel ?? PricingModels.SinglePriceV2;
            PricingModelPicker.SelectedItem = PricingOptions.FirstOrDefault(item => item.Value == pricingModel);
            PricingModelPicker.IsEnabled = listing is null;
            PricingModelField.IsVisible = listing?.PricingModel == PricingModels.LegacyPackages;
            BasePriceEntry.Text = listing?.BasePriceCentavos is null
                ? ""
                : (listing.BasePriceCentavos.Value / 100m).ToString("0.##");
            NormalDeliveryDaysEntry.Text = listing?.NormalDeliveryMinutes is null
                ? "3"
                : (listing.NormalDeliveryMinutes.Value / 1440).ToString();
            IncludedRevisionsEntry.Text = (listing?.IncludedRevisionLimit ?? 1).ToString();
            AcceptsRushSwitch.IsToggled = listing?.AcceptsRushOrders ?? false;
            FastestRushPicker.SelectedItem = RushOptions.FirstOrDefault(
                item => item.Value == listing?.FastestRushTier) ?? RushOptions[1];
            RejectionPanel.IsVisible = listing?.Status == "REJECTED" && !string.IsNullOrWhiteSpace(listing.RejectionReason);
            RejectionLabel.Text = listing?.RejectionReason ?? "";

            foreach (var editor in packageEditors)
            {
                var saved = listing?.Packages.FirstOrDefault(item => item.Tier == editor.Tier);
                editor.EnabledSwitch.IsToggled = editor.Tier == "BASIC" || saved is not null;
                editor.Fields.IsVisible = editor.EnabledSwitch.IsToggled;
                editor.NameEntry.Text = saved?.Name ?? (editor.Tier == "BASIC" ? "Basic package" : "");
                editor.DescriptionEditor.Text = saved?.Description ?? "";
                editor.PriceEntry.Text = saved is null ? "" : (saved.PriceCentavos / 100m).ToString("0.##");
                editor.DeliveryEntry.Text = saved?.DeliveryDays.ToString() ?? (editor.Tier == "BASIC" ? "3" : "");
                editor.RevisionEntry.Text = saved?.RevisionLimit.ToString() ?? (editor.Tier == "BASIC" ? "1" : "");
            }
            isDirty = selectedCover is not null || selectedPortfolio.Count > 0;
            RefreshExistingMedia();
            UpdatePricingSections();
            ApplyStep(0);
        }
        finally
        {
            applyingValues = false;
            UpdatePresentation();
        }
    }

    private void AddPackageEditor(string tier)
    {
        var enabled = new Switch
        {
            IsToggled = tier == "BASIC",
            IsEnabled = tier != "BASIC",
            OnColor = Color.FromArgb("#0F8060"),
            AutomationId = $"Listing{TierLabel(tier)}Enabled",
        };
        var name = FormEntry("Package name", $"Listing{TierLabel(tier)}Name", Keyboard.Default, 80, ReturnType.Next);
        var description = new Editor
        {
            Placeholder = "Describe exactly what is included",
            AutomationId = $"Listing{TierLabel(tier)}Description",
            MaxLength = 500,
            MinimumHeightRequest = 86,
            AutoSize = EditorAutoSizeOption.TextChanges,
        };
        var price = FormEntry("₱ Price", $"Listing{TierLabel(tier)}Price", Keyboard.Numeric, 12, ReturnType.Next);
        var delivery = FormEntry("Days", $"Listing{TierLabel(tier)}Delivery", Keyboard.Numeric, 2, ReturnType.Next);
        var revisions = FormEntry("Revisions", $"Listing{TierLabel(tier)}Revisions", Keyboard.Numeric, 2, ReturnType.Done);
        var numbers = new Grid
        {
            ColumnDefinitions =
            {
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Star),
            },
            ColumnSpacing = 8,
            RowSpacing = 8,
        };
        numbers.Add(Field("Price", price));
        numbers.Add(Field("Delivery", delivery), 1);
        numbers.Add(Field("Revisions", revisions), 2);

        var fields = new VerticalStackLayout
        {
            IsVisible = tier == "BASIC",
            Spacing = 9,
            Children =
            {
                Field("Package name", name),
                Field("What is included?", description),
                numbers,
            },
        };

        var heading = new Grid
        {
            ColumnDefinitions =
            {
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Auto),
            },
        };
        heading.Add(new VerticalStackLayout
        {
            Spacing = 2,
            Children =
            {
                new Label { Text = $"{TierLabel(tier)} package", FontSize = 15, FontAttributes = FontAttributes.Bold },
                new Label { Text = tier == "BASIC" ? "Required" : "Optional", FontSize = 10, TextColor = Color.FromArgb("#66716B") },
            },
        });
        heading.Add(enabled, 1);

        var packageEditor = new PackageEditor
        {
            Tier = tier,
            EnabledSwitch = enabled,
            Fields = fields,
            NameEntry = name,
            DescriptionEditor = description,
            PriceEntry = price,
            DeliveryEntry = delivery,
            RevisionEntry = revisions,
            NumericFieldsGrid = numbers,
        };
        packageEditors.Add(packageEditor);

        enabled.Toggled += (_, _) =>
        {
            fields.IsVisible = enabled.IsToggled;
            OnFormChanged(null, EventArgs.Empty);
        };
        name.TextChanged += OnFormChanged;
        description.TextChanged += OnFormChanged;
        price.TextChanged += OnFormChanged;
        delivery.TextChanged += OnFormChanged;
        revisions.TextChanged += OnFormChanged;

        var card = new Border
        {
            Padding = 16,
            Stroke = Color.FromArgb("#DDE4DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 17 },
            Content = new VerticalStackLayout { Spacing = 12, Children = { heading, fields } },
        };
        card.SetAppThemeColor(Border.BackgroundColorProperty, Colors.White, Color.FromArgb("#1A231F"));
        PackagesStack.Add(card);
    }

    private void OnFormRootSizeChanged(object? sender, EventArgs e)
    {
        if (FormRoot.Width <= 0) return;

        var compact = FormRoot.Width < 390;
        ConfigureTwoFieldGrid(DeliveryLocationGrid, compact);
        ConfigureTwoFieldGrid(MediaActionsGrid, compact);
        foreach (var editor in packageEditors)
            ConfigureNumericFields(editor.NumericFieldsGrid, compact);
        ConfigureNumericFields(SinglePriceFieldsGrid, compact);
    }

    private static void ConfigureTwoFieldGrid(Grid grid, bool compact)
    {
        grid.ColumnDefinitions = compact
            ? [new ColumnDefinition(GridLength.Star)]
            : [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Star)];
        grid.RowDefinitions = compact
            ? [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto)]
            : [new RowDefinition(GridLength.Auto)];

        var second = (View)grid.Children[1];
        Grid.SetColumn(second, compact ? 0 : 1);
        Grid.SetRow(second, compact ? 1 : 0);
    }

    private static void ConfigureNumericFields(Grid grid, bool compact)
    {
        grid.ColumnDefinitions = compact
            ? [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Star)]
            : [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Star)];
        grid.RowDefinitions = compact
            ? [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto)]
            : [new RowDefinition(GridLength.Auto)];

        var price = (View)grid.Children[0];
        var delivery = (View)grid.Children[1];
        var revisions = (View)grid.Children[2];
        Grid.SetColumn(price, 0);
        Grid.SetRow(price, 0);
        Grid.SetColumnSpan(price, compact ? 2 : 1);
        Grid.SetColumn(delivery, compact ? 0 : 1);
        Grid.SetRow(delivery, compact ? 1 : 0);
        Grid.SetColumn(revisions, compact ? 1 : 2);
        Grid.SetRow(revisions, compact ? 1 : 0);
    }

    private static Entry FormEntry(
        string placeholder,
        string automationId,
        Keyboard keyboard,
        int maxLength,
        ReturnType returnType = ReturnType.Default) => new()
    {
        Placeholder = placeholder,
        AutomationId = automationId,
        Keyboard = keyboard,
        MaxLength = maxLength,
        ReturnType = returnType,
    };

    private static VerticalStackLayout Field(string label, View input)
    {
        var frame = new Border
        {
            Padding = new Thickness(10, input is Editor ? 6 : 2),
            Stroke = Color.FromArgb("#DCE5DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 11 },
            Content = input,
        };
        return new VerticalStackLayout
        {
            Spacing = 5,
            Children =
            {
                new Label { Text = label, FontSize = 10, FontAttributes = FontAttributes.Bold },
                frame,
            },
        };
    }

    private void OnFormChanged(object? sender, EventArgs e)
    {
        if (!applyingValues)
            isDirty = true;
        UpdatePresentation();
    }

    private void OnPricingModelChanged(object? sender, EventArgs e)
    {
        UpdatePricingSections();
        OnFormChanged(sender, e);
    }

    private void OnRushChanged(object? sender, ToggledEventArgs e)
    {
        FastestRushGroup.IsVisible = e.Value;
        OnFormChanged(sender, e);
    }

    private void UpdatePricingSections()
    {
        var singlePrice = (PricingModelPicker.SelectedItem as PricingOption)?.Value == PricingModels.SinglePriceV2;
        SinglePriceSection.IsVisible = singlePrice;
        LegacyPackagesSection.IsVisible = !singlePrice;
        FastestRushGroup.IsVisible = singlePrice && AcceptsRushSwitch.IsToggled;
    }

    private void UpdatePresentation()
    {
        var titleLength = TitleEntry.Text?.Trim().Length ?? 0;
        var descriptionLength = DescriptionEditor.Text?.Trim().Length ?? 0;
        TitleCounter.Text = titleLength < ProviderListingEditorRules.TitleMinimumLength
            ? $"{ProviderListingEditorRules.TitleMinimumLength - titleLength} more required  ·  {titleLength}/{ProviderListingEditorRules.TitleMaximumLength}"
            : $"Ready  ·  {titleLength}/{ProviderListingEditorRules.TitleMaximumLength}";
        DescriptionCounter.Text = descriptionLength < ProviderListingEditorRules.DescriptionMinimumLength
            ? $"{ProviderListingEditorRules.DescriptionMinimumLength - descriptionLength} more required  ·  {descriptionLength}/{ProviderListingEditorRules.DescriptionMaximumLength}"
            : $"Ready  ·  {descriptionLength}/{ProviderListingEditorRules.DescriptionMaximumLength}";

        var validation = Validate();
        ValidationHintLabel.Text = validation.IsValid
            ? "Ready to save. Submitting sends this listing to administrator review."
            : validation.Errors.FirstOrDefault() ?? "Complete the required details.";
        SaveDraftButton.IsEnabled = !isSaving && isDirty;
        SubmitButton.IsEnabled = !isSaving && validation.IsValid;
        ReviewTitleLabel.Text = string.IsNullOrWhiteSpace(TitleEntry.Text)
            ? "Untitled service"
            : TitleEntry.Text.Trim();
        ReviewTermsLabel.Text = BuildReviewTerms();
    }

    private string BuildReviewTerms()
    {
        if ((PricingModelPicker.SelectedItem as PricingOption)?.Value != PricingModels.SinglePriceV2)
            return "Existing legacy package listing";
        var price = decimal.TryParse(BasePriceEntry.Text, out var parsedPrice)
            ? $"₱{parsedPrice:N2}"
            : "Price incomplete";
        var days = int.TryParse(NormalDeliveryDaysEntry.Text, out var parsedDays)
            ? $"{parsedDays} day{(parsedDays == 1 ? "" : "s")}"
            : "delivery incomplete";
        var revisions = int.TryParse(IncludedRevisionsEntry.Text, out var parsedRevisions)
            ? $"{parsedRevisions} revision{(parsedRevisions == 1 ? "" : "s")}"
            : "revisions incomplete";
        return $"{price} · {days} · {revisions}";
    }

    private async void OnDetailsNextClicked(object? sender, EventArgs e)
    {
        var error = DetailsError();
        if (error is not null)
        {
            await AppDialog.AlertAsync(this, "Complete service details", error);
            return;
        }
        await NavigateStepAsync(1);
    }

    private async void OnPricingBackClicked(object? sender, EventArgs e) => await NavigateStepAsync(0);

    private async void OnPricingNextClicked(object? sender, EventArgs e)
    {
        var validation = Validate();
        if (!validation.IsValid)
        {
            await AppDialog.AlertAsync(
                this,
                "Complete pricing",
                validation.Errors.FirstOrDefault() ?? "Complete the required pricing terms.");
            return;
        }
        await NavigateStepAsync(2);
    }

    private async void OnMediaBackClicked(object? sender, EventArgs e) => await NavigateStepAsync(1);

    private async void OnMediaNextClicked(object? sender, EventArgs e) => await NavigateStepAsync(3);

    private async void OnReviewBackClicked(object? sender, EventArgs e) => await NavigateStepAsync(2);

    private string? DetailsError()
    {
        if (CategoryPicker.SelectedItem is not CategoryItem) return "Choose a category.";
        var titleLength = TitleEntry.Text?.Trim().Length ?? 0;
        if (titleLength < ProviderListingEditorRules.TitleMinimumLength)
            return $"Add {ProviderListingEditorRules.TitleMinimumLength - titleLength} more characters to the service title.";
        var descriptionLength = DescriptionEditor.Text?.Trim().Length ?? 0;
        if (descriptionLength < ProviderListingEditorRules.DescriptionMinimumLength)
            return $"Add {ProviderListingEditorRules.DescriptionMinimumLength - descriptionLength} more characters to the description.";
        if (DeliveryPicker.SelectedItem is not DeliveryOption) return "Choose a delivery method.";
        return null;
    }

    private async Task NavigateStepAsync(int step)
    {
        if (isNavigatingStep || step < 0 || step >= StepNames.Length || step == currentStep) return;
        isNavigatingStep = true;
        try
        {
            var movingForward = step > currentStep;
            var outgoing = StepView(currentStep);
            await Task.WhenAll(
                outgoing.FadeToAsync(0, 100, Easing.CubicIn),
                outgoing.TranslateToAsync(movingForward ? -18 : 18, 0, 120, Easing.CubicIn));
            outgoing.IsVisible = false;
            outgoing.Opacity = 1;
            outgoing.TranslationX = 0;

            currentStep = step;
            var incoming = StepView(currentStep);
            incoming.IsVisible = true;
            incoming.Opacity = 0;
            incoming.TranslationX = movingForward ? 18 : -18;
            UpdateProgress();
            await FormScroll.ScrollToAsync(0, 0, false);
            await Task.WhenAll(
                incoming.FadeToAsync(1, 180, Easing.CubicOut),
                incoming.TranslateToAsync(0, 0, 200, Easing.CubicOut));
        }
        catch (OperationCanceledException)
        {
            System.Diagnostics.Debug.WriteLine("Listing step animation was cancelled.");
        }
        finally
        {
            isNavigatingStep = false;
        }
    }

    private void ApplyStep(int step)
    {
        currentStep = Math.Clamp(step, 0, StepNames.Length - 1);
        for (var index = 0; index < StepNames.Length; index++)
            StepView(index).IsVisible = index == currentStep;
        UpdateProgress();
    }

    private View StepView(int step) => step switch
    {
        0 => DetailsSection,
        1 => PricingSection,
        2 => MediaSection,
        _ => ReviewSection,
    };

    private void UpdateProgress()
    {
        ProgressStepLabel.Text = $"STEP {currentStep + 1} OF {StepNames.Length}";
        ProgressSectionLabel.Text = currentStep == 1 &&
            (PricingModelPicker.SelectedItem as PricingOption)?.Value == PricingModels.LegacyPackages
                ? "Packages"
                : StepNames[currentStep];
        _ = FormProgress.ProgressTo((currentStep + 1d) / StepNames.Length, 220, Easing.CubicOut);
    }

    private ProviderListingValidationResult Validate()
    {
        var common = new
        {
            CategoryId = (CategoryPicker.SelectedItem as CategoryItem)?.Id,
            Title = TitleEntry.Text,
            Description = DescriptionEditor.Text,
            DeliveryMethod = (DeliveryPicker.SelectedItem as DeliveryOption)?.Value,
            CampusLocation = CampusLocationEntry.Text,
        };
        return (PricingModelPicker.SelectedItem as PricingOption)?.Value == PricingModels.SinglePriceV2
            ? ProviderListingEditorRules.ValidateSinglePrice(
                common.CategoryId,
                common.Title,
                common.Description,
                common.DeliveryMethod,
                common.CampusLocation,
                BasePriceEntry.Text,
                NormalDeliveryDaysEntry.Text,
                IncludedRevisionsEntry.Text,
                AcceptsRushSwitch.IsToggled,
                AcceptsRushSwitch.IsToggled
                    ? (FastestRushPicker.SelectedItem as RushOption)?.Value
                    : null)
            : ProviderListingEditorRules.Validate(
                common.CategoryId,
                common.Title,
                common.Description,
                common.DeliveryMethod,
                common.CampusLocation,
                packageEditors.Select(item => new ProviderListingPackageInput(
                    item.Tier,
                    item.EnabledSwitch.IsToggled,
                    item.NameEntry.Text,
                    item.DescriptionEditor.Text,
                    item.PriceEntry.Text,
                    item.DeliveryEntry.Text,
                    item.RevisionEntry.Text)));
    }

    private async void OnSaveDraftClicked(object? sender, EventArgs e) => await SaveAsync(submit: false);

    private async void OnSubmitClicked(object? sender, EventArgs e)
    {
        var confirmed = await AppDialog.ConfirmAsync(
            this,
            "Submit for review?",
            "You will not be able to edit the listing while an administrator reviews it.",
            "Submit",
            "Keep editing");
        if (confirmed)
            await SaveAsync(submit: true);
    }

    private async Task SaveAsync(bool submit)
    {
        if (isSaving) return;
        var validation = Validate();
        if (!validation.IsValid)
        {
            await AppDialog.AlertAsync(this, "Complete the listing", string.Join(Environment.NewLine, validation.Errors));
            return;
        }
        if (listing is not null && !ProviderListingEditorRules.CanEdit(listing.Status))
        {
            await AppDialog.AlertAsync(this, "Listing cannot be edited", "Only draft or rejected listings can be changed.");
            return;
        }

        isSaving = true;
        SavingIndicator.IsVisible = true;
        SavingIndicator.IsRunning = true;
        UpdatePresentation();
        var draftPersisted = false;
        try
        {
            var pricingModel = ((PricingOption)PricingModelPicker.SelectedItem).Value;
            var payload = new Dictionary<string, object?>
            {
                ["categoryId"] = ((CategoryItem)CategoryPicker.SelectedItem).Id,
                ["title"] = TitleEntry.Text!.Trim(),
                ["description"] = DescriptionEditor.Text!.Trim(),
                ["deliveryMethod"] = ((DeliveryOption)DeliveryPicker.SelectedItem).Value,
                ["campusLocation"] = string.IsNullOrWhiteSpace(CampusLocationEntry.Text) ? null : CampusLocationEntry.Text.Trim(),
                ["pricingModel"] = pricingModel,
            };
            if (pricingModel == PricingModels.SinglePriceV2)
            {
                payload["basePriceCentavos"] = validation.SinglePrice!.BasePriceCentavos;
                payload["normalDeliveryMinutes"] = validation.SinglePrice.NormalDeliveryMinutes;
                payload["includedRevisionLimit"] = validation.SinglePrice.IncludedRevisionLimit;
                payload["acceptsRushOrders"] = validation.SinglePrice.AcceptsRushOrders;
                payload["fastestRushTier"] = validation.SinglePrice.FastestRushTier;
            }
            else
            {
                payload["packages"] = validation.Packages;
            }
            var saved = listing is null
                ? await api.PostAsync<ApiResult<ProviderListing>>("provider/services", payload)
                : await api.PutAsync<ApiResult<ProviderListing>>($"provider/services/{listing.Id}", payload);
            listing = saved.Data;
            draftPersisted = true;

            if (selectedCover is not null || selectedPortfolio.Count > 0)
            {
                var uploads = new List<ApiUpload>();
                if (selectedCover is not null)
                    uploads.Add(ToUpload("cover", selectedCover));
                uploads.AddRange(selectedPortfolio.Select(file => ToUpload("portfolio", file)));
                listing.Media = (await api.PostMultipartAsync<ApiResult<List<ServiceMedia>>>(
                    $"provider/services/{listing.Id}/media",
                    new Dictionary<string, string?>(),
                    uploads)).Data;
                selectedCover = null;
                selectedPortfolio.Clear();
            }

            if (submit)
                await api.PostAsync<ApiResult<ProviderListing>>($"provider/services/{listing.Id}/submit");

            isDirty = false;
            await onSaved();
            await AppDialog.AlertAsync(
                this,
                submit ? "Submitted for review" : "Draft saved",
                submit
                    ? "Your listing is private while an administrator reviews it."
                    : "Your service draft and selected media were saved.");
            await Navigation.PopAsync();
        }
        catch (Exception exception)
        {
            if (draftPersisted)
            {
                isDirty = false;
                await onSaved();
                await AppDialog.AlertAsync(
                    this,
                    "Draft saved with an issue",
                    $"The service details were saved, but the remaining step failed: {exception.Message}");
                ApplyListing();
            }
            else
            {
                await AppDialog.AlertAsync(this, "Unable to save listing", exception.Message);
            }
        }
        finally
        {
            isSaving = false;
            SavingIndicator.IsRunning = false;
            SavingIndicator.IsVisible = false;
            UpdateSelectionLabels();
            UpdatePresentation();
        }
    }

    private async void OnChooseCoverClicked(object? sender, EventArgs e)
    {
        try
        {
            var file = await FilePicker.Default.PickAsync(new PickOptions
            {
                PickerTitle = "Choose a cover image",
                FileTypes = FilePickerFileType.Images,
            });
            if (file is null) return;
            if (!ProviderListingEditorRules.IsSupportedCover(file.FileName))
            {
                await AppDialog.AlertAsync(this, "Unsupported cover", "Choose a JPG, PNG, or WebP image.");
                return;
            }
            if (await ExceedsMediaLimitAsync(file))
            {
                await AppDialog.AlertAsync(this, "Cover is too large", "Choose an image no larger than 8 MB.");
                return;
            }
            selectedCover = file;
            await using (var stream = await file.OpenReadAsync())
            using (var memory = new MemoryStream())
            {
                await stream.CopyToAsync(memory);
                var previewBytes = memory.ToArray();
                CurrentCoverImage.Source = ImageSource.FromStream(() => new MemoryStream(previewBytes));
            }
            CurrentCoverFrame.IsVisible = true;
            isDirty = true;
            UpdateSelectionLabels();
            UpdatePresentation();
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Unable to choose cover", exception.Message);
        }
    }

    private async void OnChoosePortfolioClicked(object? sender, EventArgs e)
    {
        try
        {
            var files = (await FilePicker.Default.PickMultipleAsync(new PickOptions
                {
                    PickerTitle = "Choose up to five gallery images or portfolio PDFs",
                }))
                .Where(file => file is not null)
                .Cast<FileResult>()
                .ToList();
            if (files.Count == 0) return;
            var existingCount = listing?.Media.Count(item => item.Kind == "PORTFOLIO") ?? 0;
            if (existingCount + selectedPortfolio.Count + files.Count > ProviderListingEditorRules.MaximumPortfolioFiles)
            {
                await AppDialog.AlertAsync(this, "Too many files", "A listing can have up to five portfolio files in total.");
                return;
            }
            foreach (var file in files)
            {
                if (!ProviderListingEditorRules.IsSupportedPortfolio(file.FileName))
                {
                    await AppDialog.AlertAsync(this, "Unsupported portfolio file", $"{file.FileName} must be JPG, PNG, WebP, or PDF.");
                    return;
                }
                if (await ExceedsMediaLimitAsync(file))
                {
                    await AppDialog.AlertAsync(this, "Portfolio file is too large", $"{file.FileName} is larger than 8 MB.");
                    return;
                }
            }
            selectedPortfolio.AddRange(files);
            isDirty = true;
            UpdateSelectionLabels();
            UpdatePresentation();
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Unable to choose portfolio files", exception.Message);
        }
    }

    private void RefreshExistingMedia()
    {
        ExistingMediaStack.Clear();
        if (listing?.Media.Count > 0)
        {
            foreach (var media in listing.Media)
            {
                var remove = new Button
                {
                    Text = "Remove",
                    FontSize = 10,
                    Padding = new Thickness(10, 3),
                    CornerRadius = 9,
                    BackgroundColor = Color.FromArgb("#FCE8E5"),
                    TextColor = Color.FromArgb("#A33E36"),
                };
                remove.Clicked += async (_, _) => await RemoveMediaAsync(media, remove);
                var row = new Grid
                {
                    ColumnDefinitions =
                    {
                        new ColumnDefinition(GridLength.Star),
                        new ColumnDefinition(GridLength.Auto),
                    },
                    ColumnSpacing = 8,
                };
                row.Add(new VerticalStackLayout
                {
                    Spacing = 1,
                    Children =
                    {
                        new Label { Text = media.Kind == "COVER" ? "Cover image" : "Portfolio", FontSize = 9, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F8060") },
                        new Label { Text = media.OriginalName, FontSize = 11, LineBreakMode = LineBreakMode.TailTruncation },
                    },
                });
                row.Add(remove, 1);
                ExistingMediaStack.Add(row);
            }
        }
        else
        {
            ExistingMediaStack.Add(new Label
            {
                Text = "No media uploaded yet.",
                FontSize = 11,
                TextColor = Color.FromArgb("#78827D"),
            });
        }
        UpdateSelectionLabels();
    }

    private async Task LoadCurrentCoverAsync()
    {
        if (coverPreviewLoadAttempted || listing is null || selectedCover is not null) return;
        coverPreviewLoadAttempted = true;
        var cover = listing.Media.FirstOrDefault(item =>
            string.Equals(item.Kind, "COVER", StringComparison.OrdinalIgnoreCase));
        if (cover is null) return;
        try
        {
            var path = await api.DownloadAsync(
                $"provider/services/{listing.Id}/media/{cover.Id}",
                cover.OriginalName);
            CurrentCoverImage.Source = ImageSource.FromFile(path);
            CurrentCoverFrame.IsVisible = true;
        }
        catch (Exception exception) when (exception is CampusGigApiException or HttpRequestException or IOException)
        {
            CurrentCoverFrame.IsVisible = false;
            System.Diagnostics.Debug.WriteLine($"Listing editor cover could not be loaded: {exception.Message}");
        }
    }

    private async Task RemoveMediaAsync(ServiceMedia media, Button button)
    {
        if (listing is null || !await AppDialog.ConfirmAsync(
                this,
                "Remove media?",
                $"Remove {media.OriginalName} from this listing?",
                "Remove",
                "Cancel")) return;
        button.IsEnabled = false;
        try
        {
            await api.DeleteAsync<ApiMessage>($"provider/services/{listing.Id}/media/{media.Id}");
            listing.Media.RemoveAll(item => item.Id == media.Id);
            RefreshExistingMedia();
            await onSaved();
        }
        catch (Exception exception)
        {
            button.IsEnabled = true;
            await AppDialog.AlertAsync(this, "Unable to remove media", exception.Message);
        }
    }

    private void UpdateSelectionLabels()
    {
        CoverSelectionLabel.IsVisible = selectedCover is not null;
        CoverSelectionLabel.Text = selectedCover is null ? "" : $"New cover: {selectedCover.FileName}";
        var existingPortfolioCount = listing?.Media.Count(item => item.Kind == "PORTFOLIO") ?? 0;
        var totalPortfolioCount = existingPortfolioCount + selectedPortfolio.Count;
        PortfolioCapacityLabel.Text = $"{totalPortfolioCount} of {ProviderListingEditorRules.MaximumPortfolioFiles} gallery slots used";
        PortfolioSelectionLabel.IsVisible = selectedPortfolio.Count > 0;
        PortfolioSelectionLabel.Text = selectedPortfolio.Count == 0
            ? ""
            : $"{selectedPortfolio.Count} new gallery file{(selectedPortfolio.Count == 1 ? "" : "s")} selected";
    }

    private async void OnBackClicked(object? sender, EventArgs e) => await CloseAsync();

    protected override bool OnBackButtonPressed()
    {
        _ = CloseAsync();
        return true;
    }

    private async Task CloseAsync()
    {
        if (isSaving) return;
        if (isDirty && !await AppDialog.ConfirmAsync(
                this,
                "Discard unsaved changes?",
                "Your listing changes and selected files have not been saved.",
                "Discard",
                "Keep editing")) return;
        await Navigation.PopAsync();
    }

    private static ApiUpload ToUpload(string fieldName, FileResult file) => new(
        fieldName,
        file.FileName,
        ProviderListingEditorRules.MediaContentType(file.FileName),
        file.OpenReadAsync);

    private static async Task<bool> ExceedsMediaLimitAsync(FileResult file)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(file.FullPath) && File.Exists(file.FullPath))
                return new FileInfo(file.FullPath).Length > ProviderListingEditorRules.MaximumMediaBytes;

            await using var stream = await file.OpenReadAsync();
            if (stream.CanSeek)
                return stream.Length > ProviderListingEditorRules.MaximumMediaBytes;

            using var memory = new MemoryStream();
            await stream.CopyToAsync(memory);
            return memory.Length > ProviderListingEditorRules.MaximumMediaBytes;
        }
        catch
        {
            return false;
        }
    }

    private static string TierLabel(string tier) => string.Concat(
        char.ToUpperInvariant(tier[0]),
        tier[1..].ToLowerInvariant());
}
