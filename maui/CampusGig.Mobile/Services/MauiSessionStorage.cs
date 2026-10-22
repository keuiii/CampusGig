namespace CampusGig.Mobile.Services;

public sealed class MauiSessionStorage : ISessionStorage
{
    private static readonly SemaphoreSlim SecureWriteGate = new(1, 1);

    public Task<string?> ReadSecureAsync(string key) => SecureStorage.Default.GetAsync(key);

    public async Task WriteSecureAsync(string key, string value)
    {
        await SecureWriteGate.WaitAsync();
        try
        {
            try
            {
                await SecureStorage.Default.SetAsync(key, value);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"Secure session value '{key}' could not be updated; replacing the stale value: {exception.Message}");
                try
                {
                    SecureStorage.Default.Remove(key);
                }
                catch (Exception removalException)
                {
                    System.Diagnostics.Debug.WriteLine(
                        $"Stale secure session value '{key}' could not be removed: {removalException.Message}");
                }
                await SecureStorage.Default.SetAsync(key, value);
            }
        }
        finally
        {
            SecureWriteGate.Release();
        }
    }

    public bool RemoveSecure(string key) => SecureStorage.Default.Remove(key);
    public string ReadPreference(string key) => Preferences.Default.Get(key, "");
    public void WritePreference(string key, string value) => Preferences.Default.Set(key, value);
    public void RemovePreference(string key) => Preferences.Default.Remove(key);
}
