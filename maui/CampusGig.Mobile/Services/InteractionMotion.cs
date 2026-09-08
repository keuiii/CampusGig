namespace CampusGig.Mobile.Services;

public static class InteractionMotion
{
    public const double ThemeThumbTravel = 32;
    public const double AuthFormTravel = 28;
    public const double TabPageTravel = 24;

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

    public static double AuthFormExitOffset(bool movingToRegister) =>
        movingToRegister ? -AuthFormTravel : AuthFormTravel;

    public static double AuthFormEntryOffset(bool movingToRegister) =>
        -AuthFormExitOffset(movingToRegister);

    public static bool CanStartAuthModeTransition(bool sameMode, bool animationRunning) =>
        !sameMode && !animationRunning;

    public static bool IsForwardTabTransition(int currentIndex, int nextIndex) =>
        nextIndex > currentIndex;

    public static double TabExitOffset(bool movingForward) =>
        movingForward ? -TabPageTravel : TabPageTravel;

    public static double TabEntryOffset(bool movingForward) =>
        -TabExitOffset(movingForward);

    public static bool CanStartTabTransition(bool sameRoute, bool routeExists, bool animationRunning) =>
        !sameRoute && routeExists && !animationRunning;

    public static double TabHighlightWidth(double availableWidth, int tabCount, double horizontalInset) =>
        tabCount <= 0 ? 0 : Math.Max(0, availableWidth / tabCount - Math.Max(0, horizontalInset) * 2);

    public static double TabHighlightOffset(int tabIndex, double availableWidth, int tabCount, double horizontalInset)
    {
        if (tabIndex < 0 || tabCount <= 0 || availableWidth <= 0) return 0;
        return tabIndex * (availableWidth / tabCount) + Math.Max(0, horizontalInset);
    }

    public static double TabUnderlineOffset(int tabIndex, double availableWidth, int tabCount, double underlineWidth)
    {
        if (tabIndex < 0 || tabCount <= 0 || availableWidth <= 0) return 0;
        var columnWidth = availableWidth / tabCount;
        return tabIndex * columnWidth + Math.Max(0, (columnWidth - underlineWidth) / 2);
    }
}
