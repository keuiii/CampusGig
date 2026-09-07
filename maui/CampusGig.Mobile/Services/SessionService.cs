using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public sealed class SessionService
{
    private const string AccessTokenKey = "campusgig_access_token";
    private const string TrustedDeviceKey = "campusgig_trusted_device";
    private const string UserKey = "campusgig_user";
    private const string TrustedDeviceEmailKey = "campusgig_trusted_device_email";
    private readonly ISessionStorage storage;

    public SessionService(ISessionStorage storage)
    {
        this.storage = storage;
    }

    public string? AccessToken { get; private set; }
    public string? TrustedDeviceToken { get; private set; }
    public AuthUser? User { get; private set; }

    public async Task<bool> RestoreAsync()
    {
        AccessToken = await storage.ReadSecureAsync(AccessTokenKey);
        TrustedDeviceToken = await storage.ReadSecureAsync(TrustedDeviceKey);
        var userJson = storage.ReadPreference(UserKey);
        User = string.IsNullOrWhiteSpace(userJson)
            ? null
            : JsonSerializer.Deserialize<AuthUser>(userJson);
        return !string.IsNullOrWhiteSpace(AccessToken);
    }

    public async Task SaveAsync(AuthResponse response)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(response.AccessToken);
        ArgumentNullException.ThrowIfNull(response.User);
        AccessToken = response.AccessToken;
        User = response.User;
        await storage.WriteSecureAsync(AccessTokenKey, AccessToken);
        if (!string.IsNullOrWhiteSpace(response.TrustedDeviceToken))
        {
            TrustedDeviceToken = response.TrustedDeviceToken;
            await storage.WriteSecureAsync(TrustedDeviceKey, TrustedDeviceToken);
            if (!string.IsNullOrWhiteSpace(response.User.Email))
            {
                await storage.WriteSecureAsync(TrustedDeviceKeyFor(response.User.Email), TrustedDeviceToken);
                storage.WritePreference(TrustedDeviceEmailKey, NormalizeEmail(response.User.Email));
            }
        }
        storage.WritePreference(UserKey, JsonSerializer.Serialize(User));
    }

    public Task UpdateUserAsync(AuthUser user)
    {
        User = user;
        storage.WritePreference(UserKey, JsonSerializer.Serialize(user));
        return Task.CompletedTask;
    }

    public Task ClearAccessSessionAsync()
    {
        AccessToken = null;
        User = null;
        storage.RemoveSecure(AccessTokenKey);
        storage.RemovePreference(UserKey);
        return Task.CompletedTask;
    }

    public async Task<string?> GetTrustedDeviceTokenAsync(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var normalizedEmail = NormalizeEmail(email);
        var accountToken = await storage.ReadSecureAsync(TrustedDeviceKeyFor(normalizedEmail));
        if (!string.IsNullOrWhiteSpace(accountToken)) return accountToken;

        var legacyEmail = storage.ReadPreference(TrustedDeviceEmailKey);
        return string.IsNullOrWhiteSpace(legacyEmail) || legacyEmail == normalizedEmail
            ? TrustedDeviceToken
            : null;
    }

    public Task ForgetTrustedDeviceAsync()
    {
        if (!string.IsNullOrWhiteSpace(User?.Email))
            storage.RemoveSecure(TrustedDeviceKeyFor(User.Email));
        TrustedDeviceToken = null;
        storage.RemoveSecure(TrustedDeviceKey);
        storage.RemovePreference(TrustedDeviceEmailKey);
        return Task.CompletedTask;
    }

    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    private static string TrustedDeviceKeyFor(string email)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(NormalizeEmail(email))));
        return $"{TrustedDeviceKey}_{hash[..16]}";
    }
}
