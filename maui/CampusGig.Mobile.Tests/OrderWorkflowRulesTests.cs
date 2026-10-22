using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class OrderWorkflowRulesTests
{
    [TestMethod]
    public void ReviewRequiresCompletedPaidClientOrderWithoutExistingReview()
    {
        Assert.IsTrue(OrderWorkflowRules.CanReviewProvider("COMPLETED", false, false, "PAID"));
        Assert.IsFalse(OrderWorkflowRules.CanReviewProvider("SUBMITTED", false, false, "PAID"));
        Assert.IsFalse(OrderWorkflowRules.CanReviewProvider("COMPLETED", true, false, "PAID"));
        Assert.IsFalse(OrderWorkflowRules.CanReviewProvider("COMPLETED", false, true, "PAID"));
        Assert.IsFalse(OrderWorkflowRules.CanReviewProvider("COMPLETED", false, false, "REQUIRES_ACTION"));
    }

    [TestMethod]
    public void RatingAndRevisionCopyReflectsTheSelectedState()
    {
        Assert.IsTrue(OrderWorkflowRules.IsValidRating(5));
        Assert.IsFalse(OrderWorkflowRules.IsValidRating(0));
        Assert.AreEqual("Excellent", OrderWorkflowRules.RatingDescription(5));
        Assert.AreEqual("Select a rating", OrderWorkflowRules.RatingDescription(0));
        Assert.AreEqual("1 of 2 revisions remaining", OrderWorkflowRules.RevisionUsageLabel(1, 2));
        Assert.AreEqual("No revisions included", OrderWorkflowRules.RevisionUsageLabel(0, 0));
    }
}
