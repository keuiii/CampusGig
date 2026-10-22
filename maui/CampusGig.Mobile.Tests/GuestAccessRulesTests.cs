using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class GuestAccessRulesTests
{
    [TestMethod]
    [DataRow(GuestProtectedAction.ViewSavedServices)]
    [DataRow(GuestProtectedAction.SaveService)]
    [DataRow(GuestProtectedAction.ViewNotifications)]
    [DataRow(GuestProtectedAction.ViewProfile)]
    [DataRow(GuestProtectedAction.SendServiceRequest)]
    [DataRow(GuestProtectedAction.MessageProvider)]
    public void ProtectedActionsRequireAuthenticationForGuests(GuestProtectedAction action)
    {
        Assert.IsTrue(GuestAccessRules.RequiresAuthentication(action, authenticated: false));
        Assert.IsFalse(GuestAccessRules.RequiresAuthentication(action, authenticated: true));
    }

    [TestMethod]
    public void ServiceRequestIntentPreservesSafeServiceAndPackageIds()
    {
        var intent = GuestAccessRules.CreateServiceRequestIntent(
            "cm1-service_123",
            "cm1-package_456");

        Assert.IsNotNull(intent);
        Assert.AreEqual(GuestProtectedAction.SendServiceRequest, intent.Action);
        Assert.AreEqual("cm1-service_123", intent.ServiceId);
        Assert.AreEqual("cm1-package_456", intent.PackageId);
        Assert.IsNull(intent.ProviderId);
    }

    [TestMethod]
    [DataRow(null)]
    [DataRow("")]
    [DataRow("service/../../orders")]
    [DataRow("service id")]
    public void ServiceRequestIntentRejectsUnsafeServiceIds(string? serviceId)
    {
        Assert.IsNull(GuestAccessRules.CreateServiceRequestIntent(serviceId, "package-1"));
    }

    [TestMethod]
    public void ParserAcceptsOnlySupportedPendingIntent()
    {
        Assert.IsNotNull(GuestAccessRules.ParseIntent(
            nameof(GuestProtectedAction.SendServiceRequest),
            "service-1",
            "package-1",
            null));
        Assert.IsNotNull(GuestAccessRules.ParseIntent(
            nameof(GuestProtectedAction.MessageProvider),
            null,
            null,
            "provider-1"));
        Assert.IsNull(GuestAccessRules.ParseIntent(
            nameof(GuestProtectedAction.SaveService),
            "service-1",
            null,
            null));
        Assert.IsNull(GuestAccessRules.ParseIntent("Unknown", "service-1", null, null));
    }
}
