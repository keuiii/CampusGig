namespace CampusGig.Mobile.Services;

public static class CampusTime
{
    private static readonly TimeZoneInfo PhilippineTimeZone = ResolvePhilippineTimeZone();

    public static DateTime ToPhilippineTime(DateTimeOffset value) =>
        TimeZoneInfo.ConvertTime(value, PhilippineTimeZone).DateTime;

    private static TimeZoneInfo ResolvePhilippineTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Asia/Manila");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Singapore Standard Time");
        }
    }
}
