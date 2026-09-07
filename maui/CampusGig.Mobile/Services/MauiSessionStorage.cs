namespace CampusGig.Mobile.Services;

public sealed class MauiSessionStorage : ISessionStorage
{
    public Task<string?> ReadSecureAsync(string key) => SecureStorage.Default.GetAsync(key);
    public Task WriteSecureAsync(string key, string value) => SecureStorage.Default.SetAsync(key, value);
    public bool RemoveSecure(string key) => SecureStorage.Default.Remove(key);
    public string ReadPreference(string key) => Preferences.Default.Get(key, "");
    public void WritePreference(string key, string value) => Preferences.Default.Set(key, value);
    public void RemovePreference(string key) => Preferences.Default.Remove(key);
}
