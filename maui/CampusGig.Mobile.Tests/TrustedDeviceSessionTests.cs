using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class TrustedDeviceSessionTests
{
    [TestMethod]
    public async Task SignOutPreservesTheTrustedDeviceToken()
    {
        var storage = new MemorySessionStorage();
        var session = new SessionService(storage);
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "access-token",
            RefreshToken = "refresh-token",
            TrustedDeviceToken = "trusted-device-token",
            User = new AuthUser { Id = "user-1", Email = "student@example.com" },
        });
        await session.ClearAccessSessionAsync();
        var nextLaunch = new SessionService(storage);
        var hasSession = await nextLaunch.RestoreAsync();

        Assert.IsFalse(hasSession);
        Assert.IsNull(nextLaunch.AccessToken);
        Assert.IsNull(nextLaunch.RefreshToken);
        Assert.AreEqual("trusted-device-token", nextLaunch.TrustedDeviceToken);
        Assert.AreEqual("trusted-device-token", await nextLaunch.GetTrustedDeviceTokenAsync("STUDENT@example.com"));
    }

    [TestMethod]
    public async Task TrustedDeviceTokensAreScopedToTheAccountEmail()
    {
        var storage = new MemorySessionStorage();
        var session = new SessionService(storage);
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "access-token",
            TrustedDeviceToken = "student-device-token",
            User = new AuthUser { Id = "student-1", Email = "student@example.com" },
        });

        Assert.AreEqual("student-device-token", await session.GetTrustedDeviceTokenAsync("student@example.com"));
        Assert.IsNull(await session.GetTrustedDeviceTokenAsync("another@example.com"));
    }

    [TestMethod]
    public async Task ForgetTrustedDeviceRemovesOnlyTheTrustToken()
    {
        var storage = new MemorySessionStorage();
        var session = new SessionService(storage);
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "access-token",
            TrustedDeviceToken = "trusted-device-token",
            User = new AuthUser { Id = "user-1" },
        });

        await session.ForgetTrustedDeviceAsync();

        Assert.AreEqual("access-token", session.AccessToken);
        Assert.IsNull(session.TrustedDeviceToken);
    }

    [TestMethod]
    public async Task ClearAccessSessionClearsUserAndAccessTokenImmediately()
    {
        var storage = new MemorySessionStorage();
        var session = new SessionService(storage);
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "valid-jwt",
            TrustedDeviceToken = "device-trust",
            User = new AuthUser { Id = "u1", Email = "test@example.com", DisplayName = "Test User" },
        });

        Assert.IsNotNull(session.AccessToken);
        Assert.IsNotNull(session.User);

        await session.ClearAccessSessionAsync();

        Assert.IsNull(session.AccessToken);
        Assert.IsNull(session.User);
        Assert.AreEqual("device-trust", session.TrustedDeviceToken);
        Assert.IsNull(await storage.ReadSecureAsync("campusgig_access_token"));
        Assert.AreEqual("", storage.ReadPreference("campusgig_user"));
    }

    [TestMethod]
    public async Task CorruptedSavedUserIsDiscardedWithoutCrashingStartup()
    {
        var storage = new MemorySessionStorage();
        await storage.WriteSecureAsync("campusgig_access_token", "stale-token");
        storage.WritePreference("campusgig_user", "{not-valid-json");
        var session = new SessionService(storage);

        var restored = await session.RestoreAsync();

        Assert.IsFalse(restored);
        Assert.IsNull(session.AccessToken);
        Assert.IsNull(session.User);
        Assert.IsNull(await storage.ReadSecureAsync("campusgig_access_token"));
        Assert.AreEqual("", storage.ReadPreference("campusgig_user"));
    }

    [TestMethod]
    public async Task ConcurrentRestoreCallsShareConsistentSessionState()
    {
        var storage = new MemorySessionStorage();
        var session = new SessionService(storage);
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "valid-token",
            User = new AuthUser { Id = "user-1", Email = "student@example.com" },
        });

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => session.RestoreAsync()));

        Assert.IsTrue(results.All(result => result));
        Assert.AreEqual("valid-token", session.AccessToken);
        Assert.AreEqual("user-1", session.User?.Id);
    }

    [TestMethod]
    public async Task RefreshTokenIsPersistedRotatedAndClearedWithTheSession()
    {
        var storage = new MemorySessionStorage();
        var session = new SessionService(storage);
        var user = new AuthUser { Id = "user-1", Email = "student@example.com" };
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "access-1",
            RefreshToken = "refresh-1",
            User = user,
        });
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "access-2",
            RefreshToken = "refresh-2",
            User = user,
        });

        var restored = new SessionService(storage);
        Assert.IsTrue(await restored.RestoreAsync());
        Assert.AreEqual("access-2", restored.AccessToken);
        Assert.AreEqual("refresh-2", restored.RefreshToken);

        await restored.ClearAccessSessionAsync();
        Assert.IsNull(await storage.ReadSecureAsync("campusgig_refresh_token"));
    }

    [TestMethod]
    public async Task LateRefreshCannotRestoreASessionAfterSignOut()
    {
        var storage = new MemorySessionStorage();
        var session = new SessionService(storage);
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "access-before-sign-out",
            RefreshToken = "refresh-before-sign-out",
            User = new AuthUser { Id = "user-1", Email = "student@example.com" },
        });
        var refreshGeneration = session.Generation;

        await session.ClearAccessSessionAsync();
        var saved = await session.SaveAsync(new AuthResponse
        {
            AccessToken = "late-access-token",
            RefreshToken = "late-refresh-token",
            User = new AuthUser { Id = "user-1", Email = "student@example.com" },
        }, refreshGeneration);

        Assert.IsFalse(saved);
        Assert.IsNull(session.AccessToken);
        Assert.IsNull(session.RefreshToken);
        Assert.IsNull(session.User);
        Assert.IsNull(await storage.ReadSecureAsync("campusgig_access_token"));
        Assert.IsNull(await storage.ReadSecureAsync("campusgig_refresh_token"));
    }

    [TestMethod]
    public async Task LateProfileRefreshCannotRestoreUserAfterSignOut()
    {
        var storage = new MemorySessionStorage();
        var session = new SessionService(storage);
        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "access-before-sign-out",
            User = new AuthUser { Id = "user-1", Email = "student@example.com" },
        });
        var profileGeneration = session.Generation;
        var responseStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseResponse = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var profileRefresh = CompleteProfileRefreshAsync();
        await responseStarted.Task;
        await session.ClearAccessSessionAsync();
        releaseResponse.SetResult();
        var updated = await profileRefresh;

        Assert.IsFalse(updated);
        Assert.IsNull(session.User);
        Assert.AreEqual("", storage.ReadPreference("campusgig_user"));

        await session.SaveAsync(new AuthResponse
        {
            AccessToken = "new-access-token",
            User = new AuthUser { Id = "user-2", Email = "next@example.com" },
        });
        var currentGeneration = session.Generation;
        Assert.IsTrue(await session.UpdateUserAsync(new AuthUser
        {
            Id = "user-2",
            Email = "next@example.com",
            DisplayName = "Current profile",
        }, currentGeneration));
        Assert.AreEqual("Current profile", session.User?.DisplayName);

        async Task<bool> CompleteProfileRefreshAsync()
        {
            responseStarted.SetResult();
            await releaseResponse.Task;
            return await session.UpdateUserAsync(new AuthUser
            {
                Id = "user-1",
                Email = "student@example.com",
                DisplayName = "Stale profile",
            }, profileGeneration);
        }
    }

    [TestMethod]
    public async Task SecureStorageFailureKeepsAuthenticatedSessionInMemory()
    {
        var storage = new FailingSecureSessionStorage(failReads: false, failWrites: true);
        var session = new SessionService(storage);

        var saved = await session.SaveAsync(new AuthResponse
        {
            AccessToken = "access-token",
            RefreshToken = "refresh-token",
            TrustedDeviceToken = "trusted-device-token",
            User = new AuthUser { Id = "user-1", Email = "student@example.com" },
        });

        Assert.IsTrue(saved);
        Assert.AreEqual("access-token", session.AccessToken);
        Assert.AreEqual("refresh-token", session.RefreshToken);
        Assert.AreEqual("user-1", session.User?.Id);
        Assert.AreEqual("trusted-device-token", session.TrustedDeviceToken);
        Assert.IsFalse(await new SessionService(storage).RestoreAsync());
    }

    [TestMethod]
    public async Task BrokenTrustedDeviceStorageDoesNotBlockLoginRequest()
    {
        var session = new SessionService(new FailingSecureSessionStorage(failReads: true, failWrites: false));

        var trustedDeviceToken = await session.GetTrustedDeviceTokenAsync("student@example.com");

        Assert.IsNull(trustedDeviceToken);
    }


    private sealed class MemorySessionStorage : ISessionStorage
    {
        private readonly Dictionary<string, string> secure = [];
        private readonly Dictionary<string, string> preferences = [];

        public Task<string?> ReadSecureAsync(string key) =>
            Task.FromResult(secure.GetValueOrDefault(key));

        public Task WriteSecureAsync(string key, string value)
        {
            secure[key] = value;
            return Task.CompletedTask;
        }

        public bool RemoveSecure(string key) => secure.Remove(key);
        public string ReadPreference(string key) => preferences.GetValueOrDefault(key, "");
        public void WritePreference(string key, string value) => preferences[key] = value;
        public void RemovePreference(string key) => preferences.Remove(key);
    }

    private sealed class FailingSecureSessionStorage(bool failReads, bool failWrites) : ISessionStorage
    {
        private readonly Dictionary<string, string> preferences = [];

        public Task<string?> ReadSecureAsync(string key) => failReads
            ? Task.FromException<string?>(new InvalidOperationException("Secure reads unavailable"))
            : Task.FromResult<string?>(null);

        public Task WriteSecureAsync(string key, string value) => failWrites
            ? Task.FromException(new InvalidOperationException("Secure writes unavailable"))
            : Task.CompletedTask;

        public bool RemoveSecure(string key) => false;
        public string ReadPreference(string key) => preferences.GetValueOrDefault(key, "");
        public void WritePreference(string key, string value) => preferences[key] = value;
        public void RemovePreference(string key) => preferences.Remove(key);
    }
}
