namespace CampusGig.Mobile.Services;

public interface ISessionStorage
{
    Task<string?> ReadSecureAsync(string key);
    Task WriteSecureAsync(string key, string value);
    bool RemoveSecure(string key);
    string ReadPreference(string key);
    void WritePreference(string key, string value);
    void RemovePreference(string key);
}
