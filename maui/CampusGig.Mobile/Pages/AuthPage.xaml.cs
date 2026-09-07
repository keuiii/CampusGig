using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.Pages;

public partial class AuthPage : ContentPage
{
    private enum AuthMode { Login, Register, Verify, Forgot, Reset, Mfa }

    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly IGoogleIdentityService googleIdentity;
    private AuthMode mode = AuthMode.Login;
    private string? mfaChallengeToken;
    private bool recoveryCode;
    private bool resetRecoveryCode;
    private bool entrancePlayed;
    private bool themeAnimating;
    private bool submitting;
    private bool normalizingCode;
    private string submitButtonText = "Log in     →";

    public AuthPage(
        CampusGigApi api,
        SessionService session,
        IGoogleIdentityService googleIdentity)
    {
        InitializeComponent();
        this.api = api;
        this.session = session;
        this.googleIdentity = googleIdentity;
        PasswordEntry.TextChanged += (_, _) =>
        {
            var ready = (PasswordEntry.Text?.Length ?? 0) >= 8;
            PasswordHint.Text = ready ? "✓  Minimum 8 characters" : "○  Minimum 8 characters";
            PasswordHint.TextColor = Color.FromArgb(ready ? "#0F6B4F" : "#66716B");
            UpdateSubmitState();
        };
        EmailEntry.TextChanged += (_, _) => UpdateSubmitState();
        NameEntry.TextChanged += (_, _) => UpdateSubmitState();
        CodeEntry.TextChanged += OnCodeTextChanged;
        StudentCheckBox.CheckedChanged += (_, _) =>
        {
            RenderMode();
            UpdateSubmitState();
        };
        RenderMode();
        GoogleButton.IsEnabled = googleIdentity.IsAvailable;
        ThemeThumb.TranslationX = InteractionMotion.ThemeThumbOffset(IsDarkMode);
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (entrancePlayed) return;
        entrancePlayed = true;
        AuthContent.Opacity = 0;
        AuthContent.TranslationY = 14;
        await Task.WhenAll(
            AuthContent.FadeToAsync(1, 190, Easing.CubicOut),
            AuthContent.TranslateToAsync(0, 0, 220, Easing.CubicOut));
    }

    private async Task SetModeAsync(AuthMode nextMode)
    {
        if (mode == nextMode) return;
        var animateTab = (mode is AuthMode.Login or AuthMode.Register) &&
                         (nextMode is AuthMode.Login or AuthMode.Register);
        await Task.WhenAll(
            FieldsContent.FadeToAsync(0, 55, Easing.CubicIn),
            FieldsContent.TranslateToAsync(0, 4, 55, Easing.CubicIn));
        mode = nextMode;
        StatusLabel.Text = "";
        StatusPanel.IsVisible = false;
        CodeEntry.Text = "";
        if (nextMode is AuthMode.Login or AuthMode.Register) PasswordEntry.Text = "";
        RenderMode();
        var tabOffset = InteractionMotion.AuthTabOffset(
            nextMode == AuthMode.Register,
            AuthTabs.Width,
            AuthTabs.Padding.Left,
            AuthTabs.Padding.Right);
        if (!animateTab) TabIndicator.TranslationX = tabOffset;
        FieldsContent.TranslationY = -3;
        await Task.WhenAll(
            FieldsContent.FadeToAsync(1, 125, Easing.CubicOut),
            FieldsContent.TranslateToAsync(0, 0, 150, Easing.CubicOut),
            animateTab
                ? TabIndicator.TranslateToAsync(tabOffset, 0, 180, Easing.CubicInOut)
                : Task.CompletedTask);
    }

