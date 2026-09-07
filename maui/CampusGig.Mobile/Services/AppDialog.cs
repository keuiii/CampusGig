namespace CampusGig.Mobile.Services;

public static class AppDialog
{
    public static Task AlertAsync(
        Page sourcePage,
        string title,
        string message,
        string cancel = "OK")
    {
        ArgumentNullException.ThrowIfNull(sourcePage);

        var hostPage = Application.Current?.Windows.FirstOrDefault()?.Page;
        var modalPage = hostPage?.Navigation.ModalStack.LastOrDefault();
        if (modalPage is not null)
            return modalPage.DisplayAlertAsync(title, message, cancel);
        var presenter = DialogPresentationRules.ShouldUseWindowHost(
            hostPage is not null,
            ReferenceEquals(hostPage, sourcePage))
            ? hostPage!
            : sourcePage;

        return presenter.DisplayAlertAsync(title, message, cancel);
    }

    public static Task<bool> ConfirmAsync(
        Page sourcePage,
        string title,
        string message,
        string accept,
        string cancel)
    {
        ArgumentNullException.ThrowIfNull(sourcePage);

        var hostPage = Application.Current?.Windows.FirstOrDefault()?.Page;
        var modalPage = hostPage?.Navigation.ModalStack.LastOrDefault();
        if (modalPage is not null)
            return modalPage.DisplayAlertAsync(title, message, accept, cancel);
        var presenter = DialogPresentationRules.ShouldUseWindowHost(
            hostPage is not null,
            ReferenceEquals(hostPage, sourcePage))
            ? hostPage!
            : sourcePage;

        return presenter.DisplayAlertAsync(title, message, accept, cancel);
    }

    public static Task<string?> PromptAsync(
        Page sourcePage,
        string title,
        string message,
        string accept = "OK",
        string cancel = "Cancel",
        string? placeholder = null,
        int maxLength = -1,
        Keyboard? keyboard = null,
        string initialValue = "")
    {
        ArgumentNullException.ThrowIfNull(sourcePage);

        var hostPage = Application.Current?.Windows.FirstOrDefault()?.Page;
        var modalPage = hostPage?.Navigation.ModalStack.LastOrDefault();
        if (modalPage is not null)
            return modalPage.DisplayPromptAsync(
                title, message, accept, cancel, placeholder, maxLength, keyboard, initialValue);
        var presenter = DialogPresentationRules.ShouldUseWindowHost(
            hostPage is not null,
            ReferenceEquals(hostPage, sourcePage))
            ? hostPage!
            : sourcePage;

        return presenter.DisplayPromptAsync(
            title, message, accept, cancel, placeholder, maxLength, keyboard, initialValue);
    }
}
