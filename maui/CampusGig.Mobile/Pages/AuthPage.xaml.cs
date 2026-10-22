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
    private bool resetSecondFactorRequired;
    private bool entrancePlayed;
    private bool themeAnimating;
    private bool submitting;
    private bool modeAnimating;
    private bool normalizingCode;
    private bool normalizingResetCode;
    private int renderedCodeLength;
    private int renderedResetCodeLength;
    private string submitButtonText = "Log in";

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
            RenderPasswordStrength();
            RenderPasswordConfirmation();
            UpdateSubmitState();
        };
        ConfirmPasswordEntry.TextChanged += (_, _) =>
        {
            RenderPasswordConfirmation();
            UpdateSubmitState();
        };
        EmailEntry.TextChanged += (_, _) => UpdateSubmitState();
        NameEntry.TextChanged += (_, _) => UpdateSubmitState();
        CodeEntry.TextChanged += OnCodeTextChanged;
        ResetCodeEntry.TextChanged += OnResetCodeTextChanged;
        ResetMfaEntry.TextChanged += OnResetMfaTextChanged;
        StudentCheckBox.CheckedChanged += (_, _) =>
        {
            RenderMode();
            UpdateSubmitState();
        };
        RenderMode();
        GoogleButton.IsEnabled = googleIdentity.IsAvailable;
        ThemeThumb.TranslationX = InteractionMotion.ThemeThumbOffset(IsDarkMode);
        AppVersionLabel.Text = $"Version {AppInfo.Current.VersionString}";
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
        // Authenticated flows (MFA, email verification, and password reset) must
        // be allowed to change mode while the submit operation owns the busy state.
        if (!InteractionMotion.CanStartAuthModeTransition(mode == nextMode, modeAnimating)) return;
        modeAnimating = true;
        var animateTab = (mode is AuthMode.Login or AuthMode.Register) &&
                         (nextMode is AuthMode.Login or AuthMode.Register);
        AuthTabs.IsEnabled = false;
        try
        {
            var movingToRegister = nextMode == AuthMode.Register;
            var tabOffset = InteractionMotion.AuthTabOffset(
                movingToRegister,
                AuthTabs.Width,
                AuthTabs.Padding.Left,
                AuthTabs.Padding.Right);

            if (animateTab)
            {
                var exitOffset = InteractionMotion.AuthFormExitOffset(movingToRegister);
                await Task.WhenAll(
                    FieldsContent.FadeToAsync(0, 90, Easing.CubicIn),
                    FieldsContent.TranslateToAsync(exitOffset, 0, 115, Easing.CubicIn),
                    PageTitle.FadeToAsync(0, 80, Easing.CubicIn),
                    PageSubtitle.FadeToAsync(0, 80, Easing.CubicIn),
                    TabIndicator.TranslateToAsync(tabOffset, 0, 220, Easing.CubicInOut));
            }
            else
            {
                await Task.WhenAll(
                    FieldsContent.FadeToAsync(0, 70, Easing.CubicIn),
                    FieldsContent.TranslateToAsync(0, 5, 70, Easing.CubicIn));
                TabIndicator.TranslationX = tabOffset;
            }

            mode = nextMode;
            StatusLabel.Text = "";
            StatusPanel.IsVisible = false;
            CodeEntry.Text = "";
            ResetCodeEntry.Text = "";
            renderedResetCodeLength = 0;
            if (nextMode is AuthMode.Login or AuthMode.Register)
            {
                PasswordEntry.Text = "";
                ConfirmPasswordEntry.Text = "";
                ResetMfaEntry.Text = "";
                resetRecoveryCode = false;
                resetSecondFactorRequired = false;
            }
            else if (nextMode == AuthMode.Forgot)
            {
                PasswordEntry.Text = "";
                ConfirmPasswordEntry.Text = "";
                ResetMfaEntry.Text = "";
                resetRecoveryCode = false;
                resetSecondFactorRequired = false;
            }
            RenderMode();

            FieldsContent.TranslationX = animateTab
                ? InteractionMotion.AuthFormEntryOffset(movingToRegister)
                : 0;
            FieldsContent.TranslationY = animateTab ? 0 : -3;
            FieldsContent.Opacity = 0;
            PageTitle.Opacity = animateTab ? 0 : 1;
            PageSubtitle.Opacity = animateTab ? 0 : 1;

            await Task.WhenAll(
                FieldsContent.FadeToAsync(1, 170, Easing.CubicOut),
                FieldsContent.TranslateToAsync(0, 0, 210, Easing.CubicOut),
                PageTitle.FadeToAsync(1, 145, Easing.CubicOut),
                PageSubtitle.FadeToAsync(1, 165, Easing.CubicOut));
        }
        finally
        {
            modeAnimating = false;
            AuthTabs.IsEnabled = !submitting;
        }
    }

    private void RenderMode()
    {
        PasswordEntry.ReturnType = mode is AuthMode.Register or AuthMode.Reset
            ? ReturnType.Next
            : ReturnType.Done;
        var tabbed = mode is AuthMode.Login or AuthMode.Register;
        AuthTabs.IsVisible = tabbed;
        var inactiveTabColor = AppThemeColor("#66716B", "#AAB6AF");
        LoginTabButton.TextColor = mode == AuthMode.Login
            ? Color.FromArgb("#0F6B4F") : inactiveTabColor;
        RegisterTabButton.TextColor = mode == AuthMode.Register
            ? Color.FromArgb("#0F6B4F") : inactiveTabColor;
        NameGroup.IsVisible = mode == AuthMode.Register;
        EmailGroup.IsVisible = mode is not AuthMode.Verify and not AuthMode.Mfa and not AuthMode.Reset;
        ResetAccountPanel.IsVisible = mode == AuthMode.Reset;
        ResetAccountLabel.Text = PasswordResetPresentationRules.MaskEmail(EmailEntry.Text);
        StudentGroup.IsVisible = mode == AuthMode.Register;
        CodeGroup.IsVisible = mode is AuthMode.Verify or AuthMode.Mfa ||
                              (mode == AuthMode.Reset && !resetSecondFactorRequired);
        StandardCodeField.IsVisible = mode != AuthMode.Reset;
        ResetCodeField.IsVisible = mode == AuthMode.Reset && !resetSecondFactorRequired;
        ResetCodeHint.IsVisible = ResetCodeField.IsVisible;
        PasswordGroup.IsVisible = mode is AuthMode.Login or AuthMode.Register ||
                                  (mode == AuthMode.Reset && !resetSecondFactorRequired);
        PasswordHint.IsVisible = mode == AuthMode.Reset && !resetSecondFactorRequired;
        PasswordStrengthPanel.IsVisible = PasswordStrengthRules.ShouldShow(
            PasswordEntry.Text, mode is AuthMode.Register ||
                                (mode == AuthMode.Reset && !resetSecondFactorRequired));
        ConfirmPasswordGroup.IsVisible = mode == AuthMode.Reset && !resetSecondFactorRequired;
        ResetMfaGroup.IsVisible = mode == AuthMode.Reset && resetSecondFactorRequired;
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
        AuthenticatorCodeSlots.IsVisible = !recoveryCode;
        RecoveryCodeSurface.IsVisible = recoveryCode;
        CodeEntry.Opacity = recoveryCode ? 1 : 0.02;
        CodeEntry.TextColor = recoveryCode
            ? AppThemeColor("#17211D", "#F2F6F3")
            : Colors.Transparent;
        CodeEntry.Margin = recoveryCode ? new Thickness(34, 0, 12, 0) : new Thickness(0);
        SemanticProperties.SetDescription(
            CodeEntry,
            recoveryCode ? "Account recovery code" : "Six-digit verification code");
        RenderAuthenticatorCodeSlots(recoveryCode ? "" : CodeEntry.Text ?? "");
        renderedCodeLength = recoveryCode ? 0 : CodeEntry.Text?.Length ?? 0;

        (PageTitle.Text, PageSubtitle.Text, SubmitButton.Text) = mode switch
        {
            AuthMode.Login => ("Welcome Back", "Sign in to continue to CampusGig.", "Log in"),
            AuthMode.Register => ("Create Your Account", "Join CampusGig and book trusted student services.", $"Create {(StudentCheckBox.IsChecked ? "student" : "client")} account"),
            AuthMode.Verify => ("Verify your email", $"Enter the code sent to {EmailEntry.Text?.Trim()}.", "Verify email"),
            AuthMode.Forgot => ("Forgot password?", "We'll send a reset code to your account email.", "Send reset code"),
            AuthMode.Reset => ("Create a new password", "Enter your code and choose a secure new password.", "Update password"),
            AuthMode.Mfa => ("Two-factor verification", recoveryCode ? "Enter one of your saved recovery codes." : "Enter the current code from your authenticator app.", "Verify and sign in"),
            _ => throw new InvalidOperationException(),
        };
        if (mode == AuthMode.Reset)
        {
            PageTitle.Text = resetSecondFactorRequired ? "Confirm it's you" : "Create a new password";
            PageSubtitle.Text = resetSecondFactorRequired
                ? "Complete the final security check for this protected account."
                : "Enter the six-digit code and choose a secure new password.";
            SubmitButton.Text = resetSecondFactorRequired ? "Confirm reset" : "Update password";
        }
        if (BusyIndicator.IsRunning)
        {
            submitButtonText = SubmitButton.Text;
            SubmitButton.Text = "";
        }
        RenderPasswordStrength();
        RenderPasswordConfirmation();
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
    private async void OnChangeResetEmailClicked(object? sender, EventArgs e) => await SetModeAsync(AuthMode.Forgot);

    private void OnShowPasswordClicked(object? sender, EventArgs e)
    {
        PasswordEntry.IsPassword = PasswordVisibilityRules.Toggle(PasswordEntry.IsPassword);
        ShowPasswordButton.Text = PasswordVisibilityRules.ButtonLabel(PasswordEntry.IsPassword);
        SemanticProperties.SetDescription(
            ShowPasswordButton,
            PasswordEntry.IsPassword ? "Show password" : "Hide password");
    }

    private void OnShowConfirmPasswordClicked(object? sender, EventArgs e)
    {
        ConfirmPasswordEntry.IsPassword = PasswordVisibilityRules.Toggle(ConfirmPasswordEntry.IsPassword);
        ShowConfirmPasswordButton.Text = PasswordVisibilityRules.ButtonLabel(ConfirmPasswordEntry.IsPassword);
        SemanticProperties.SetDescription(
            ShowConfirmPasswordButton,
            ConfirmPasswordEntry.IsPassword ? "Show password confirmation" : "Hide password confirmation");
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
        ResetMfaLabel.Text = resetRecoveryCode ? "RECOVERY CODE" : "AUTHENTICATOR CODE";
        ResetMfaEntry.Placeholder = resetRecoveryCode ? "ABCDE-12345" : "000000";
        ResetMfaEntry.Keyboard = resetRecoveryCode ? Keyboard.Default : Keyboard.Numeric;
        UpdateSubmitState();
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
            DeviceName = DeviceInfo.Name,
        });
        await HandleAuthResponseAsync(response);
    });

    private async void OnBrowseAsGuestClicked(object? sender, EventArgs e)
    {
        if (submitting) return;
        BrowseGuestButton.IsEnabled = false;
        try { await ((App)Application.Current!).EnterGuestModeAsync(); }
        finally { BrowseGuestButton.IsEnabled = true; }
    }

    private async Task SubmitAsync()
    {
        var email = EmailEntry.Text?.Trim() ?? "";
        var password = PasswordEntry.Text ?? "";

        if (mode is AuthMode.Login or AuthMode.Register or AuthMode.Forgot or AuthMode.Reset)
            if (string.IsNullOrWhiteSpace(email)) throw new InvalidOperationException("Enter your email address.");
        if (mode is (AuthMode.Login or AuthMode.Register or AuthMode.Forgot) &&
            !AuthFormRules.IsValidEmail(email))
            throw new InvalidOperationException("Enter a valid email address.");

        switch (mode)
        {
            case AuthMode.Login:
                ValidatePassword(password);
                var trustedDeviceToken = await session.GetTrustedDeviceTokenAsync(email);
                await HandleAuthResponseAsync(await api.PostAsync<AuthResponse>("auth/login", new LoginRequest
                {
                    Email = email,
                    Password = password,
                    TrustedDeviceToken = trustedDeviceToken,
                    DeviceName = DeviceInfo.Name,
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
                    clientType = "MOBILE",
                    deviceName = DeviceInfo.Name,
                }));
                break;
            case AuthMode.Forgot:
                var forgot = await api.PostAsync<ApiMessage>("auth/forgot-password", new { email });
                await SetModeAsync(AuthMode.Reset);
                if (!string.IsNullOrWhiteSpace(forgot.DevelopmentCode)) ResetCodeEntry.Text = forgot.DevelopmentCode;
                ResetCodeEntry.Focus();
                break;
            case AuthMode.Reset:
                ValidatePassword(password);
                if (!PasswordStrengthRules.ConfirmationMatches(password, ConfirmPasswordEntry.Text))
                {
                    await ShakeAsync(ConfirmPasswordGroup);
                    throw new InvalidOperationException("Enter the same password again to confirm it.");
                }
                ApiMessage reset;
                try
                {
                    reset = await api.PostAsync<ApiMessage>("auth/reset-password", new
                    {
                        email,
                        code = RequireCode(),
                        password,
                        mfaCode = string.IsNullOrWhiteSpace(ResetMfaEntry.Text) ? null : ResetMfaEntry.Text.Trim(),
                        recoveryCode = resetRecoveryCode,
                    });
                }
                catch (CampusGigApiException exception) when (
                    !resetSecondFactorRequired &&
                    PasswordResetPresentationRules.RequiresSecondFactor(exception.Message))
                {
                    await ShowResetSecondFactorAsync();
                    return;
                }
                await FormContent.ScaleToAsync(0.985, 70, Easing.CubicIn);
                await FormContent.ScaleToAsync(1, 150, Easing.CubicOut);
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
                    clientType = "MOBILE",
                    deviceName = DeviceInfo.Name,
                }));
                break;
        }
    }

    private string RequireCode()
    {
        var code = mode == AuthMode.Reset
            ? ResetCodeEntry.Text?.Trim() ?? ""
            : CodeEntry.Text?.Trim() ?? "";
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
        try
        {
            await session.SaveAsync(response);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            System.Diagnostics.Debug.WriteLine($"Authenticated session could not be stored: {exception}");
            throw new InvalidOperationException(
                "CampusGig signed you in, but this device could not securely save the session. Try logging in once more.",
                exception);
        }

        try
        {
            await MainThread.InvokeOnMainThreadAsync(() =>
                ((App)Application.Current!).ShowMain());
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Authenticated home screen could not open: {exception}");
            throw new InvalidOperationException(
                "CampusGig signed you in, but the main screen could not open.",
                exception);
        }
    }

    private async Task RunAsync(Func<Task> action)
    {
        if (submitting) return;
        SetBusy(true);
        try
        {
            StatusLabel.Text = "";
            StatusPanel.IsVisible = false;
            await action();
        }
        catch (Exception exception) when (exception is CampusGigApiException or GoogleSignInException or InvalidOperationException or HttpRequestException or TaskCanceledException or System.Text.Json.JsonException or ArgumentException)
        {
            var message = exception switch
            {
                TaskCanceledException => "CampusGig is taking too long to respond. Check your connection and try again.",
                HttpRequestException => "Unable to connect to CampusGig. Check your connection and try again.",
                _ => exception.Message,
            };
            ShowStatus(message, isError: true);
            await StatusPanel.FadeToAsync(1, 130, Easing.CubicOut);
        }
        catch (Exception exception)
        {
            System.Diagnostics.Debug.WriteLine($"Authentication flow failed ({exception.GetType().Name}): {exception}");
            var message = exception.GetBaseException() switch
            {
                OperationCanceledException =>
                    "CampusGig could not finish opening your account. Please tap Log in again.",
                { Message.Length: > 0 } cause => cause.Message,
                var cause =>
                    $"CampusGig could not finish opening your account ({cause.GetType().Name}).",
            };
            ShowStatus(message, isError: true);
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
        BrowseGuestButton.IsEnabled = !busy;
    }

    private async void OnCodeTextChanged(object? sender, TextChangedEventArgs e)
    {
        if (normalizingCode) return;
        var normalized = AuthFormRules.NormalizeCode(e.NewTextValue, mode == AuthMode.Mfa && recoveryCode);
        if (!string.Equals(normalized, e.NewTextValue, StringComparison.Ordinal))
        {
            normalizingCode = true;
            CodeEntry.Text = normalized;
            normalizingCode = false;
        }
        if (!recoveryCode)
        {
            RenderAuthenticatorCodeSlots(normalized);
            if (normalized.Length > renderedCodeLength)
            {
                var enteredIndex = normalized.Length - 1;
                await AuthenticatorCodeLabels[enteredIndex].ScaleToAsync(1.16, 55, Easing.CubicOut);
                await AuthenticatorCodeLabels[enteredIndex].ScaleToAsync(1, 100, Easing.CubicOut);
            }
            renderedCodeLength = normalized.Length;
        }
        UpdateSubmitState();
    }

    private void RenderAuthenticatorCodeSlots(string code)
    {
        var normalized = AuthFormRules.NormalizeCode(code, recoveryCode: false);
        var labels = AuthenticatorCodeLabels;
        var boxes = AuthenticatorCodeBoxes;
        for (var index = 0; index < labels.Length; index++)
        {
            var filled = index < normalized.Length;
            labels[index].Text = filled ? normalized[index].ToString() : "";
            labels[index].TextColor = AppThemeColor("#17211D", "#F2F6F3");
            boxes[index].Stroke = AppThemeColor(filled ? "#72B79D" : "#DDE3DF", filled ? "#71D7B1" : "#385046");
            boxes[index].BackgroundColor = AppThemeColor(filled ? "#F1F8F4" : "#FCFDFC", filled ? "#203B30" : "#151D19");
        }
    }

    private async void OnResetCodeTextChanged(object? sender, TextChangedEventArgs e)
    {
        if (normalizingResetCode) return;
        var normalized = AuthFormRules.NormalizeCode(e.NewTextValue, recoveryCode: false);
        if (!string.Equals(normalized, e.NewTextValue, StringComparison.Ordinal))
        {
            normalizingResetCode = true;
            ResetCodeEntry.Text = normalized;
            normalizingResetCode = false;
        }

        var labels = ResetCodeLabels;
        var boxes = ResetCodeBoxes;
        for (var index = 0; index < labels.Length; index++)
        {
            var filled = index < normalized.Length;
            labels[index].Text = filled ? normalized[index].ToString() : "";
            labels[index].TextColor = AppThemeColor("#17211D", "#F2F6F3");
            boxes[index].Stroke = AppThemeColor(filled ? "#72B79D" : "#DDE3DF", filled ? "#71D7B1" : "#385046");
            boxes[index].BackgroundColor = AppThemeColor(filled ? "#F1F8F4" : "#FCFDFC", filled ? "#203B30" : "#151D19");
        }

        if (normalized.Length > renderedResetCodeLength)
        {
            var enteredIndex = normalized.Length - 1;
            await labels[enteredIndex].ScaleToAsync(1.18, 55, Easing.CubicOut);
            await labels[enteredIndex].ScaleToAsync(1, 105, Easing.CubicOut);
            if (normalized.Length == 6 && mode == AuthMode.Reset && !resetSecondFactorRequired)
                PasswordEntry.Focus();
        }
        renderedResetCodeLength = normalized.Length;
        UpdateSubmitState();
    }

    private void OnResetMfaTextChanged(object? sender, TextChangedEventArgs e)
    {
        var normalized = AuthFormRules.NormalizeCode(e.NewTextValue, resetRecoveryCode);
        if (!string.Equals(normalized, e.NewTextValue, StringComparison.Ordinal))
        {
            ResetMfaEntry.TextChanged -= OnResetMfaTextChanged;
            ResetMfaEntry.Text = normalized;
            ResetMfaEntry.TextChanged += OnResetMfaTextChanged;
        }
        UpdateSubmitState();
    }

    private void UpdateSubmitState()
    {
        var ready = AuthFormRules.IsReady(
            (AuthFormMode)mode,
            EmailEntry.Text,
            PasswordEntry.Text,
            NameEntry.Text,
            mode == AuthMode.Reset ? ResetCodeEntry.Text : CodeEntry.Text,
            recoveryCode);
        if (mode == AuthMode.Reset && !resetSecondFactorRequired)
            ready &= PasswordStrengthRules.ConfirmationMatches(PasswordEntry.Text, ConfirmPasswordEntry.Text);
        if (mode == AuthMode.Reset && resetSecondFactorRequired)
            ready = AuthFormRules.NormalizeCode(ResetMfaEntry.Text, resetRecoveryCode).Length ==
                    (resetRecoveryCode ? 10 : 6);
        SubmitButton.IsEnabled = !submitting && ready;
        SubmitButton.Opacity = SubmitButton.IsEnabled ? 1 : 0.45;
    }

    private void RenderPasswordStrength()
    {
        var strength = PasswordStrengthRules.Evaluate(PasswordEntry.Text);
        PasswordStrengthPanel.IsVisible = PasswordStrengthRules.ShouldShow(
            PasswordEntry.Text, mode == AuthMode.Register ||
                                (mode == AuthMode.Reset && !resetSecondFactorRequired));
        PasswordStrengthBar.Progress = strength.Progress;
        PasswordStrengthBar.ProgressColor = Color.FromArgb(IsDarkMode ? strength.DarkColor : strength.LightColor);
        PasswordStrengthLabel.Text = strength.Label;
        PasswordStrengthLabel.TextColor = PasswordStrengthBar.ProgressColor;
    }

    private void RenderPasswordConfirmation()
    {
        if (mode != AuthMode.Reset || string.IsNullOrEmpty(ConfirmPasswordEntry.Text))
        {
            ConfirmPasswordHint.Text = "Passwords must match";
            ConfirmPasswordHint.TextColor = AppThemeColor("#66716B", "#AAB6AF");
            return;
        }

        var matches = PasswordStrengthRules.ConfirmationMatches(PasswordEntry.Text, ConfirmPasswordEntry.Text);
        ConfirmPasswordHint.Text = matches ? "Passwords match" : "Passwords do not match";
        ConfirmPasswordHint.TextColor = Color.FromArgb(matches
            ? (IsDarkMode ? "#71D7B1" : "#0F8060")
            : (IsDarkMode ? "#FF9B91" : "#C74335"));
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

    private Label[] ResetCodeLabels =>
        [CodeDigit0, CodeDigit1, CodeDigit2, CodeDigit3, CodeDigit4, CodeDigit5];

    private Label[] AuthenticatorCodeLabels =>
        [AuthCodeDigit0, AuthCodeDigit1, AuthCodeDigit2, AuthCodeDigit3, AuthCodeDigit4, AuthCodeDigit5];

    private Border[] ResetCodeBoxes =>
        [CodeBox0, CodeBox1, CodeBox2, CodeBox3, CodeBox4, CodeBox5];

    private Border[] AuthenticatorCodeBoxes =>
        [AuthCodeBox0, AuthCodeBox1, AuthCodeBox2, AuthCodeBox3, AuthCodeBox4, AuthCodeBox5];

    private async Task ShowResetSecondFactorAsync()
    {
        await FieldsContent.FadeToAsync(0, 80, Easing.CubicIn);
        resetSecondFactorRequired = true;
        RenderMode();
        ShowStatus("Reset code accepted. Complete the two-factor check.", isError: false);
        FieldsContent.TranslationY = 6;
        await Task.WhenAll(
            FieldsContent.FadeToAsync(1, 170, Easing.CubicOut),
            FieldsContent.TranslateToAsync(0, 0, 190, Easing.CubicOut));
        ResetMfaEntry.Focus();
    }

    private static async Task ShakeAsync(VisualElement element)
    {
        await element.TranslateToAsync(-8, 0, 45, Easing.CubicOut);
        await element.TranslateToAsync(8, 0, 55, Easing.CubicInOut);
        await element.TranslateToAsync(-4, 0, 45, Easing.CubicInOut);
        await element.TranslateToAsync(0, 0, 55, Easing.CubicOut);
    }
}
