namespace CampusGig.Mobile.Services;

public sealed class RealtimeReconciliationGate
{
    private int disconnected;

    public void MarkDisconnected() => Interlocked.Exchange(ref disconnected, 1);

    public bool ConsumeReconnect() => Interlocked.Exchange(ref disconnected, 0) == 1;

    public void Reset() => Interlocked.Exchange(ref disconnected, 0);
}
