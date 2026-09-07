namespace CampusGig.Mobile.Services;

public interface IGoogleIdentityService
{
    bool IsAvailable { get; }

    Task<string> SignInAsync(CancellationToken cancellationToken = default);
    Task SignOutAsync();
}

public sealed class GoogleSignInException(string message, Exception? innerException = null)
    : Exception(message, innerException);

public sealed class UnavailableGoogleIdentityService : IGoogleIdentityService
{
    public bool IsAvailable => false;

    public Task<string> SignInAsync(CancellationToken cancellationToken = default) =>
        throw new GoogleSignInException("Google sign-in is currently available on Android only.");

    public Task SignOutAsync() => Task.CompletedTask;
}
