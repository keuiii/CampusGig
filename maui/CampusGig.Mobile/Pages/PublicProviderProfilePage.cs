using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using CampusGig.Mobile.Controls;
using Microsoft.Maui.Controls.Shapes;
using Microsoft.Maui.Layouts;

namespace CampusGig.Mobile.Pages;

public sealed class PublicProviderProfilePage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly RealtimeService realtime;
    private readonly SessionService session;
    private readonly string providerId;
    private readonly VerticalStackLayout content = new()
    {
        Padding = new Thickness(20, 7, 20, 28),
        Spacing = 12,
        MaximumWidthRequest = 680,
        HorizontalOptions = LayoutOptions.Fill,
    };
    private readonly VerticalStackLayout reviewsContent = new() { Spacing = 10 };
    private readonly Label reviewsPageLabel = Muted("", 9, true);
    private readonly Button previousReviews = ReviewPageButton("Previous");
    private readonly Button nextReviews = ReviewPageButton("Next");
    private int reviewPage = 1;
    private bool hasLoadedProfile;
    private bool refreshRunning;
    private bool refreshPending;
    private bool realtimeHandlerAttached;
    private bool openingInquiry;

    public PublicProviderProfilePage(
        CampusGigApi api,
        RealtimeService realtime,
        SessionService session,
        string providerId)
    {
        this.api = api;
        this.realtime = realtime;
        this.session = session;
        this.providerId = providerId;
        Title = "Provider profile";
        NavigationPage.SetHasNavigationBar(this, false);
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F7FAF8"), Color.FromArgb("#111713"));
        Content = new ScrollView { Content = content };
        previousReviews.Clicked += async (_, _) =>
        {
            if (reviewPage <= 1) return;
            reviewPage--;
            await LoadReviewsAsync();
        };
        nextReviews.Clicked += async (_, _) =>
        {
            reviewPage++;
            await LoadReviewsAsync();
        };
        RenderLoading();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (!realtimeHandlerAttached)
        {
            realtime.ProviderStatsChanged += OnProviderStatsChanged;
            realtime.ReconciliationRequired += OnRealtimeReconciliationRequired;
            realtimeHandlerAttached = true;
        }
        try { await realtime.SubscribeProviderAsync(providerId); }
        catch (Exception exception) { System.Diagnostics.Debug.WriteLine(exception); }
        await RefreshProfileAsync(!hasLoadedProfile);
    }

    protected override void OnDisappearing()
    {
        if (realtimeHandlerAttached)
        {
            realtime.ProviderStatsChanged -= OnProviderStatsChanged;
            realtime.ReconciliationRequired -= OnRealtimeReconciliationRequired;
            realtimeHandlerAttached = false;
        }
        _ = realtime.UnsubscribeProviderAsync(providerId);
        base.OnDisappearing();
    }

    private void OnProviderStatsChanged(string changedProviderId)
    {
        if (changedProviderId == providerId) _ = RefreshProfileAsync(false);
    }

    private void OnRealtimeReconciliationRequired() => _ = RefreshProfileAsync(false);

    private async Task RefreshProfileAsync(bool showFailure)
    {
        if (refreshRunning)
        {
            refreshPending = true;
            return;
        }
        refreshRunning = true;
        try
        {
            do
            {
                refreshPending = false;
                await LoadAsync(showFailure);
                showFailure = false;
            }
            while (refreshPending);
        }
        finally { refreshRunning = false; }
    }

    private async Task LoadAsync(bool showFailure)
    {
        try
        {
            var result = await api.GetAsync<ApiResult<PublicProviderProfile>>($"providers/{providerId}/public");
            PrepareUrls(result.Data);
            Render(result.Data);
            await LoadReviewsAsync();
            hasLoadedProfile = true;
        }
        catch (Exception exception)
        {
            if (!showFailure)
            {
                System.Diagnostics.Debug.WriteLine(exception);
                return;
            }
            content.Children.Clear();
            content.Children.Add(BackButton());
            content.Children.Add(Card(new VerticalStackLayout
            {
                Padding = new Thickness(8, 24),
                Spacing = 8,
                HorizontalOptions = LayoutOptions.Center,
                Children =
                {
                    new Label { Text = "!", FontSize = 30, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#B34A42"), HorizontalTextAlignment = TextAlignment.Center },
                    new Label { Text = "Profile unavailable", FontSize = 20, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center },
                    Muted(exception.Message, 11, true),
                },
            }, 18));
        }
    }

    private void PrepareUrls(PublicProviderProfile profile)
    {
        profile.AvatarUrl = profile.HasAvatar
            ? $"{api.BaseUrl}/profile/avatar/{profile.Id}?v={profile.AvatarVersion}"
            : null;
        foreach (var service in profile.Services)
        {
            service.CoverImageUrl = service.CoverMediaId is null
                ? null
                : $"{api.BaseUrl}/services/{service.Id}/media/{service.CoverMediaId}";
            service.ProviderAvatarUrl = profile.AvatarUrl;
        }
    }

    private void RenderLoading()
    {
        content.Children.Clear();
        content.Children.Add(BackButton());
        var loading = new VerticalStackLayout
        {
            Spacing = 12,
            Children =
            {
                new SkeletonCard { Kind = SkeletonCardKind.Profile },
                new SkeletonCard { Kind = SkeletonCardKind.Listing },
            },
        };
        SemanticProperties.SetDescription(loading, "Loading provider profile");
        content.Children.Add(loading);
    }

    private void Render(PublicProviderProfile profile)
    {
        content.Children.Clear();
        content.Children.Add(BackButton());
        var identity = new Grid { IsClippedToBounds = true };
        identity.Add(new Ellipse
        {
            WidthRequest = 72,
            HeightRequest = 72,
            HorizontalOptions = LayoutOptions.End,
            VerticalOptions = LayoutOptions.Start,
            TranslationX = 28,
            TranslationY = -28,
            Fill = Color.FromArgb("#E4EFC0"),
            InputTransparent = true,
        });
        identity.Add(CreateIdentity(profile));
        if (session.User?.Id != profile.Id)
            identity.Add(CreateMessageProviderButton(profile));
        content.Children.Add(Card(identity, 18));

        var stats = new Grid
        {
            ColumnDefinitions =
            [
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Star),
            ],
            ColumnSpacing = 8,
        };
        stats.Add(Stat(profile.Rating.ToString("0.0"), "RATING"));
        stats.Add(Stat(profile.ReviewCount.ToString(), "REVIEWS"), 1);
        stats.Add(Stat(profile.CompletedOrders.ToString(), "COMPLETED"), 2);
        content.Children.Add(stats);

        var firstName = profile.DisplayName.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "this provider";
        var about = new VerticalStackLayout
        {
            Spacing = 8,
            Children =
            {
                Eyebrow("ABOUT"),
                new Label { Text = $"Meet {firstName}", FontSize = 19, FontAttributes = FontAttributes.Bold },
                Muted(profile.Bio, 12),
            },
        };
        if (profile.Skills.Count > 0)
        {
            about.Children.Add(new Label { Text = "Skills", Margin = new Thickness(0, 8, 0, 0), FontSize = 12, FontAttributes = FontAttributes.Bold });
            var skills = new FlexLayout { Direction = FlexDirection.Row, Wrap = FlexWrap.Wrap };
            foreach (var skill in profile.Skills)
                skills.Children.Add(new Border
                {
                    Margin = new Thickness(0, 0, 7, 7),
                    Padding = new Thickness(10, 6),
                    StrokeThickness = 0,
                    StrokeShape = new RoundRectangle { CornerRadius = 9 },
                    BackgroundColor = Color.FromArgb("#E5F3EC"),
                    MaximumWidthRequest = 260,
                    Content = new Label { Text = skill, FontSize = 10, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F6B4F"), LineBreakMode = LineBreakMode.CharacterWrap },
                });
            about.Children.Add(skills);
        }
        about.Children.Add(Muted($"{profile.School.ShortName} · {profile.School.City}  •  Member since {profile.MemberSince:MMMM yyyy}", 10));
        AddPublicLinks(about, profile.SocialLinks);
        content.Children.Add(Card(about, 16));

        content.Children.Add(Eyebrow("PUBLISHED SERVICES"));
        if (profile.Services.Count == 0)
            content.Children.Add(Card(Muted("No published services yet.", 11, true), 20));
        else
            foreach (var service in profile.Services)
                content.Children.Add(ServiceCard(profile, service));

        var reviews = new VerticalStackLayout
        {
            Spacing = 10,
            Children =
            {
                Eyebrow("VERIFIED REVIEWS"),
                new Label { Text = "Client feedback", FontSize = 19, FontAttributes = FontAttributes.Bold },
                reviewsContent,
                new HorizontalStackLayout
                {
                    Spacing = 10,
                    HorizontalOptions = LayoutOptions.Center,
                    Children = { previousReviews, reviewsPageLabel, nextReviews },
                },
            },
        };
        content.Children.Add(Card(reviews, 16));
    }

    private ImageButton CreateMessageProviderButton(PublicProviderProfile profile)
    {
        var button = new ImageButton
        {
            AutomationId = "MessageProviderButton",
            Source = "tab_messages.svg",
            WidthRequest = 46,
            HeightRequest = 46,
            MinimumWidthRequest = 46,
            MinimumHeightRequest = 46,
            CornerRadius = 23,
            Padding = new Thickness(12),
            BackgroundColor = Color.FromArgb("#E5F3EC"),
            Aspect = Aspect.AspectFit,
            HorizontalOptions = LayoutOptions.End,
            VerticalOptions = LayoutOptions.Start,
            ZIndex = 1,
        };
        SemanticProperties.SetDescription(button, "Message provider");
        SemanticProperties.SetHint(button, "Opens a private CampusGig conversation");
        ToolTipProperties.SetText(button, "Message provider");
        button.Clicked += async (_, _) => await OpenProviderInquiryAsync(profile, button);
        return button;
    }

    private async Task OpenProviderInquiryAsync(
        PublicProviderProfile profile,
        ImageButton button)
    {
        if (openingInquiry) return;
        if (session.User is null)
        {
            await ((App)Application.Current!).RequireAuthenticationAsync(
                this,
                GuestProtectedAction.MessageProvider,
                providerId: profile.Id);
            return;
        }

        openingInquiry = true;
        button.IsEnabled = false;
        button.Opacity = 0.55;
        try
        {
            var result = await api.PostAsync<ApiResult<ConversationItem>>(
                "conversations/inquiries",
                new { providerId = profile.Id });
            await Navigation.PushModalAsync(
                new ConversationPage(api, result.Data, realtime: realtime),
                animated: false);
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(
                this,
                "Conversation unavailable",
                exception.Message,
                "Close");
        }
        finally
        {
            openingInquiry = false;
            button.IsEnabled = true;
            button.Opacity = 1;
        }
    }

    private static void AddPublicLinks(VerticalStackLayout about, ProviderSocialLinks links)
    {
        var available = new (string Label, string Icon, string? Url)[]
        {
            ("Instagram", "social_instagram.svg", links.Instagram),
            ("LinkedIn", "social_linkedin.svg", links.Linkedin),
            ("X", "social_x.svg", links.X),
            ("Portfolio", "social_portfolio.svg", links.Portfolio),
        }.Where(item => ProviderSocialLinkRules.CanOpen(item.Url)).ToArray();
        if (available.Length == 0) return;

        about.Children.Add(new Label
        {
            Text = "Contact and portfolio",
            Margin = new Thickness(0, 8, 0, 0),
            FontSize = 12,
            FontAttributes = FontAttributes.Bold,
        });
        var linkRow = new FlexLayout { Direction = FlexDirection.Row, Wrap = FlexWrap.Wrap };
        foreach (var item in available)
        {
            var button = new ImageButton
            {
                Source = item.Icon,
                AutomationId = $"Provider{item.Label}Link",
                Margin = new Thickness(0, 0, 7, 7),
                Padding = new Thickness(11),
                WidthRequest = 44,
                HeightRequest = 44,
                CornerRadius = 12,
                BackgroundColor = Color.FromArgb("#E5F3EC"),
                Aspect = Aspect.AspectFit,
            };
            SemanticProperties.SetDescription(button, item.Label);
            SemanticProperties.SetHint(button, $"Open {item.Label} profile in your browser");
            ToolTipProperties.SetText(button, item.Label);
            var url = item.Url!;
            button.Clicked += async (_, _) => await Launcher.Default.OpenAsync(url);
            linkRow.Children.Add(button);
        }
        about.Children.Add(linkRow);
        about.Children.Add(Muted(
            "External conversations and payments are not protected by CampusGig. Keep bookings, payment, and delivery in the app.",
            9));
    }

    private async Task LoadReviewsAsync()
    {
        previousReviews.IsEnabled = false;
        nextReviews.IsEnabled = false;
        var isInitialLoad = reviewsContent.Children.Count == 0;
        if (isInitialLoad)
        {
            reviewsContent.Children.Add(new SkeletonCard { Kind = SkeletonCardKind.Review });
            reviewsContent.Children.Add(new SkeletonCard { Kind = SkeletonCardKind.Review });
            SemanticProperties.SetDescription(reviewsContent, "Loading provider reviews");
        }
        else
        {
            reviewsPageLabel.Text = "Loading reviews…";
        }
        try
        {
            var response = await api.GetAsync<PublicProviderReviews>($"providers/{providerId}/reviews?page={reviewPage}&pageSize=5");
            RenderReviews(response);
        }
        catch (Exception exception)
        {
            if (isInitialLoad)
            {
                reviewsContent.Children.Clear();
                reviewsContent.Children.Add(Muted(exception.Message, 11, true));
                reviewsPageLabel.Text = "";
            }
            else
            {
                reviewsPageLabel.Text = "Reviews could not be refreshed";
            }
        }
    }

    private void RenderReviews(PublicProviderReviews response)
    {
        reviewsContent.Children.Clear();
        if (response.Summary.Total > 0)
        {
            reviewsContent.Children.Add(new Label
            {
                Text = $"{response.Summary.Average:0.0}  {Stars((int)Math.Round(response.Summary.Average))}",
                FontSize = 22,
                FontAttributes = FontAttributes.Bold,
                TextColor = Color.FromArgb("#D18E13"),
                HorizontalTextAlignment = TextAlignment.Center,
            });
            reviewsContent.Children.Add(Muted($"{response.Summary.Total} verified review{(response.Summary.Total == 1 ? "" : "s")}", 10, true));
            foreach (var item in response.Summary.Distribution)
            {
                var row = new Grid
                {
                    ColumnDefinitions =
                    [
                        new ColumnDefinition(new GridLength(38)),
                        new ColumnDefinition(GridLength.Star),
                        new ColumnDefinition(new GridLength(26)),
                    ],
                    ColumnSpacing = 8,
                };
                row.Add(Muted($"{item.Rating} ★", 9));
                row.Add(new ProgressBar
                {
                    Progress = response.Summary.Total == 0 ? 0 : item.Count / (double)response.Summary.Total,
                    ProgressColor = Color.FromArgb("#D18E13"),
                    VerticalOptions = LayoutOptions.Center,
                }, 1);
                row.Add(Muted(item.Count.ToString(), 9), 2);
                reviewsContent.Children.Add(row);
            }
        }

        if (response.Data.Count == 0)
        {
            reviewsContent.Children.Add(Card(new VerticalStackLayout
            {
                Spacing = 4,
                Children =
                {
                    new Label { Text = "No reviews yet", FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center },
                    Muted("Verified feedback appears after completed orders.", 10, true),
                },
            }, 16));
        }
        else
        {
            foreach (var review in response.Data)
            {
                var reviewHeader = new Grid
                {
                    ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)],
                    ColumnSpacing = 10,
                };
                reviewHeader.Add(new VerticalStackLayout
                {
                    Spacing = 1,
                    Children =
                    {
                        new Label { Text = review.ReviewerLabel, FontSize = 12, FontAttributes = FontAttributes.Bold, LineBreakMode = LineBreakMode.TailTruncation },
                        Muted(review.ServiceTitle, 9),
                    },
                });
                reviewHeader.Add(new Label
                {
                    Text = review.CreatedAt.ToString("MMM d, yyyy"),
                    FontSize = 9,
                    TextColor = Color.FromArgb("#78827D"),
                    HorizontalOptions = LayoutOptions.End,
                }, 1);
                var cardContent = new VerticalStackLayout
                {
                    Spacing = 7,
                    Children =
                    {
                        reviewHeader,
                        new Label { Text = Stars(review.OverallRating), FontSize = 12, TextColor = Color.FromArgb("#D18E13") },
                    },
                };
                if (!string.IsNullOrWhiteSpace(review.Comment))
                    cardContent.Children.Add(Muted(review.Comment, 11));
                reviewsContent.Children.Add(Card(cardContent, 14));
            }
        }

        reviewPage = Math.Clamp(response.Pagination.Page, 1, response.Pagination.TotalPages);
        reviewsPageLabel.Text = $"Page {reviewPage} of {response.Pagination.TotalPages}";
        previousReviews.IsEnabled = reviewPage > 1;
        nextReviews.IsEnabled = reviewPage < response.Pagination.TotalPages;
    }

    private static string Stars(int rating) => new('★', Math.Clamp(rating, 0, 5));

    private static Button ReviewPageButton(string text) => new()
    {
        Text = text,
        BackgroundColor = Colors.Transparent,
        TextColor = Color.FromArgb("#0F6B4F"),
        FontSize = 10,
        FontAttributes = FontAttributes.Bold,
        HeightRequest = 42,
        Padding = new Thickness(10, 0),
    };

    private static View CreateIdentity(PublicProviderProfile profile)
    {
        var avatar = new Border
        {
            WidthRequest = 76,
            HeightRequest = 76,
            StrokeThickness = 0,
            StrokeShape = new RoundRectangle { CornerRadius = 46 },
            BackgroundColor = Color.FromArgb("#E1EEE7"),
            Content = new Grid
            {
                Children =
                {
                    new Image { Source = profile.AvatarUrl, Aspect = Aspect.AspectFill },
                    new Label
                    {
                        Text = profile.Initials,
                        IsVisible = string.IsNullOrWhiteSpace(profile.AvatarUrl),
                        FontSize = 25,
                        FontAttributes = FontAttributes.Bold,
                        TextColor = Color.FromArgb("#0F6B4F"),
                        HorizontalTextAlignment = TextAlignment.Center,
                        VerticalTextAlignment = TextAlignment.Center,
                    },
                },
            },
            HorizontalOptions = LayoutOptions.Center,
        };
        return new VerticalStackLayout
        {
            Spacing = 6,
            Children =
            {
                avatar,
                new Label { Text = profile.DisplayName, FontSize = 23, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center, LineBreakMode = LineBreakMode.WordWrap },
                new Label { Text = profile.Verified ? "✓  Verified student provider" : "Student provider", FontSize = 10, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F8060"), HorizontalTextAlignment = TextAlignment.Center },
                new Label { Text = profile.Headline, FontSize = 14, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center, LineBreakMode = LineBreakMode.CharacterWrap },
                Muted($"{profile.Program ?? "Student"}  ·  {profile.School.Name}", 10, true),
                new Label
                {
                    Text = profile.IsAvailable ? "●  Available for new projects" : "●  Not accepting requests",
                    FontSize = 10,
                    FontAttributes = FontAttributes.Bold,
                    TextColor = profile.IsAvailable ? Color.FromArgb("#08734F") : Color.FromArgb("#78827D"),
                    HorizontalTextAlignment = TextAlignment.Center,
                },
            },
        };
    }

    private View ServiceCard(PublicProviderProfile profile, ServiceItem service)
    {
        var details = new VerticalStackLayout { Spacing = 7 };
        if (!string.IsNullOrWhiteSpace(service.CoverImageUrl))
            details.Children.Add(new Image { Source = service.CoverImageUrl, HeightRequest = 112, Aspect = Aspect.AspectFill });
        details.Children.Add(Eyebrow(service.Category));
        details.Children.Add(new Label { Text = service.Title, FontSize = 17, FontAttributes = FontAttributes.Bold, LineBreakMode = LineBreakMode.CharacterWrap });
        details.Children.Add(Muted(
            PricingModelRules.IsSinglePriceV2(service.PricingModel)
                ? $"{service.PriceLabel}  ·  {service.V2TermsLabel}"
                : PricingModelRules.IsLegacy(service.PricingModel)
                    ? $"{service.PriceLabel}  ·  {service.Delivery}"
                    : "Unsupported pricing model",
            10));
        var action = new Button
        {
            Text = profile.IsAvailable
                ? PricingModelRules.IsSinglePriceV2(service.PricingModel)
                    ? "View terms"
                    : PricingModelRules.IsLegacy(service.PricingModel)
                        ? "View service"
                        : "Update required"
                : "Currently unavailable",
            IsEnabled = profile.IsAvailable &&
                (PricingModelRules.IsLegacy(service.PricingModel) || PricingModelRules.IsSinglePriceV2(service.PricingModel)),
            BackgroundColor = profile.IsAvailable ? Color.FromArgb("#0F8060") : Color.FromArgb("#DCE3DF"),
            TextColor = profile.IsAvailable ? Colors.White : Color.FromArgb("#6E7873"),
            CornerRadius = 11,
            HeightRequest = 44,
            Padding = new Thickness(17, 0),
            HorizontalOptions = LayoutOptions.Start,
        };
        action.Clicked += async (_, _) =>
        {
            await Navigation.PushAsync(new ServiceBookingPage(api, realtime, session, service));
        };
        details.Children.Add(action);
        return Card(details, 16);
    }

    private Button BackButton()
    {
        var button = new Button
        {
            Text = "< Service",
            BackgroundColor = Colors.Transparent,
            TextColor = Color.FromArgb("#0F6B4F"),
            FontAttributes = FontAttributes.Bold,
            Padding = new Thickness(0, 8),
            HorizontalOptions = LayoutOptions.Start,
        };
        button.Clicked += async (_, _) => await Navigation.PopAsync();
        return button;
    }

    private static Border Card(View view, double padding)
    {
        var border = new Border
        {
            Padding = padding,
            StrokeShape = new RoundRectangle { CornerRadius = 18 },
            Content = view,
        };
        border.SetAppThemeColor(Border.StrokeProperty, Color.FromArgb("#DDE3DF"), Color.FromArgb("#385046"));
        border.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#F4F3EC"), Color.FromArgb("#1C2520"));
        return border;
    }

    private static View Stat(string value, string label) => Card(new VerticalStackLayout
    {
        Spacing = 2,
        Children =
        {
            new Label { Text = value, FontSize = 18, FontAttributes = FontAttributes.Bold, HorizontalTextAlignment = TextAlignment.Center },
            Muted(label, 8, true),
        },
    }, 12);

    private static Label Eyebrow(string text) => new()
    {
        Text = text,
        FontSize = 9,
        CharacterSpacing = 1.3,
        FontAttributes = FontAttributes.Bold,
        TextColor = Color.FromArgb("#0F6B4F"),
    };

    private static Label Muted(string text, double size, bool centered = false)
    {
        var label = new Label
        {
            Text = text,
            FontSize = size,
            LineHeight = 1.35,
            LineBreakMode = LineBreakMode.WordWrap,
            HorizontalTextAlignment = centered ? TextAlignment.Center : TextAlignment.Start,
        };
        label.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#66716B"), Color.FromArgb("#AAB6AF"));
        return label;
    }
}
