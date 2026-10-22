namespace CampusGig.Mobile.Services;

public sealed class PageActivityGuard
{
    private int generation;
    private int active;

    public void Activate() => Volatile.Write(ref active, 1);

    public void Deactivate()
    {
        Volatile.Write(ref active, 0);
        Interlocked.Increment(ref generation);
    }

    public int Capture() => Volatile.Read(ref generation);

    public bool CanUpdate(int capturedGeneration) =>
        Volatile.Read(ref active) == 1 &&
        Volatile.Read(ref generation) == capturedGeneration;
}
