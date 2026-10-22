using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class SplashPage : ContentPage
{
    private readonly object animationLock = new();
    private CancellationTokenSource? animationCancellation;
    private Task? introAnimation;

    public SplashPage()
    {
        InitializeComponent();
        NavigationPage.SetHasNavigationBar(this, false);
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _ = PlayAsync();
    }

    public Task PlayAsync()
    {
        lock (animationLock)
        {
            if (introAnimation is not null) return introAnimation;
            animationCancellation = new CancellationTokenSource();
            introAnimation = RunIntroSafelyAsync(animationCancellation.Token);
            return introAnimation;
        }
    }

    private async Task RunIntroSafelyAsync(CancellationToken cancellationToken)
    {
        try
        {
            await RunIntroAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
    }

    public async Task CompleteAsync()
    {
        await Task.WhenAll(
            SplashContent.FadeToAsync(0, 230, Easing.CubicIn),
            SplashContent.ScaleToAsync(1.035, 250, Easing.CubicIn));
    }

    protected override void OnDisappearing()
    {
        animationCancellation?.Cancel();
        animationCancellation?.Dispose();
        animationCancellation = null;
        base.OnDisappearing();
    }

    private async Task RunIntroAsync(CancellationToken cancellationToken)
    {
        var backgroundTask = Task.WhenAll(
            RevealOrbAsync(TopOrb, 1, 330),
            RevealOrbAsync(BottomOrb, 0.92, 390));

        await Task.WhenAll(
            BrandMark.FadeToAsync(1, 210, Easing.CubicOut),
            BrandMark.TranslateToAsync(0, -8, 330, Easing.CubicOut),
            BrandMark.ScaleToAsync(1.09, 330, Easing.CubicOut));
        await Task.WhenAll(
            BrandMark.TranslateToAsync(0, 0, 220, Easing.BounceOut),
            BrandMark.ScaleToAsync(1, 220, Easing.CubicOut));

        cancellationToken.ThrowIfCancellationRequested();
        await Task.WhenAll(
            backgroundTask,
            AnimateLettersAsync(cancellationToken));

        cancellationToken.ThrowIfCancellationRequested();
        await Task.WhenAll(DissolveParticlesAsync(cancellationToken), RevealMessageAsync());
    }

    private async Task AnimateLettersAsync(CancellationToken cancellationToken)
    {
        var letters = new[] { LetterC, LetterA, LetterM, LetterP, LetterU, LetterS, LetterG, LetterI, LetterG2 };
        await Task.WhenAll(letters.Select((letter, index) => BounceLetterAsync(letter, index, cancellationToken)));
    }

    private static async Task BounceLetterAsync(Label letter, int index, CancellationToken cancellationToken)
    {
        await Task.Delay(StartupPresentationRules.SplashLetterDelay(index), cancellationToken);
        await Task.WhenAll(
            letter.FadeToAsync(1, 125, Easing.CubicOut),
            letter.TranslateToAsync(0, -11, 175, Easing.CubicOut),
            letter.ScaleToAsync(1.11, 175, Easing.CubicOut));
        await Task.WhenAll(
            letter.TranslateToAsync(0, 0, 190, Easing.BounceOut),
            letter.ScaleToAsync(1, 175, Easing.CubicOut));
    }

    private async Task DissolveParticlesAsync(CancellationToken cancellationToken)
    {
        var particles = new[]
        {
            (ParticleOne, -22d, -20d), (ParticleTwo, 24d, -18d),
            (ParticleThree, -25d, 5d), (ParticleFour, 24d, 8d),
            (ParticleFive, -18d, 21d), (ParticleSix, 20d, 23d),
        };
        await Task.WhenAll(particles.Select((particle, index) =>
            DissolveParticleAsync(particle.Item1, particle.Item2, particle.Item3, index, cancellationToken)));
    }

    private static async Task DissolveParticleAsync(VisualElement particle, double offsetX, double offsetY, int index, CancellationToken cancellationToken)
    {
        await Task.Delay(index * 35, cancellationToken);
        particle.Opacity = 0.9;
        var startX = particle.TranslationX;
        var startY = particle.TranslationY;
        await Task.WhenAll(
            particle.ScaleToAsync(1.7, 470, Easing.CubicOut),
            particle.TranslateToAsync(startX + offsetX, startY + offsetY, 470, Easing.CubicOut),
            FadeParticleAsync(particle));
    }

    private static async Task FadeParticleAsync(VisualElement particle)
    {
        await Task.Delay(160);
        await particle.FadeToAsync(0, 310, Easing.CubicIn);
    }

    private async Task RevealMessageAsync()
    {
        await Task.Delay(110);
        await Task.WhenAll(
            MessageGroup.FadeToAsync(1, 300, Easing.CubicOut),
            MessageGroup.TranslateToAsync(0, 0, 330, Easing.CubicOut));
        await Task.WhenAll(
            AccentLine.FadeToAsync(1, 260, Easing.CubicOut),
            AccentLine.TranslateToAsync(0, 0, 300, Easing.CubicOut));
    }

    private static Task RevealOrbAsync(VisualElement orb, double scale, uint duration) =>
        Task.WhenAll(
            orb.FadeToAsync(0.72, duration, Easing.CubicOut),
            orb.ScaleToAsync(scale, duration, Easing.CubicOut));
}
