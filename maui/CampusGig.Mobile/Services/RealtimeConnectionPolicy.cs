namespace CampusGig.Mobile.Services;

public static class RealtimeConnectionPolicy
{
    public static readonly TimeSpan InitialConnectTimeout = TimeSpan.FromSeconds(3);
    public const int ReconnectionAttempts = 4;
    public const int MaximumReconnectionDelayMilliseconds = 3000;
}
