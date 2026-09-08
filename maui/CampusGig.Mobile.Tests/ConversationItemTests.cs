using CampusGig.Mobile.Models;

namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class ConversationItemTests
{
    [TestMethod]
    public void Preview_IdentifiesOwnTextMessage()
    {
        var item = new ConversationItem
        {
            LatestMessage = new ConversationMessage { Body = "Hello", IsMine = true },
        };

        Assert.AreEqual("You: Hello", item.Preview);
    }

    [TestMethod]
    public void Preview_DescribesAttachmentOnlyMessage()
    {
        var item = new ConversationItem
        {
            LatestMessage = new ConversationMessage
            {
                IsMine = false,
                Attachments = [new MessageAttachment(), new MessageAttachment()],
            },
        };

        Assert.AreEqual("Sent 2 attachments", item.Preview);
    }

    [TestMethod]
    public void UnreadLabel_CapsLargeCounts()
    {
        Assert.AreEqual("9+", new ConversationItem { UnreadCount = 14 }.UnreadLabel);
        Assert.IsFalse(new ConversationItem().HasUnread);
    }

    [TestMethod]
    public void CampusCreatedAt_UsesPhilippineTime()
    {
        var createdAt = new DateTimeOffset(2026, 9, 8, 14, 16, 0, TimeSpan.Zero);

        Assert.AreEqual(
            new DateTime(2026, 9, 8, 22, 16, 0),
            new ConversationMessage { CreatedAt = createdAt }.CampusCreatedAt);
    }
}
