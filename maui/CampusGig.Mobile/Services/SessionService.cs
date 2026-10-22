using System.Text.Json;
using System.Security.Cryptography;
using System.Text;
using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Services;

public sealed class SessionService
{
    private const string AccessTokenKey = "campusgig_access_token";
    private const string RefreshTokenKey = "campusgig_refresh_token";
    private const string TrustedDeviceKey = "campusgig_trusted_device";
    private const string UserKey = "campusgig_user";
    private const string TrustedDeviceEmailKey = "campusgig_trusted_device_email";
    private readonly ISessionStorage storage;
    private readonly SemaphoreSlim restoreGate = new(1, 1);
    private readonly SemaphoreSlim mutationGate = new(1, 1);
    private long generation;

    public SessionService(ISessionStorage storage)
    {
        this.storage = storage;
    }

    public string? AccessToken { get; private set; }
    public string? RefreshToken { get; private set; }
    public string? TrustedDeviceToken { get; private set; }
    public AuthUser? User { get; private set; }
    public long Generation => Interlocked.Read(ref generation);

    public async Task<bool> RestoreAsync()
    {
        await restoreGate.WaitAsync();
        try
        {
            try
            {
                AccessToken = await storage.ReadSecureAsync(AccessTokenKey);
                RefreshToken = await storage.ReadSecureAsync(RefreshTokenKey);
                TrustedDeviceToken = await storage.ReadSecureAsync(TrustedDeviceKey);
                var userJson = storage.ReadPreference(UserKey);
                User = string.IsNullOrWhiteSpace(userJson)
                    ? null
                    : JsonSerializer.Deserialize<AuthUser>(userJson);
                if ((string.IsNullOrWhiteSpace(AccessToken) && string.IsNullOrWhiteSpace(RefreshToken)) || User is null)
                {
                    await ClearAccessSessionAsync();
                    return false;
                }
                return true;
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                System.Diagnostics.Debug.WriteLine($"Discarding invalid saved session: {exception.Message}");
                AccessToken = null;
                RefreshToken = null;
                User = null;
                try { storage.RemoveSecure(AccessTokenKey); } catch { }
                try { storage.RemoveSecure(RefreshTokenKey); } catch { }
                try { storage.RemovePreference(UserKey); } catch { }
                return false;
            }
        }
        finally
        {
            restoreGate.Release();
        }
    }

    public async Task<bool> SaveAsync(AuthResponse response, long? expectedGeneration = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(response.AccessToken);
        ArgumentNullException.ThrowIfNull(response.User);
        await mutationGate.WaitAsync();
        try
        {
            if (expectedGeneration.HasValue && expectedGeneration.Value != Generation)
                return false;
            var nextAccessToken = response.AccessToken;
            var nextRefreshToken = string.IsNullOrWhiteSpace(response.RefreshToken)
                ? RefreshToken
                : response.RefreshToken;
            AccessToken = nextAccessToken;
            RefreshToken = nextRefreshToken;
            User = response.User;

            try
            {
                if (!string.IsNullOrWhiteSpace(nextRefreshToken))
                    await storage.WriteSecureAsync(RefreshTokenKey, nextRefreshToken);
                await storage.WriteSecureAsync(AccessTokenKey, nextAccessToken);
                storage.WritePreference(UserKey, JsonSerializer.Serialize(response.User));
            }
            catch (Exception exception)
            {
                // A broken Android keystore must not reject an otherwise valid
                // login. Keep the authenticated session in memory for this app
                // run and avoid falling back to unencrypted token storage.
                System.Diagnostics.Debug.WriteLine(
                    $"The authenticated session will remain in memory because secure persistence failed: {exception}");
                TryRemoveSecure(AccessTokenKey);
                TryRemoveSecure(RefreshTokenKey);
                TryRemovePreference(UserKey);
            }

            if (!string.IsNullOrWhiteSpace(response.TrustedDeviceToken))
            {
                TrustedDeviceToken = response.TrustedDeviceToken;
                try
                {
                    await storage.WriteSecureAsync(TrustedDeviceKey, TrustedDeviceToken);
                    if (!string.IsNullOrWhiteSpace(response.User.Email))
                    {
                        await storage.WriteSecureAsync(TrustedDeviceKeyFor(response.User.Email), TrustedDeviceToken);
                        storage.WritePreference(TrustedDeviceEmailKey, NormalizeEmail(response.User.Email));
                    }
                }
                catch (Exception exception)
                {
                    System.Diagnostics.Debug.WriteLine(
                        $"The trusted-device token will remain in memory because secure persistence failed: {exception}");
                    TryRemoveSecure(TrustedDeviceKey);
                    if (!string.IsNullOrWhiteSpace(response.User.Email))
                        TryRemoveSecure(TrustedDeviceKeyFor(response.User.Email));
                    TryRemovePreference(TrustedDeviceEmailKey);
                }
            }
            return true;
        }
        finally
        {
            mutationGate.Release();
        }
    }

    public async Task<bool> UpdateUserAsync(AuthUser user, long expectedGeneration)
    {
        ArgumentNullException.ThrowIfNull(user);
        await mutationGate.WaitAsync();
        try
        {
            if (expectedGeneration != Generation)
                return false;
            storage.WritePreference(UserKey, JsonSerializer.Serialize(user));
            User = user;
            return true;
        }
        finally
        {
            mutationGate.Release();
        }
    }

    public async Task ClearAccessSessionAsync()
    {
        Interlocked.Increment(ref generation);
        await mutationGate.WaitAsync();
        try
        {
            AccessToken = null;
            RefreshToken = null;
            User = null;
            storage.RemoveSecure(AccessTokenKey);
            storage.RemoveSecure(RefreshTokenKey);
            storage.RemovePreference(UserKey);
        }
        finally
        {
            mutationGate.Release();
        }
    }

    public async Task<string?> GetTrustedDeviceTokenAsync(string? email)
    {
        if (string.IsNullOrWhiteSpace(email)) return null;
        var normalizedEmail = NormalizeEmail(email);
        try
        {
            var accountToken = await storage.ReadSecureAsync(TrustedDeviceKeyFor(normalizedEmail));
            if (!string.IsNullOrWhiteSpace(accountToken)) return accountToken;

            var legacyEmail = storage.ReadPreference(TrustedDeviceEmailKey);
            return string.IsNullOrWhiteSpace(legacyEmail) || legacyEmail == normalizedEmail
                ? TrustedDeviceToken
                : null;
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine(
                $"The saved trusted-device token could not be read and will be ignored: {exception}");
            TryRemoveSecure(TrustedDeviceKeyFor(normalizedEmail));
            return null;
        }
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

    private void TryRemoveSecure(string key)
    {
        try { storage.RemoveSecure(key); }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Secure session value '{key}' could not be removed: {exception.Message}");
        }
    }

    private void TryRemovePreference(string key)
    {
        try { storage.RemovePreference(key); }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Session preference '{key}' could not be removed: {exception.Message}");
        }
    }
}