    private void RenderMode()
    {
        var tabbed = mode is AuthMode.Login or AuthMode.Register;
        AuthTabs.IsVisible = tabbed;
        var inactiveTabColor = AppThemeColor("#66716B", "#AAB6AF");
        LoginTabButton.TextColor = mode == AuthMode.Login
            ? Color.FromArgb("#0F6B4F") : inactiveTabColor;
        RegisterTabButton.TextColor = mode == AuthMode.Register
            ? Color.FromArgb("#0F6B4F") : inactiveTabColor;
        NameGroup.IsVisible = mode == AuthMode.Register;
        EmailGroup.IsVisible = mode is not AuthMode.Verify and not AuthMode.Mfa;
        StudentGroup.IsVisible = mode == AuthMode.Register;
        CodeGroup.IsVisible = mode is AuthMode.Verify or AuthMode.Reset or AuthMode.Mfa;
        PasswordGroup.IsVisible = mode is AuthMode.Login or AuthMode.Register or AuthMode.Reset;
        ResetMfaGroup.IsVisible = mode == AuthMode.Reset;
        RememberGroup.IsVisible = mode == AuthMode.Mfa;
        RecoveryButton.IsVisible = mode == AuthMode.Mfa;
        ForgotButton.IsVisible = mode == AuthMode.Login;
        BackButton.IsVisible = mode is AuthMode.Verify or AuthMode.Forgot or AuthMode.Reset or AuthMode.Mfa;
        SocialGroup.IsVisible = tabbed;
        PasswordLabel.Text = mode == AuthMode.Reset ? "NEW PASSWORD" : "PASSWORD";
        CodeLabel.Text = mode == AuthMode.Mfa
            ? recoveryCode ? "RECOVERY CODE" : "AUTHENTICATOR CODE"
            : "SIX-DIGIT CODE";
        CodeEntry.Placeholder = recoveryCode ? "ABCDE-12345" : "000000";
        CodeEntry.Keyboard = recoveryCode ? Keyboard.Default : Keyboard.Numeric;

        (PageTitle.Text, PageSubtitle.Text, SubmitButton.Text) = mode switch
        {
            AuthMode.Login => ("Welcome to CampusGig", "Your trusted marketplace for verified student skills and services.", "Log in     →"),
            AuthMode.Register => ("Join CampusGig", "Create an account to book trusted student services.", $"Create {(StudentCheckBox.IsChecked ? "student" : "client")} account     →"),
            AuthMode.Verify => ("Verify your email", $"Enter the code sent to {EmailEntry.Text?.Trim()}.", "Verify email     →"),
            AuthMode.Forgot => ("Forgot password?", "We’ll send a reset code to your account email.", "Send reset code     →"),
            AuthMode.Reset => ("Create a new password", "Enter your code and choose a secure new password.", "Update password     →"),
            AuthMode.Mfa => ("Two-factor verification", recoveryCode ? "Enter one of your saved recovery codes." : "Enter the current code from your authenticator app.", "Verify and sign in     →"),
            _ => throw new InvalidOperationException(),
        };
        if (BusyIndicator.IsRunning)
        {
            submitButtonText = SubmitButton.Text;
            SubmitButton.Text = "";
        }
        UpdateSubmitState();
    }

    private Color AppThemeColor(string light, string dark) =>
        IsDarkMode
            ? Color.FromArgb(dark)
            : Color.FromArgb(light);

    private bool IsDarkMode =>
        ((App)Application.Current!).UserAppTheme == AppTheme.Dark;

    private async void OnLoginTabClicked(object? sender, EventArgs e) => await SetModeAsync(AuthMode.Login);
    private async void OnRegisterTabClicked(object? sender, EventArgs e) => await SetModeAsync(AuthMode.Register);
    private async void OnForgotClicked(object? sender, EventArgs e) => await SetModeAsync(AuthMode.Forgot);
    private async void OnBackClicked(object? sender, EventArgs e) => await SetModeAsync(AuthMode.Login);

    private void OnShowPasswordClicked(object? sender, EventArgs e)
    {
        PasswordEntry.IsPassword = !PasswordEntry.IsPassword;
        ShowPasswordButton.Text = PasswordEntry.IsPassword ? "SHOW" : "HIDE";
    }

    private async void OnRecoveryClicked(object? sender, EventArgs e)
    {
        await FieldsContent.FadeToAsync(0.25, 70, Easing.CubicIn);
        recoveryCode = !recoveryCode;
        CodeEntry.Text = "";
        RecoveryButton.Text = recoveryCode ? "Use authenticator app instead" : "Use a recovery code";
        RenderMode();
        await FieldsContent.FadeToAsync(1, 150, Easing.CubicOut);
    }

