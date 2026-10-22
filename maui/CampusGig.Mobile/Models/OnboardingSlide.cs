namespace CampusGig.Mobile.Models;

public sealed class OnboardingSlide
{
    public required string Number { get; init; }
    public required string Kicker { get; init; }
    public required string Title { get; init; }
    public required string Description { get; init; }
    public required string Highlight { get; init; }
    public required string SupportingText { get; init; }
    public required Color HeroColor { get; init; }
}
