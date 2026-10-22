using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class OnboardingPage : ContentPage
{
    private readonly IReadOnlyList<OnboardingSlide> slides;
    private bool transitioning;
    private bool entrancePlayed;

    public OnboardingPage()
    {
        InitializeComponent();
        NavigationPage.SetHasNavigationBar(this, false);
        slides =
        [
            new OnboardingSlide
            {
                Number = "01",
                Kicker = "DISCOVER",
                Title = "Find trusted student talent nearby.",
                Description = "Browse practical services from verified students across participating schools in Lipa City.",
                Highlight = "Verified campus providers",
                SupportingText = "Search by skill, category, or preferred school.",
                HeroColor = Color.FromArgb("#075B42"),
            },
            new OnboardingSlide
            {
                Number = "02",
                Kicker = "COLLABORATE",
                Title = "Keep every project clear and organized.",
                Description = "Choose a package and delivery date, message your provider, and follow each milestone in one workspace.",
                Highlight = "One secure project workspace",
                SupportingText = "Messages, files, revisions, and progress stay together.",
                HeroColor = Color.FromArgb("#244B3E"),
            },
            new OnboardingSlide
            {
                Number = "03",
                Kicker = "GROW",
                Title = "Turn student skills into real opportunities.",
                Description = "Request confidently as a client or become a verified provider and build experience through real campus work.",
                Highlight = "Protected orders and reviews",
                SupportingText = "Start as a client, then unlock provider tools after verification.",
                HeroColor = Color.FromArgb("#4B5524"),
            },
        ];
        SlidesCarousel.ItemsSource = slides;
        RenderPosition(0);
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (entrancePlayed) return;
        entrancePlayed = true;
        PageContent.Opacity = 0;
        PageContent.TranslationY = 16;
        await Task.WhenAll(
            PageContent.FadeToAsync(1, 240, Easing.CubicOut),
            PageContent.TranslateToAsync(0, 0, 300, Easing.CubicOut));
    }

    public async Task CompleteAsync()
    {
        if (transitioning) return;
        transitioning = true;
        PrimaryButton.IsEnabled = false;
        await Task.WhenAll(
            PageContent.FadeToAsync(0, 210, Easing.CubicIn),
            PageContent.TranslateToAsync(-28, 0, 230, Easing.CubicIn));
    }

    private async void OnPrimaryClicked(object? sender, EventArgs e)
    {
        if (transitioning) return;
        if (OnboardingPresentationRules.IsLastSlide(SlidesCarousel.Position, slides.Count))
        {
            await FinishAsync(OnboardingPresentationRules.ShouldPlayBrandTransition(skipped: false));
            return;
        }

        PrimaryButton.IsEnabled = false;
        await SlidesCarousel.ScaleToAsync(0.985, 80, Easing.CubicIn);
        SlidesCarousel.Position = OnboardingPresentationRules.NextPosition(SlidesCarousel.Position, slides.Count);
        await SlidesCarousel.ScaleToAsync(1, 150, Easing.CubicOut);
        PrimaryButton.IsEnabled = true;
    }

    private async void OnSkipClicked(object? sender, EventArgs e)
    {
        if (!transitioning)
            await FinishAsync(OnboardingPresentationRules.ShouldPlayBrandTransition(skipped: true));
    }

    private void OnPositionChanged(object? sender, PositionChangedEventArgs e) =>
        RenderPosition(e.CurrentPosition);

    private void RenderPosition(int position)
    {
        var last = OnboardingPresentationRules.IsLastSlide(position, slides.Count);
        PrimaryButton.Text = last ? "Get started" : "Next";
        SemanticProperties.SetDescription(
            PrimaryButton,
            last ? "Finish onboarding and open login" : $"Continue to introduction {position + 2} of {slides.Count}");
    }

    private async Task FinishAsync(bool showBrandTransition)
    {
        if (Application.Current is App app)
            await app.CompleteOnboardingAsync(this, showBrandTransition);
    }
}
