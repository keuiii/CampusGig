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
            TrustedDeviceToken = "trusted-device-token",
            User = new AuthUser { Id = "user-1", Email = "student@example.com" },
        });

        await session.ClearAccessSessionAsync();
        var nextLaunch = new SessionService(storage);
        var hasSession = await nextLaunch.RestoreAsync();

        Assert.IsFalse(hasSession);
        Assert.IsNull(nextLaunch.AccessToken);
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
}
