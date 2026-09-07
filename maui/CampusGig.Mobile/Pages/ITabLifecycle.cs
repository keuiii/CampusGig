namespace CampusGig.Mobile.Pages;

public interface ITabLifecycle
{
    Task OnTabAppearingAsync();
    Task OnTabDisappearingAsync();
}

