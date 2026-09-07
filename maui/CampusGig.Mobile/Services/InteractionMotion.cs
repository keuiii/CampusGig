namespace CampusGig.Mobile.Services;

public static class InteractionMotion
{
    public const double ThemeThumbTravel = 32;

    public static double ThemeThumbOffset(bool darkMode) =>
        darkMode ? ThemeThumbTravel : 0;

    public static double AuthTabOffset(
        bool registerMode,
        double availableWidth,
        double leftPadding,
        double rightPadding)
    {
        if (!registerMode || availableWidth <= leftPadding + rightPadding) return 0;
        return (availableWidth - leftPadding - rightPadding) / 2;
    }

    public static double SegmentOffset(bool secondSegment, double segmentWidth, double gap) =>
        secondSegment ? Math.Max(0, segmentWidth) + Math.Max(0, gap) : 0;
}
