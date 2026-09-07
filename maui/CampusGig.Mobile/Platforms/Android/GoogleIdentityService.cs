using AndroidX.Credentials;
using Android.OS;
using AndroidX.Core.Content;
using Xamarin.GoogleAndroid.Libraries.Identity.GoogleId;

namespace CampusGig.Mobile.Platforms.Android;

public sealed class GoogleIdentityService : Services.IGoogleIdentityService
{
    public bool IsAvailable => Services.GoogleIdentityOptions.IsConfigured;

    public async Task<string> SignInAsync(CancellationToken cancellationToken = default)
    {
        var activity = Platform.CurrentActivity
            ?? throw new Services.GoogleSignInException("The Android sign-in window is not ready. Try again.");

        try
        {
            var option = new GetSignInWithGoogleOption.Builder(
                    Services.GoogleIdentityOptions.ServerClientId)
                .Build();
            var request = new GetCredentialRequest.Builder()
                .AddCredentialOption(option)
                .Build();
            var manager = CredentialManager.Create(activity);
            var executor = ContextCompat.GetMainExecutor(activity)
                ?? throw new Services.GoogleSignInException("The Android sign-in executor is unavailable.");
            using var cancellationSignal = new CancellationSignal();
            using var cancellationRegistration = cancellationToken.Register(cancellationSignal.Cancel);
            var completion = new TaskCompletionSource<GetCredentialResponse>(
                TaskCreationOptions.RunContinuationsAsynchronously);
            using var callback = new CredentialCallback(completion);
            manager.GetCredentialAsync(
                activity,
                request,
                cancellationSignal,
                executor,
                callback);
            var response = await completion.Task.WaitAsync(cancellationToken);

            if (response.Credential is not CustomCredential customCredential)
                throw new Services.GoogleSignInException("Google returned an unsupported credential type.");

            var credential = GoogleIdTokenCredential.CreateFrom(customCredential.Data);
            if (string.IsNullOrWhiteSpace(credential.IdToken))
                throw new Services.GoogleSignInException("Google did not return a secure identity token.");

            return credential.IdToken;
        }
        catch (Services.GoogleSignInException)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new Services.GoogleSignInException("Google sign-in could not be completed.", exception);
        }
    }

    public async Task SignOutAsync()
    {
        var activity = Platform.CurrentActivity;
        if (activity is null) return;
        try
        {
            var manager = CredentialManager.Create(activity);
            var executor = ContextCompat.GetMainExecutor(activity);
            if (executor is null) return;
            var clearRequest = new ClearCredentialStateRequest();
            using var cancellationSignal = new CancellationSignal();
            var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using var callback = new ClearCredentialCallback(completion);
            manager.ClearCredentialStateAsync(clearRequest, cancellationSignal, executor, callback);
            await completion.Task;
        }
        catch
        {
        }
    }

    private sealed class ClearCredentialCallback(TaskCompletionSource<bool> completion)
        : Java.Lang.Object, ICredentialManagerCallback
    {
        public void OnResult(Java.Lang.Object? result) => completion.TrySetResult(true);
        public void OnError(Java.Lang.Object? error) => completion.TrySetResult(false);
    }

    private sealed class CredentialCallback(
        TaskCompletionSource<GetCredentialResponse> completion)
        : Java.Lang.Object, ICredentialManagerCallback
    {
        public void OnResult(Java.Lang.Object? result)
        {
            if (result is GetCredentialResponse response)
            {
                completion.TrySetResult(response);
                return;
            }

            completion.TrySetException(
                new Services.GoogleSignInException("Google returned an invalid credential response."));
        }

        public void OnError(Java.Lang.Object? error)
        {
            var detail = error?.ToString();
            completion.TrySetException(new Services.GoogleSignInException(
                string.IsNullOrWhiteSpace(detail)
                    ? "Google sign-in could not be completed."
                    : detail));
        }
    }
}