    private void OnResetRecoveryClicked(object? sender, EventArgs e)
    {
        resetRecoveryCode = !resetRecoveryCode;
        ResetMfaEntry.Text = "";
        ResetRecoveryButton.Text = resetRecoveryCode ? "Use authenticator code" : "Use recovery code";
    }

    private async void OnThemeClicked(object? sender, EventArgs e)
    {
        if (themeAnimating) return;
        themeAnimating = true;
        ThemeToggle.InputTransparent = true;
        try
        {
            var app = (App)Application.Current!;
            var dark = app.UserAppTheme != AppTheme.Dark;
            app.UserAppTheme = dark ? AppTheme.Dark : AppTheme.Light;
            Preferences.Default.Set("campusgig_dark_mode", dark);
            RenderMode();
            await ThemeThumb.TranslateToAsync(
                InteractionMotion.ThemeThumbOffset(dark),
                0,
                180,
                Easing.CubicInOut);
        }
        finally
        {
            ThemeToggle.InputTransparent = false;
            themeAnimating = false;
        }
    }

    private async void OnSubmitClicked(object? sender, EventArgs e) => await RunAsync(SubmitAsync);

    private async void OnGoogleClicked(object? sender, EventArgs e) => await RunAsync(async () =>
    {
        var idToken = await googleIdentity.SignInAsync();
        var response = await api.PostAsync<AuthResponse>("auth/social", new GoogleSocialLoginRequest
        {
            IdToken = idToken,
            TrustedDeviceToken = session.TrustedDeviceToken,
        });
        await HandleAuthResponseAsync(response);
    });

    private async Task SubmitAsync()
    {
        var email = EmailEntry.Text?.Trim() ?? "";
        var password = PasswordEntry.Text ?? "";

        if (mode is AuthMode.Login or AuthMode.Register or AuthMode.Forgot or AuthMode.Reset)
            if (string.IsNullOrWhiteSpace(email)) throw new InvalidOperationException("Enter your email address.");

        switch (mode)
        {
            case AuthMode.Login:
                ValidatePassword(password);
                var trustedDeviceToken = await session.GetTrustedDeviceTokenAsync(email);
                await HandleAuthResponseAsync(await api.PostAsync<AuthResponse>("auth/login", new
                {
                    email,
                    password,
                    trustedDeviceToken,
                }));
                break;
            case AuthMode.Register:
                ValidatePassword(password);
                var displayName = NameEntry.Text?.Trim() ?? "";
                if (displayName.Length < 2) throw new InvalidOperationException("Enter your full name.");
                var registration = await api.PostAsync<RegistrationResponse>("auth/register", new
                {
                    email,
                    password,
                    displayName,
                    isStudent = StudentCheckBox.IsChecked,
                });
                await SetModeAsync(AuthMode.Verify);
                if (!string.IsNullOrWhiteSpace(registration.DevelopmentCode)) CodeEntry.Text = registration.DevelopmentCode;
                break;
            case AuthMode.Verify:
                await HandleAuthResponseAsync(await api.PostAsync<AuthResponse>("auth/verify-email", new
                {
                    email,
                    code = RequireCode(),
                }));
                break;
            case AuthMode.Forgot:
                var forgot = await api.PostAsync<ApiMessage>("auth/forgot-password", new { email });
                await SetModeAsync(AuthMode.Reset);
                if (!string.IsNullOrWhiteSpace(forgot.DevelopmentCode)) CodeEntry.Text = forgot.DevelopmentCode;
                ShowStatus(forgot.Message, isError: false);
                break;
            case AuthMode.Reset:
                ValidatePassword(password);
                var reset = await api.PostAsync<ApiMessage>("auth/reset-password", new
                {
                    email,
                    code = RequireCode(),
                    password,
                    mfaCode = string.IsNullOrWhiteSpace(ResetMfaEntry.Text) ? null : ResetMfaEntry.Text.Trim(),
                    recoveryCode = resetRecoveryCode,
                });
                await DisplayAlertAsync("Password updated", reset.Message, "OK");
                await SetModeAsync(AuthMode.Login);
                break;
            case AuthMode.Mfa:
                await HandleAuthResponseAsync(await api.PostAsync<AuthResponse>("auth/mfa/challenge", new
                {
                    challengeToken = mfaChallengeToken,
                    code = RequireCode(),
                    recoveryCode,
                    rememberDevice = RememberCheckBox.IsChecked,
                }));
                break;
        }
    }

