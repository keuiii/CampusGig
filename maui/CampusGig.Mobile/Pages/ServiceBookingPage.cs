using CampusGig.Mobile.Controls;
using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using Microsoft.Maui.Controls.Shapes;
using System.Globalization;

namespace CampusGig.Mobile.Pages;

public sealed class ServiceBookingPage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly RealtimeService realtime;
    private readonly SessionService session;
    private readonly ServiceItem service;
    private string? submissionFingerprint;
    private string? submissionRequestId;
    private readonly VerticalStackLayout packageList = new() { Spacing = 10 };
    private readonly VerticalStackLayout deliveryOptionList = new() { Spacing = 10 };
    private readonly VerticalStackLayout quoteBreakdown = new() { Spacing = 0 };
    private readonly Editor requirements = new()
    {
        AutomationId = "BookingRequirements",
        Placeholder = "Describe what you need, including style, dimensions, deadline, and references…",
        MaxLength = 3000,
        HeightRequest = 112,
        AutoSize = EditorAutoSizeOption.TextChanges,
    };
    private readonly Label requirementsCount = MutedLabel();
    private readonly DatePicker requestedDeliveryDate = new()
    {
        Format = "MMM d, yyyy",
        Opacity = 0.01,
        MinimumHeightRequest = 74,
        HorizontalOptions = LayoutOptions.Fill,
        VerticalOptions = LayoutOptions.Fill,
    };
    private readonly Label deliveryDateNote = MutedLabel();
    private readonly Label deliveryDateValue = new() { FontSize = 15, FontAttributes = FontAttributes.Bold };
    private readonly Label deliveryDateDay = new()
    {
        FontSize = 19,
        FontAttributes = FontAttributes.Bold,
        TextColor = Colors.White,
        HorizontalTextAlignment = TextAlignment.Center,
    };
    private readonly Label deliveryDateMonth = new()
    {
        FontSize = 8,
        FontAttributes = FontAttributes.Bold,
        CharacterSpacing = 1,
        TextColor = Color.FromArgb("#DDF3E9"),
        HorizontalTextAlignment = TextAlignment.Center,
    };
    private readonly Label summaryPrice = new() { FontSize = 20, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F6B4F") };
    private readonly BusyButton submit = new()
    {
        AutomationId = "BookingSubmit",
        Text = "Send service request",
        BusyText = "Sending request",
        FillColor = Color.FromArgb("#0F8060"),
        TextColor = Colors.White,
        WidthRequest = UiInteractionRules.CompactActionWidth,
        HeightRequest = 46,
        HorizontalOptions = LayoutOptions.Center,
    };
    private ServicePackage? selectedPackage;
    private MarketplaceQuote? quote;
    private string selectedDeliveryOption = "NORMAL";
    private bool quoteLoading;

    public ServiceBookingPage(
        CampusGigApi api,
        RealtimeService realtime,
        SessionService session,
        ServiceItem service,
        string? selectedPackageId = null)
    {
        NavigationPage.SetHasNavigationBar(this, false);
        this.api = api;
        this.realtime = realtime;
        this.session = session;
        this.service = service;
        selectedPackage = service.Packages.FirstOrDefault(package => package.Id == selectedPackageId)
            ?? service.Packages.FirstOrDefault();
        Title = "Service request";
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F7FAF8"), Color.FromArgb("#111713"));

        var close = new Button
        {
            Text = "< Discover",
            BackgroundColor = Colors.Transparent,
            TextColor = Color.FromArgb("#0F6B4F"),
            HorizontalOptions = LayoutOptions.Start,
            Padding = new Thickness(0, 8),
            FontAttributes = FontAttributes.Bold,
        };
        close.Clicked += async (_, _) => await CloseAsync();
        requirements.TextChanged += (_, _) =>
        {
            if (PricingModelRules.IsSinglePriceV2(service.PricingModel))
                RenderV2Summary();
            else
                RenderSummary();
        };
        requirements.Completed += (_, _) => requirements.Unfocus();
        requestedDeliveryDate.DateSelected += (_, _) =>
        {
            requirements.Unfocus();
            RenderSummary();
        };
        submit.Clicked += SubmitAsync;

        var content = new VerticalStackLayout
        {
            Padding = new Thickness(20, 7, 20, 28),
            Spacing = 11,
            MaximumWidthRequest = 620,
            HorizontalOptions = LayoutOptions.Fill,
        };
        content.Children.Add(close);
        content.Children.Add(Eyebrow(service.Category));
        content.Children.Add(new Label { AutomationId = "BookingTitle", Text = service.Title, FontSize = 25, FontAttributes = FontAttributes.Bold, LineBreakMode = LineBreakMode.WordWrap });
        content.Children.Add(CreateProviderLink());
        var mediaGallery = CreateMediaGallery();
        if (mediaGallery is not null)
            content.Children.Add(mediaGallery);
        content.Children.Add(new Label { Text = service.Description, FontSize = 13, LineHeight = 1.35, LineBreakMode = LineBreakMode.WordWrap });
        if (!PricingModelRules.IsLegacy(service.PricingModel))
        {
            content.Children.Add(Eyebrow(
                PricingModelRules.IsSinglePriceV2(service.PricingModel)
                    ? "SINGLE-PRICE TERMS"
                    : "UNSUPPORTED PRICING"));
            content.Children.Add(Rounded(new VerticalStackLayout
            {
                Spacing = 7,
                Children =
                {
                    PricingModelRules.IsSinglePriceV2(service.PricingModel)
                        ? CreateFixedPriceHeading()
                        : new Label
                        {
                            Text = "Terms unavailable",
                            FontSize = 20,
                            FontAttributes = FontAttributes.Bold,
                            TextColor = Color.FromArgb("#0F6B4F"),
                        },
                    MutedLabel(
                        PricingModelRules.IsSinglePriceV2(service.PricingModel)
                            ? service.V2TermsLabel
                            : "Update CampusGig to view this listing."),
                },
            }, 15));
            if (!PricingModelRules.IsSinglePriceV2(service.PricingModel))
            {
                submit.Text = "Booking unavailable";
                submit.IsEnabled = false;
                submit.Opacity = 0.45;
                content.Children.Add(submit);
                content.Children.Add(MutedLabel(
                    "No service request or payment can be created for this pricing model.",
                    centered: true));
                Content = new ScrollView { Content = content };
                return;
            }
            content.Children.Add(Eyebrow("CHOOSE DELIVERY"));
            content.Children.Add(deliveryOptionList);
            if (session.User is not null)
            {
                content.Children.Add(Eyebrow("PROJECT REQUIREMENTS"));
                content.Children.Add(Rounded(requirements, 12));
                content.Children.Add(requirementsCount);
                content.Children.Add(Eyebrow("AUTHORITATIVE QUOTE"));
                content.Children.Add(Rounded(quoteBreakdown, 14));
            }
            else
            {
                content.Children.Add(MutedLabel("Sign in to load the authoritative quote and send a request."));
            }
            if (!service.AcceptingOrders)
                content.Children.Add(MutedLabel("This provider is currently at capacity.", centered: true));
            content.Children.Add(submit);
            content.Children.Add(MutedLabel(
                "The exact deadline starts only after CampusGig confirms payment.",
                centered: true));
            Content = new ScrollView { Content = content };
            RenderV2Options();
            RenderV2Summary();
            Loaded += async (_, _) =>
            {
                if (session.User is not null && quote is null)
                    await LoadQuoteAsync();
            };
            return;
        }
        content.Children.Add(Eyebrow("CHOOSE A PACKAGE"));
        content.Children.Add(packageList);
        if (session.User is not null)
        {
            content.Children.Add(Eyebrow("PROJECT REQUIREMENTS"));
            content.Children.Add(Rounded(requirements, 12));
            content.Children.Add(requirementsCount);
            content.Children.Add(Eyebrow("REQUESTED DELIVERY DATE"));
            content.Children.Add(CreateDeliveryDateCard());

            var summary = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 12 };
            summary.Add(new VerticalStackLayout
            {
                Spacing = 2,
                Children = { Eyebrow("TOTAL FOR THIS REQUEST"), MutedLabel("Secure payment is arranged after the provider accepts.") },
            });
            summary.Add(summaryPrice, 1);
            content.Children.Add(Rounded(summary, 14));
        }
        else
        {
            content.Children.Add(Rounded(new VerticalStackLayout
            {
                Spacing = 5,
                Children =
                {
                    new Label
                    {
                        Text = "Ready to work with this provider?",
                        FontSize = 16,
                        FontAttributes = FontAttributes.Bold,
                    },
                    MutedLabel("Sign in or create an account before entering project details and sending a request.", 11),
                },
            }, 15));
        }
        if (!service.AcceptingOrders)
            content.Children.Add(new Label
            {
                Text = "This provider is at capacity. Please check back after they complete current work.",
                FontSize = 11,
                TextColor = Color.FromArgb("#9A6700"),
                HorizontalTextAlignment = TextAlignment.Center,
            });
        content.Children.Add(submit);
        content.Children.Add(MutedLabel(
            session.User is null
                ? "Browsing remains available without an account."
                : "The provider will receive an in-app notification immediately.",
            centered: true));
        Content = new ScrollView { Content = content };
        UpdateDeliveryDateBounds();
        RenderPackages();
        RenderSummary();
    }

    private static Label Eyebrow(string text) => new()
    {
        Text = text,
        FontSize = 9,
        CharacterSpacing = 1.2,
        FontAttributes = FontAttributes.Bold,
        TextColor = Color.FromArgb("#0F6B4F"),
    };

    private View? CreateMediaGallery()
    {
        var slides = new List<ServiceMediaSlide>();
        if (!string.IsNullOrWhiteSpace(service.CoverImageUrl))
            slides.Add(new(service.CoverImageUrl, $"Cover image for {service.Title}"));
        slides.AddRange(service.Portfolio
            .Where(item => item.MimeType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            .Select((item, index) => new ServiceMediaSlide(
                $"{api.BaseUrl}/services/{service.Id}/media/{item.Id}",
                $"Gallery image {index + 1} for {service.Title}")));
        if (slides.Count == 0) return null;

        var indicator = new IndicatorView
        {
            IndicatorColor = Color.FromArgb("#C8D7CF"),
            SelectedIndicatorColor = Color.FromArgb("#0F8060"),
            IndicatorSize = 7,
            HideSingle = true,
            HorizontalOptions = LayoutOptions.Center,
        };
        var carousel = new CarouselView
        {
            AutomationId = "ServiceMediaCarousel",
            ItemsSource = slides,
            HeightRequest = 184,
            Loop = false,
            IsBounceEnabled = true,
            IndicatorView = indicator,
            ItemTemplate = new DataTemplate(() =>
            {
                var image = new Image { Aspect = Aspect.AspectFill };
                image.SetBinding(Image.SourceProperty, nameof(ServiceMediaSlide.Url));
                image.SetBinding(SemanticProperties.DescriptionProperty, nameof(ServiceMediaSlide.Description));
                return Rounded(image, 0, 184);
            }),
        };
        var stack = new VerticalStackLayout { Spacing = 6 };
        stack.Children.Add(carousel);
        stack.Children.Add(indicator);
        if (slides.Count > 1)
            stack.Children.Add(MutedLabel($"Swipe through {slides.Count} service photos", 10, centered: true));
        return stack;
    }

    private View CreateProviderLink()
    {
        var row = new Grid
        {
            AutomationId = "ProviderProfileLink",
            ColumnDefinitions =
            [
                new ColumnDefinition(GridLength.Auto),
                new ColumnDefinition(GridLength.Star),
            ],
            ColumnSpacing = 10,
            Padding = new Thickness(3, 5),
        };
        var avatar = new Border
        {
            WidthRequest = 38,
            HeightRequest = 38,
            StrokeThickness = 0,
            StrokeShape = new RoundRectangle { CornerRadius = 19 },
            BackgroundColor = Color.FromArgb("#E1EEE7"),
            Content = new Grid
            {
                Children =
                {
                    new Image { Source = service.ProviderAvatarUrl, Aspect = Aspect.AspectFill },
                    new Label
                    {
                        Text = service.ProviderInitial,
                        IsVisible = string.IsNullOrWhiteSpace(service.ProviderAvatarUrl),
                        FontSize = 11,
                        FontAttributes = FontAttributes.Bold,
                        TextColor = Color.FromArgb("#0F6B4F"),
                        HorizontalTextAlignment = TextAlignment.Center,
                        VerticalTextAlignment = TextAlignment.Center,
                    },
                },
            },
        };
        row.Add(avatar);
        row.Add(new VerticalStackLayout
        {
            Spacing = 1,
            VerticalOptions = LayoutOptions.Center,
            Children =
            {
                new Label { Text = service.Provider, FontSize = 13, FontAttributes = FontAttributes.Bold },
                MutedLabel($"{service.School}  ·  View public profile", 10),
            },
        }, 1);
        var tap = new TapGestureRecognizer();
        tap.Tapped += async (_, _) =>
        {
            await row.ScaleToAsync(0.985, 60, Easing.CubicOut);
            await row.ScaleToAsync(1, 90, Easing.CubicOut);
            await Navigation.PushAsync(new PublicProviderProfilePage(api, realtime, session, service.ProviderId));
        };
        row.GestureRecognizers.Add(tap);
        return row;
    }

    private static Label MutedLabel(string text = "", double fontSize = 10, bool centered = false)
    {
        var label = new Label { Text = text, FontSize = fontSize, HorizontalTextAlignment = centered ? TextAlignment.Center : TextAlignment.Start };
        label.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#66716B"), Color.FromArgb("#AAB6AF"));
        return label;
    }

    private static Border Rounded(View content, double padding, double height = -1)
    {
        var border = new Border
        {
            Padding = padding,
            HeightRequest = height,
            StrokeShape = new RoundRectangle { CornerRadius = 14 },
            Content = content,
        };
        border.SetAppThemeColor(Border.StrokeProperty, Color.FromArgb("#DDE3DF"), Color.FromArgb("#385046"));
        border.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#FFFFFF"), Color.FromArgb("#1C2520"));
        return border;
    }

    private sealed record ServiceMediaSlide(string Url, string Description);

    private View CreateDeliveryDateCard()
    {
        SemanticProperties.SetDescription(requestedDeliveryDate, "Choose when you want the completed service delivered");

        var dateTile = new Border
        {
            WidthRequest = 52,
            HeightRequest = 52,
            Padding = new Thickness(4, 5),
            StrokeThickness = 0,
            StrokeShape = new RoundRectangle { CornerRadius = 14 },
            BackgroundColor = Color.FromArgb("#0F8060"),
            Content = new VerticalStackLayout
            {
                Spacing = -2,
                VerticalOptions = LayoutOptions.Center,
                Children = { deliveryDateMonth, deliveryDateDay },
            },
        };

        var heading = new Grid
        {
            ColumnDefinitions =
            [
                new ColumnDefinition(GridLength.Auto),
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Auto),
            ],
            ColumnSpacing = 12,
        };
        heading.Add(dateTile);
        heading.Add(new VerticalStackLayout
        {
            Spacing = 2,
            VerticalOptions = LayoutOptions.Center,
            Children =
            {
                MutedLabel("Preferred completion date", 10),
                deliveryDateValue,
            },
        }, 1);
        heading.Add(new Label
        {
            Text = "Change",
            FontSize = 11,
            FontAttributes = FontAttributes.Bold,
            TextColor = Color.FromArgb("#0F8060"),
            VerticalTextAlignment = TextAlignment.Center,
        }, 2);

        var divider = new BoxView { HeightRequest = 1 };
        divider.SetAppThemeColor(BoxView.ColorProperty, Color.FromArgb("#E3EBE6"), Color.FromArgb("#31443B"));
        var noteRow = new HorizontalStackLayout
        {
            Spacing = 7,
            Children =
            {
                new Label
                {
                    Text = "✓",
                    FontSize = 11,
                    FontAttributes = FontAttributes.Bold,
                    TextColor = Color.FromArgb("#0F8060"),
                },
                deliveryDateNote,
            },
        };

        var visibleContent = new VerticalStackLayout
        {
            Spacing = 11,
            Children = { heading, divider, noteRow },
        };
        var interactionLayer = new Grid();
        interactionLayer.Children.Add(visibleContent);
        requestedDeliveryDate.ZIndex = 2;
        interactionLayer.Children.Add(requestedDeliveryDate);

        var card = Rounded(interactionLayer, 14);
        card.StrokeThickness = 1;
        return card;
    }

    private async Task LoadQuoteAsync()
    {
        if (quoteLoading || session.User is null) return;
        quoteLoading = true;
        RenderV2Summary();
        try
        {
            quote = (await api.PostAsync<ApiResult<MarketplaceQuote>>(
                $"services/{service.Id}/quote",
                new { deliveryOption = selectedDeliveryOption })).Data;
            RenderV2Options();
        }
        catch (Exception exception)
        {
            quote = null;
            await AppDialog.AlertAsync(this, "Unable to calculate quote", exception.Message);
        }
        finally
        {
            quoteLoading = false;
            RenderV2Summary();
        }
    }

    private void RenderV2Options()
    {
        deliveryOptionList.Clear();
        foreach (var option in quote?.EligibleDeliveryOptions ?? ["NORMAL"])
        {
            var selected = option == selectedDeliveryOption;
            var optionGrid = new Grid
            {
                ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)],
            };
            optionGrid.Add(new Label { Text = DeliveryOptionLabel(option), FontAttributes = FontAttributes.Bold, FontSize = 13 });
            optionGrid.Add(new Label { Text = selected ? "Selected" : "Choose", FontSize = 11, TextColor = Color.FromArgb("#0F8060") }, 1);
            var card = Rounded(optionGrid, 14);
            card.Stroke = Color.FromArgb(selected ? "#0F8060" : "#DDE3DF");
            card.StrokeThickness = selected ? 2 : 1;
            var tap = new TapGestureRecognizer();
            tap.Tapped += async (_, _) =>
            {
                if (selectedDeliveryOption == option) return;
                selectedDeliveryOption = option;
                await LoadQuoteAsync();
            };
            card.GestureRecognizers.Add(tap);
            deliveryOptionList.Add(card);
        }
    }

    private void RenderV2Summary()
    {
        var requirementsLength = requirements.Text?.Trim().Length ?? 0;
        requirementsCount.Text = $"{requirementsLength}/3000  •  minimum 10 characters";
        quoteBreakdown.Children.Clear();
        if (quoteLoading)
            quoteBreakdown.Children.Add(MutedLabel("Calculating authoritative quote…", 12));
        else if (quote is null)
            quoteBreakdown.Children.Add(MutedLabel("Quote unavailable.", 12));
        else
        {
            quoteBreakdown.Children.Add(QuoteRow("Service price", null, Money(quote.BasePriceCentavos)));
            if (quote.RushSurchargeCentavos > 0)
                quoteBreakdown.Children.Add(QuoteRow(
                    DeliveryOptionLabel(quote.DeliveryOption),
                    $"{BasisPointsPercent(quote.RushBasisPoints)} rush surcharge",
                    Money(quote.RushSurchargeCentavos)));
            quoteBreakdown.Children.Add(QuoteRow(
                "Service fee",
                $"{BasisPointsPercent(quote.PlatformFeeBasisPoints)} of service subtotal",
                Money(quote.PlatformFeeCentavos)));
            quoteBreakdown.Children.Add(new BoxView
            {
                HeightRequest = 1,
                Margin = new Thickness(0, 6),
                Color = Color.FromArgb("#DDE3DF"),
            });
            quoteBreakdown.Children.Add(QuoteRow("Total due", null, Money(quote.ClientTotalCentavos), emphasized: true));
        }
        submit.IsEnabled = service.AcceptingOrders && !quoteLoading &&
            (session.User is null || (quote is not null && requirementsLength >= 10));
        submit.Opacity = submit.IsEnabled ? 1 : 0.45;
        submit.Text = session.User is null
            ? "Sign in to request"
            : quoteLoading ? "Calculating quote" : "Review service request";
    }

    private View CreateFixedPriceHeading()
    {
        var lockBadge = new Border
        {
            WidthRequest = 32,
            HeightRequest = 32,
            Padding = 7,
            StrokeThickness = 0,
            StrokeShape = new RoundRectangle { CornerRadius = 16 },
            BackgroundColor = Color.FromArgb("#E2F1E8"),
            Content = new Microsoft.Maui.Controls.Shapes.Path
            {
                Aspect = Stretch.Uniform,
                Stroke = Color.FromArgb("#087A5A"),
                StrokeThickness = 1.8,
                StrokeLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
                Data = new PathGeometryConverter().ConvertFromInvariantString(
                    "M7,10 L7,7 C7,4.2 9.2,2 12,2 C14.8,2 17,4.2 17,7 L17,10 M5,10 L19,10 L19,21 L5,21 Z") as Geometry
                    ?? throw new InvalidOperationException("The fixed-price lock geometry is invalid."),
            },
        };
        SemanticProperties.SetDescription(lockBadge, "Fixed price");
        return new HorizontalStackLayout
        {
            Spacing = 9,
            Children =
            {
                new Label
                {
                    Text = service.PriceAmountLabel,
                    FontSize = 20,
                    FontAttributes = FontAttributes.Bold,
                    TextColor = Color.FromArgb("#0F6B4F"),
                    VerticalTextAlignment = TextAlignment.Center,
                },
                lockBadge,
            },
        };
    }

    private View QuoteRow(string title, string? detail, string amount, bool emphasized = false)
    {
        var labels = new VerticalStackLayout
        {
            Spacing = 1,
            VerticalOptions = LayoutOptions.Center,
            Children =
            {
                new Label
                {
                    Text = title,
                    FontSize = emphasized ? 13 : 12,
                    FontAttributes = emphasized ? FontAttributes.Bold : FontAttributes.None,
                },
            },
        };
        if (!string.IsNullOrWhiteSpace(detail))
            labels.Children.Add(MutedLabel(detail, 9));
        var row = new Grid
        {
            Padding = new Thickness(0, 5),
            ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)],
            ColumnSpacing = 14,
        };
        row.Add(labels);
        row.Add(new Label
        {
            Text = amount,
            FontSize = emphasized ? 15 : 12,
            FontAttributes = FontAttributes.Bold,
            TextColor = emphasized ? Color.FromArgb("#0F6B4F") : null,
            VerticalTextAlignment = TextAlignment.Center,
        }, 1);
        return row;
    }

    private static string BasisPointsPercent(int basisPoints) => $"{basisPoints / 100m:0.##}%";

    private async Task SubmitV2Async()
    {
        if (session.User is null)
        {
            await ((App)Application.Current!).RequireAuthenticationAsync(
                this,
                GuestProtectedAction.SendServiceRequest,
                service.Id,
                null);
            return;
        }
        if (submit.IsBusy || quote is null || (requirements.Text?.Trim().Length ?? 0) < 10) return;
        var normalizedRequirements = requirements.Text!.Trim();
        var confirmed = await AppDialog.ConfirmAsync(
            this,
            "Send service request?",
            $"{DeliveryOptionLabel(quote.DeliveryOption)} · {Money(quote.ClientTotalCentavos)} total. The exact deadline starts after payment confirmation.",
            "Send request",
            "Review details");
        if (!confirmed) return;
        var fingerprint = string.Join("\n", service.Id, selectedDeliveryOption, normalizedRequirements);
        if (!string.Equals(submissionFingerprint, fingerprint, StringComparison.Ordinal))
        {
            submissionFingerprint = fingerprint;
            submissionRequestId = Guid.NewGuid().ToString();
        }
        submit.IsBusy = true;
        try
        {
            var result = await api.PostAsync<ApiResult<OrderItem>>("orders", new
            {
                clientRequestId = submissionRequestId,
                serviceId = service.Id,
                deliveryOption = selectedDeliveryOption,
                requirements = normalizedRequirements,
            });
            submissionFingerprint = null;
            submissionRequestId = null;
            await AppDialog.AlertAsync(this, "Request sent", $"{result.Data.OrderNumber} was created. {result.Message}");
            await Navigation.PopModalAsync();
            if (MainTabbedPage.Instance is not null)
                await MainTabbedPage.Instance.SelectTabAsync("orders");
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(this, "Request not sent", exception.Message, "Try again");
        }
        finally
        {
            submit.IsBusy = false;
            RenderV2Summary();
        }
    }

    private static string DeliveryOptionLabel(string option) => option switch
    {
        "NORMAL" => "Normal delivery",
        "RUSH_24_HOURS" => "24-hour Rush",
        "RUSH_12_HOURS" => "12-hour Rush",
        "RUSH_6_HOURS" => "6-hour Rush",
        "RUSH_3_HOURS" => "3-hour Rush",
        _ => "Unsupported delivery",
    };

    private static string Money(int centavos) => $"₱{centavos / 100m:N2}";

    private void RenderPackages()
    {
        packageList.Children.Clear();
        foreach (var package in service.Packages)
        {
            var selected = package.Id == selectedPackage?.Id;
            var heading = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)] };
            heading.Add(new VerticalStackLayout
            {
                Spacing = 2,
                Children = { Eyebrow(package.Tier), new Label { Text = package.Name, FontSize = 15, FontAttributes = FontAttributes.Bold, LineBreakMode = LineBreakMode.WordWrap } },
            });
            heading.Add(new Label
            {
                Text = $"₱{package.PriceCentavos / 100m:N0}",
                FontSize = 16,
                FontAttributes = FontAttributes.Bold,
                TextColor = Color.FromArgb("#0F6B4F"),
            }, 1);
            var card = Rounded(new VerticalStackLayout
            {
                Spacing = 7,
                Children =
                {
                    heading,
                    MutedLabel(package.Description, 11),
                    MutedLabel($"{package.DeliveryDays} day delivery  •  {package.RevisionLimit} revision{(package.RevisionLimit == 1 ? "" : "s")}"),
                },
            }, 14);
            card.SetAppThemeColor(Border.StrokeProperty,
                Color.FromArgb(selected ? "#0F6B4F" : "#DDE3DF"),
                Color.FromArgb(selected ? "#69C59F" : "#385046"));
            card.StrokeThickness = selected ? 2 : 1;
            card.SetAppThemeColor(BackgroundColorProperty,
                Color.FromArgb(selected ? "#EEF6F1" : "#FFFFFF"),
                Color.FromArgb(selected ? "#203B30" : "#1C2520"));
            var tap = new TapGestureRecognizer();
            tap.Tapped += async (_, _) =>
            {
                if (selectedPackage?.Id == package.Id) return;
                await card.ScaleToAsync(0.975, 60, Easing.CubicOut);
                selectedPackage = package;
                UpdateDeliveryDateBounds();
                RenderPackages();
                RenderSummary();
            };
            card.GestureRecognizers.Add(tap);
            packageList.Children.Add(card);
        }
    }

    private void RenderSummary()
    {
        requirementsCount.Text = $"{requirements.Text?.Trim().Length ?? 0}/3000  •  minimum 10 characters";
        summaryPrice.Text = selectedPackage is null ? "—" : $"₱{selectedPackage.PriceCentavos / 100m:N0}";
        if (selectedPackage is not null)
        {
            var earliest = ServiceBookingRules.EarliestDeliveryDate(selectedPackage, DateTime.Today);
            var selectedDate = requestedDeliveryDate.Date ?? earliest;
            deliveryDateValue.Text = selectedDate.ToString("dddd, MMMM d, yyyy", CultureInfo.CurrentCulture);
            deliveryDateDay.Text = selectedDate.Day.ToString(CultureInfo.CurrentCulture);
            deliveryDateMonth.Text = selectedDate.ToString("MMM", CultureInfo.CurrentCulture).ToUpperInvariant();
            deliveryDateNote.Text = $"Available from {earliest:MMM d, yyyy} · up to 1 year ahead";
        }
        if (session.User is null)
        {
            submit.IsEnabled = service.AcceptingOrders;
            submit.Opacity = submit.IsEnabled ? 1 : 0.45;
            submit.Text = service.AcceptingOrders ? "Sign in to request" : "Provider at capacity";
            return;
        }
        submit.IsEnabled = service.AcceptingOrders && ServiceBookingRules.CanSubmit(
            selectedPackage,
            requirements.Text,
            requestedDeliveryDate.Date ?? DateTime.MinValue,
            DateTime.Today);
        submit.Opacity = submit.IsEnabled ? 1 : 0.45;
        submit.Text = service.AcceptingOrders
            ? "Send service request"
            : "Provider at capacity";
    }

    private void UpdateDeliveryDateBounds()
    {
        if (selectedPackage is null) return;
        var today = DateTime.Today;
        var earliest = ServiceBookingRules.EarliestDeliveryDate(selectedPackage, today);
        var latest = today.AddDays(ServiceBookingRules.MaximumAdvanceBookingDays);
        var current = requestedDeliveryDate.Date;
        var selected = current is not null && current.Value.Date >= earliest && current.Value.Date <= latest
            ? current.Value.Date
            : earliest;
        requestedDeliveryDate.MinimumDate = new DateTime(1900, 1, 1);
        requestedDeliveryDate.MaximumDate = latest;
        requestedDeliveryDate.Date = selected;
        requestedDeliveryDate.MinimumDate = earliest;
    }

    private async void SubmitAsync(object? sender, EventArgs e)
    {
        if (PricingModelRules.IsSinglePriceV2(service.PricingModel))
        {
            await SubmitV2Async();
            return;
        }
        if (session.User is null)
        {
            await ((App)Application.Current!).RequireAuthenticationAsync(
                this,
                GuestProtectedAction.SendServiceRequest,
                service.Id,
                selectedPackage?.Id);
            return;
        }
        var deliveryDate = requestedDeliveryDate.Date;
        if (deliveryDate is null) return;
        if (!ServiceBookingRules.CanStartSubmission(
                submit.IsBusy,
                selectedPackage,
                requirements.Text,
                deliveryDate.Value,
                DateTime.Today)) return;

        var confirmed = await AppDialog.ConfirmAsync(
            this,
            "Send service request?",
            $"Send the {selectedPackage!.Name} request to {service.Provider} for ₱{selectedPackage.PriceCentavos / 100m:N0}, requested by {deliveryDate.Value:MMM d, yyyy}?",
            "Send request",
            "Review details");
        if (!confirmed) return;

        submit.IsBusy = true;
        ApiResult<OrderItem>? result = null;
        Exception? failure = null;
        var normalizedRequirements = requirements.Text!.Trim();
        var requestedDate = deliveryDate.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var fingerprint = string.Join("\n", service.Id, selectedPackage!.Id, normalizedRequirements, requestedDate);
        if (!string.Equals(submissionFingerprint, fingerprint, StringComparison.Ordinal))
        {
            submissionFingerprint = fingerprint;
            submissionRequestId = Guid.NewGuid().ToString();
        }
        try
        {
            result = await api.PostAsync<ApiResult<OrderItem>>("orders", new
            {
                clientRequestId = submissionRequestId,
                serviceId = service.Id,
                servicePackageId = selectedPackage!.Id,
                requirements = normalizedRequirements,
                requestedDeliveryDate = requestedDate,
            });
        }
        catch (Exception exception) { failure = exception; }
        finally
        {
            submit.IsBusy = false;
            RenderSummary();
        }

        if (failure is not null)
        {
            await AppDialog.AlertAsync(this, "Request not sent", failure.Message, "Try again");
            return;
        }

        submissionFingerprint = null;
        submissionRequestId = null;
        await AppDialog.AlertAsync(this, "Request sent", $"{result!.Data.OrderNumber} was created. {result.Message}");
        await Navigation.PopModalAsync();
        if (MainTabbedPage.Instance is not null)
            await MainTabbedPage.Instance.SelectTabAsync("orders");
    }

    protected override bool OnBackButtonPressed()
    {
        _ = CloseAsync();
        return true;
    }

    private Task CloseAsync() => Navigation.NavigationStack.Count > 1
        ? Navigation.PopAsync()
        : Navigation.PopModalAsync();
}
