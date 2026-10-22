namespace CampusGig.Mobile.Tests;

[TestClass]
public sealed class ProviderListingEditorMarkupTests
{
    [TestMethod]
    public void ListingWorkspaceExposesCreateEditAndModeratedSubmission()
    {
        var workspace = ReadFixture("ProviderListingsPage.cs");
        StringAssert.Contains(workspace, "AutomationId = \"ProviderNewListing\"");
        StringAssert.Contains(workspace, "BeginEditingAsync(current)");
        StringAssert.Contains(workspace, "$\"provider/services/{listing.Id}/revise\"");
        StringAssert.Contains(workspace, "disappear from Discover until an administrator approves it again");
        StringAssert.Contains(workspace, "provider/services/{listing.Id}/submit");
    }

    [TestMethod]
    public void ListingWorkspaceUsesAccessibleCircularIconActions()
    {
        var workspace = ReadFixture("ProviderListingsPage.cs");

        StringAssert.Contains(workspace, "Text = \"+\"");
        StringAssert.Contains(workspace, "CornerRadius = 24");
        StringAssert.Contains(workspace, "HorizontalOptions = LayoutOptions.Start");
        StringAssert.Contains(workspace, "ActionIconButton");
        StringAssert.Contains(workspace, "SemanticProperties.SetDescription(button, description)");
        StringAssert.Contains(workspace, "ToolTipProperties.SetText(button, description)");

        foreach (var icon in new[]
                 {
                     "listing_preview.svg",
                     "listing_edit.svg",
                     "listing_pause.svg",
                     "listing_resume.svg",
                     "listing_restore.svg",
                     "listing_submit.svg",
                     "listing_archive.svg",
                 })
        {
            StringAssert.Contains(workspace, $"\"{icon}\"");
            StringAssert.Contains(ReadFixture(icon), "<svg");
        }
    }

    [TestMethod]
    public void EditorDoesNotRepeatDraftStatusInItsHeader()
    {
        AssertDoesNotContain(ReadFixture("ProviderListingEditorPage.xaml"), "EditorStatusLabel");
        AssertDoesNotContain(ReadFixture("ProviderListingEditorPage.xaml.cs"), "EditorStatusLabel");
    }

    [TestMethod]
    public void ListingPreviewUsesSingleNavigationLabelAndLoadsOwnedCoverMedia()
    {
        var workspace = ReadFixture("ProviderListingsPage.cs");

        StringAssert.Contains(workspace, "NavigationPage.SetHasNavigationBar(this, false)");
        StringAssert.Contains(workspace, "AutomationId = \"ListingPreviewBack\"");
        StringAssert.Contains(workspace, "AutomationId = \"ProviderListingPreview\"");
        AssertDoesNotContain(workspace, "AutomationId = \"ListingPreviewTitle\"");
        StringAssert.Contains(workspace, "Text = \"< Listing preview\"");
        AssertDoesNotContain(workspace, "Text = \"See the service as a client will\"");
        StringAssert.Contains(workspace, "AutomationId = \"ListingPreviewCover\"");
        StringAssert.Contains(workspace, "$\"provider/services/{listing.Id}/media/{coverMedia.Id}\"");
        StringAssert.Contains(workspace, "ImageSource.FromFile(path)");
        StringAssert.Contains(workspace, "LineBreakMode = LineBreakMode.WordWrap");
        StringAssert.Contains(workspace, "StrokeShape = new RoundRectangle { CornerRadius = 22 }");
        StringAssert.Contains(workspace, "VerticalOptions = LayoutOptions.Start");
    }

    [TestMethod]
    public void EditorContainsRequiredFieldsAndAccessibleAutomationIds()
    {
        var markup = ReadFixture("ProviderListingEditorPage.xaml");
        foreach (var id in new[]
                 {
                     "ListingCategoryPicker",
                     "ListingTitleEntry",
                     "ListingDescriptionEditor",
                     "ListingDeliveryPicker",
                     "ListingSaveDraft",
                     "ListingSaveAndSubmit",
                 })
            StringAssert.Contains(markup, $"AutomationId=\"{id}\"");
    }

    [TestMethod]
    public void NewMobileListingsUseTheFixedPriceWizard()
    {
        var markup = ReadFixture("ProviderListingEditorPage.xaml");
        var source = ReadFixture("ProviderListingEditorPage.xaml.cs");

        StringAssert.Contains(source, "listing?.PricingModel ?? PricingModels.SinglePriceV2");
        StringAssert.Contains(source, "PricingModelField.IsVisible = listing?.PricingModel == PricingModels.LegacyPackages");
        StringAssert.Contains(markup, "x:Name=\"FormProgress\"");
        StringAssert.Contains(markup, "AutomationId=\"ListingDetailsNext\"");
        StringAssert.Contains(markup, "AutomationId=\"ListingPricingNext\"");
        StringAssert.Contains(markup, "AutomationId=\"ListingMediaNext\"");
        StringAssert.Contains(source, "FormProgress.ProgressTo");
    }

    [TestMethod]
    public void EditorUsesExistingProviderAndMediaApiContracts()
    {
        var source = ReadFixture("ProviderListingEditorPage.xaml.cs");
        var markup = ReadFixture("ProviderListingEditorPage.xaml");
        StringAssert.Contains(source, "api.PostAsync<ApiResult<ProviderListing>>(\"provider/services\", payload)");
        StringAssert.Contains(source, "api.PutAsync<ApiResult<ProviderListing>>($\"provider/services/{listing.Id}\", payload)");
        StringAssert.Contains(source, "api.PostMultipartAsync<ApiResult<List<ServiceMedia>>>");
        StringAssert.Contains(source, "api.DeleteAsync<ApiMessage>($\"provider/services/{listing.Id}/media/{media.Id}\")");
        StringAssert.Contains(markup, "AutomationId=\"ListingCurrentCover\"");
        StringAssert.Contains(source, "LoadCurrentCoverAsync");
    }

    [TestMethod]
    public void EditorExplainsFiveFileGalleryAndBookingRendersImageCarousel()
    {
        var editorMarkup = ReadFixture("ProviderListingEditorPage.xaml");
        var editorSource = ReadFixture("ProviderListingEditorPage.xaml.cs");
        var bookingSource = ReadFixture("ServiceBookingPage.cs");

        StringAssert.Contains(editorMarkup, "Text=\"SERVICE GALLERY\"");
        StringAssert.Contains(editorMarkup, "up to five gallery images");
        StringAssert.Contains(editorMarkup, "x:Name=\"PortfolioCapacityLabel\"");
        StringAssert.Contains(editorSource, "PickMultipleAsync");
        StringAssert.Contains(editorSource, "MaximumPortfolioFiles");
        StringAssert.Contains(bookingSource, "AutomationId = \"ServiceMediaCarousel\"");
        StringAssert.Contains(bookingSource, "item.MimeType.StartsWith(\"image/\"");
        StringAssert.Contains(bookingSource, "IndicatorView = indicator");
    }

    private static string ReadFixture(string name) =>
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name));

    private static void AssertDoesNotContain(string actual, string unexpected) =>
        Assert.AreEqual(
            -1,
            actual.IndexOf(unexpected, StringComparison.Ordinal),
            $"Did not expect to find '{unexpected}'.");
}