    private string RequireCode()
    {
        var code = CodeEntry.Text?.Trim() ?? "";
        if (code.Length < 6) throw new InvalidOperationException("Enter the required verification code.");
        return code;
    }

    private static void ValidatePassword(string password)
    {
        if (password.Length < 8) throw new InvalidOperationException("Password must contain at least eight characters.");
    }

    private async Task HandleAuthResponseAsync(AuthResponse response)
    {
        if (response.RequiresTwoFactor)
        {
            mfaChallengeToken = response.ChallengeToken;
            await SetModeAsync(AuthMode.Mfa);
            return;
        }
        await session.SaveAsync(response);
        ((App)Application.Current!).ShowMain();
    }

    private async Task RunAsync(Func<Task> action)
    {
        SetBusy(true);
        try
        {
            StatusLabel.Text = "";
            StatusPanel.IsVisible = false;
            await action();
        }
        catch (Exception exception) when (exception is CampusGigApiException or GoogleSignInException or InvalidOperationException or HttpRequestException or TaskCanceledException)
        {
            ShowStatus(exception is TaskCanceledException
                ? "The CampusGig API did not respond. Confirm that it is running."
                : exception.Message, isError: true);
            await StatusPanel.FadeToAsync(1, 130, Easing.CubicOut);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void ShowStatus(string message, bool isError)
    {
        StatusLabel.Text = message;
        StatusLabel.TextColor = AppThemeColor(isError ? "#B42318" : "#0F6B4F", isError ? "#FFB4AC" : "#71D7B1");
        StatusPanel.BackgroundColor = AppThemeColor(isError ? "#FFF2F0" : "#EEF6F1", isError ? "#3B201D" : "#203B30");
        StatusPanel.Stroke = AppThemeColor(isError ? "#F2C6C2" : "#CFE0D7", isError ? "#6A3833" : "#385046");
        StatusPanel.IsVisible = !string.IsNullOrWhiteSpace(message);
    }

    private void SetBusy(bool busy)
    {
        submitting = busy;
        if (busy)
        {
            submitButtonText = SubmitButton.Text ?? submitButtonText;
            SubmitButton.Text = "";
        }
        else
        {
            SubmitButton.Text = submitButtonText;
        }
        BusyIndicator.IsVisible = busy;
        BusyIndicator.IsRunning = busy;
        UpdateSubmitState();
        AuthTabs.IsEnabled = !busy;
        GoogleButton.IsEnabled = !busy && googleIdentity.IsAvailable;
    }

    private void OnCodeTextChanged(object? sender, TextChangedEventArgs e)
    {
        if (normalizingCode) return;
        var normalized = AuthFormRules.NormalizeCode(e.NewTextValue, mode == AuthMode.Mfa && recoveryCode);
        if (!string.Equals(normalized, e.NewTextValue, StringComparison.Ordinal))
        {
            normalizingCode = true;
            CodeEntry.Text = normalized;
            normalizingCode = false;
        }
        UpdateSubmitState();
    }

    private void UpdateSubmitState()
    {
        SubmitButton.IsEnabled = !submitting && AuthFormRules.IsReady(
            (AuthFormMode)mode,
            EmailEntry.Text,
            PasswordEntry.Text,
            NameEntry.Text,
            CodeEntry.Text,
            recoveryCode);
        SubmitButton.Opacity = SubmitButton.IsEnabled ? 1 : 0.45;
    }

    private async void OnButtonPressed(object? sender, EventArgs e)
    {
        if (sender is VisualElement element)
            await element.ScaleToAsync(0.985, 45, Easing.CubicOut);
    }

    private async void OnButtonReleased(object? sender, EventArgs e)
    {
        if (sender is VisualElement element)
            await element.ScaleToAsync(1, 90, Easing.CubicOut);
    }
}
