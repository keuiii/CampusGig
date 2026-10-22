using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using System.Text.Json;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class OrderReviewPresentationTests
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    [TestMethod]
    public void ReviewContractParsesAuthoritativeTimingAndCompletionSource()
    {
        var detail = JsonSerializer.Deserialize<OrderDetail>("""
            {
              "id":"order-1",
              "status":"COMPLETED",
              "reviewPolicyVersion":1,
              "reviewStartedAt":"2026-10-06T00:00:00Z",
              "reviewDeadlineAt":"2026-10-08T00:00:00Z",
              "reviewDeliverySubmissionId":"submission-1",
              "reviewState":"COMPLETED",
              "reviewActionable":false,
              "completionSource":"AUTO_REVIEW_TIMEOUT",
              "completedAt":"2026-10-08T00:00:00Z",
              "history":[{"id":"history-1","toStatus":"COMPLETED","createdAt":"2026-10-08T00:00:00Z","actor":null}]
            }
            """, JsonOptions);

        Assert.IsNotNull(detail);
        Assert.AreEqual(1, detail.ReviewPolicyVersion);
        Assert.AreEqual("submission-1", detail.ReviewDeliverySubmissionId);
        Assert.AreEqual("AUTO_REVIEW_TIMEOUT", detail.CompletionSource);
        Assert.IsNull(detail.History[0].Actor);
    }

    [TestMethod]
    public void CountdownUsesInclusiveBoundaryAndRoundsPartialMinutesUp()
    {
        var deadline = DateTimeOffset.Parse("2026-10-08T00:00:00Z");
        Assert.AreEqual("1h 31m remaining", OrderReviewPresentation.TimeRemaining(deadline, deadline.AddMinutes(-90).AddSeconds(-1)));
        Assert.AreEqual("Review period ended", OrderReviewPresentation.TimeRemaining(deadline, deadline));
    }

    [TestMethod]
    public void ActiveWindowRequiresPolicyOneSubmittedOrder()
    {
        var order = new OrderItem
        {
            Status = "SUBMITTED",
            ReviewPolicyVersion = 1,
            ReviewDeadlineAt = DateTimeOffset.UtcNow.AddHours(48),
        };
        Assert.IsTrue(OrderReviewPresentation.HasActiveWindow(order));
        order.Status = "COMPLETED";
        Assert.IsFalse(OrderReviewPresentation.HasActiveWindow(order));
    }

    [TestMethod]
    public void CompletionCopyDistinguishesClientAndAutomaticCompletion()
    {
        Assert.IsTrue(OrderReviewPresentation.CompletionExplanation(new OrderItem { CompletionSource = "CLIENT_ACCEPTED" })!.Contains("client accepted", StringComparison.OrdinalIgnoreCase));
        Assert.IsTrue(OrderReviewPresentation.CompletionExplanation(new OrderItem { CompletionSource = "AUTO_REVIEW_TIMEOUT" })!.Contains("48-hour", StringComparison.OrdinalIgnoreCase));
        Assert.IsNull(OrderReviewPresentation.CompletionExplanation(new OrderItem()));
    }

    [TestMethod]
    public void WorkspaceExposesCoreDisputesAndContainsNoPayoutAction()
    {
        var workspace = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrderWorkspacePage.xaml"));
        Assert.IsTrue(workspace.Contains("48-HOUR DELIVERY REVIEW", StringComparison.Ordinal));
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "OrderWorkspacePage.xaml.cs"));
        Assert.IsTrue(source.Contains("OnOpenDisputeClicked", StringComparison.Ordinal));
        Assert.IsTrue(source.Contains("OnSubmitDisputeResponseClicked", StringComparison.Ordinal));
        Assert.IsFalse(source.Contains("Withdraw", StringComparison.OrdinalIgnoreCase));
        Assert.IsFalse(source.Contains("Cash Out", StringComparison.OrdinalIgnoreCase));
    }
}
