using CampusGig.Mobile.Models;
using CampusGig.Mobile.ViewModels;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class ProfileAccountStateTests
{
    [TestMethod]
    public void ClientOnlyAccountHidesStudentAndProviderJourneys()
    {
        var state = ProfileAccountState.From(new AuthUser
        {
            DisplayName = "Client",
            Email = "client@example.test",
            Roles = ["CLIENT"],
        });

        Assert.AreEqual("Client", state.DisplayName);
        Assert.AreEqual("CLIENT", state.RolesText);
        Assert.IsTrue(state.IsClientOnly);
        Assert.IsFalse(state.IsStudent);
        Assert.IsFalse(state.ShowsProviderJourney);
        Assert.IsFalse(state.IsProvider);
    }

    [TestMethod]
    public void VerifiedProviderAccountExposesProviderPresentation()
    {
        var state = ProfileAccountState.From(new AuthUser
        {
            Roles = ["CLIENT", "STUDENT", "PROVIDER"],
        });

        Assert.AreEqual("CLIENT · STUDENT · PROVIDER", state.RolesText);
        Assert.IsTrue(state.IsStudent);
        Assert.IsTrue(state.ShowsProviderJourney);
        Assert.IsTrue(state.IsProvider);
        Assert.AreEqual("Headline, bio, skills and availability", state.ProviderSubtitle);
    }
}
