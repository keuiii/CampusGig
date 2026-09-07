using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using CampusGig.Mobile.Controls;
using Microsoft.Maui.Controls.Shapes;

namespace CampusGig.Mobile.Pages;

public partial class ProfilePage : ContentPage, ITabLifecycle
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly IGoogleIdentityService googleIdentity;
    private List<SchoolItem> schools = [];
    private SchoolItem? selectedSchool;
    private StudentProfile? student;
    private VerificationRequest? verification;
    private FileResult? chosenStudentIdFile;
    private MfaStatus mfa = new();
    private bool entrancePlayed;
    private bool buttonMotionAttached;
    private string savedSchoolId = "";
    private string savedProgram = "";
    private string savedYear = "";
    private string savedBio = "";
    private string savedHeadline = "";
    private string savedProviderBio = "";
    private string savedSkills = "";
    private bool savedAvailability;
    private PasswordChangeResult? passwordChangeRequest;
    private IDispatcherTimer? passwordStatusTimer;
    private bool passwordStatusLoading;
    private bool profileLoading;

    public ProfilePage(CampusGigApi api, SessionService session, IGoogleIdentityService googleIdentity)
    {
        InitializeComponent();
        this.api = api;
        this.session = session;
        this.googleIdentity = googleIdentity;
        SignOutButton.Command = new Command(async () => await SignOutAsync());
        ProgramEntry.TextChanged += (_, _) => UpdateSaveButtons();
        YearEntry.TextChanged += (_, _) => UpdateSaveButtons();
        BioEntry.TextChanged += (_, _) => UpdateSaveButtons();
        HeadlineEntry.TextChanged += (_, _) => UpdateSaveButtons();
        ProviderBioEntry.TextChanged += (_, _) => UpdateSaveButtons();
        SkillsEntry.TextChanged += (_, _) => UpdateSaveButtons();
        AvailableSwitch.Toggled += (_, _) => UpdateSaveButtons();
        CurrentPasswordEntry.TextChanged += (_, _) => UpdateSecurityButtons();
        NewPasswordEntry.TextChanged += (_, _) => UpdateSecurityButtons();
        ConfirmPasswordEntry.TextChanged += (_, _) => UpdateSecurityButtons();
        PasswordMfaEntry.TextChanged += (_, _) => UpdateSecurityButtons();
        RecoveryCodeSwitch.Toggled += (_, _) => UpdateSecurityButtons();
        MfaSetupCodeEntry.TextChanged += (_, _) => UpdateSecurityButtons();
        VerificationButton.IsEnabled = false;
        UpdatePasswordButton.IsEnabled = false;
        ConfirmMfaButton.IsEnabled = false;
    }

    public async Task OnTabAppearingAsync()
    {
        BindAccount();
        RenderPasswordChangeRequest();

        if (!buttonMotionAttached)
        {
            buttonMotionAttached = true;
            foreach (var button in ProfileContent.GetVisualTreeDescendants().OfType<Button>())
            {
                button.Pressed += OnButtonPressed;
                button.Released += OnButtonReleased;
            }
        }

        if (schools.Count == 0)
            await LoadAsync();

        if (!entrancePlayed)
        {
            entrancePlayed = true;
            ProfileContent.Opacity = 0;
            ProfileContent.TranslationY = 12;
            await Task.WhenAll(
                ProfileContent.FadeToAsync(1, 190, Easing.CubicOut),
                ProfileContent.TranslateToAsync(0, 0, 220, Easing.CubicOut));
        }
    }

    public Task OnTabDisappearingAsync()
    {
        StopPasswordStatusPolling();
        return Task.CompletedTask;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await OnTabAppearingAsync();
    }

    public async Task RefreshTabAsync()
    {
        BindAccount();
        if (schools.Count == 0)
            await LoadAsync();
    }

    private void BindAccount()
    {
        var user = session.User;
        NameLabel.Text = user?.DisplayName ?? "CampusGig user";
        EmailLabel.Text = user?.Email ?? "";
        RolesLabel.Text = user is not null && user.Roles.Count > 0
            ? string.Join(" · ", user.Roles)
            : "CLIENT";

        InitialsLabel.Text = string.Join("", (user?.DisplayName ?? "C")
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Take(2)
            .Select(p => char.ToUpperInvariant(p[0])));

        if (user?.HasAvatar == true)
        {
            AvatarImage.Source = ProfileImageRules.BuildUrl(
                api.BaseUrl, user.Id, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            AvatarImage.IsVisible = true;
            InitialsLabel.IsVisible = false;
        }
        else
        {
            AvatarImage.Source = null;
            AvatarImage.IsVisible = false;
            InitialsLabel.IsVisible = true;
        }

        ApiUrlEntry.Text = api.BaseUrl;
        var isStudent = user?.Roles.Contains("STUDENT") == true;
        StudentSection.IsVisible = isStudent;
        ClientInfoCard.IsVisible = !isStudent;
        ProviderRowSubtitle.Text = user?.Roles.Contains("PROVIDER") == true
            ? "Headline, bio, skills and availability"
            : "Unlocks after student verification";

        var isDark = ((App)Application.Current!).UserAppTheme == AppTheme.Dark;
        ThemeThumb.TranslationX = isDark ? 30 : 0;
        UpdateProgressBar();
        UpdateSaveButtons();
    }

    private async Task LoadAsync()
    {
        if (!RefreshRequestRules.CanStart(profileLoading))
        {
            Refresh.IsRefreshing = false;
            return;
        }

        profileLoading = true;
        Exception? loadError = null;
        try
        {
            var account = await api.GetAsync<AuthUser>("auth/me");
            await session.UpdateUserAsync(account);
            BindAccount();
            schools = (await api.GetAsync<ApiList<SchoolItem>>("schools")).Data;

            if (StudentSection.IsVisible)
            {
                student = (await api.GetAsync<ApiResult<StudentProfile?>>("profile/student")).Data;
                verification = (await api.GetAsync<ApiResult<VerificationRequest?>>("profile/student/verification")).Data;

                if (student is not null)
                {
                    selectedSchool = schools.FirstOrDefault(x => x.Id == student.SchoolId);
                    ProgramEntry.Text = student.Program;
                    YearEntry.Text = student.YearLevel?.ToString();
                    BioEntry.Text = student.Bio;
                    SaveStudentSnapshot();
                }
                else if (schools.Count > 0 && selectedSchool is null)
                {
                    selectedSchool = schools.First();
                    SaveStudentSnapshot();
                }

                UpdateSchoolChips();
                RenderVerification();
            }

            if (session.User?.Roles.Contains("PROVIDER") == true)
            {
                var provider = (await api.GetAsync<ApiResult<ProviderProfile?>>("provider/profile")).Data;
                HeadlineEntry.Text = provider?.Headline ?? "";
                ProviderBioEntry.Text = provider?.Bio ?? "";
                SkillsEntry.Text = provider is null ? "" : string.Join(", ", provider.Skills);
                AvailableSwitch.IsToggled = provider?.IsAvailable ?? true;
                SaveProviderSnapshot();
            }

            UpdateSaveButtons();

            mfa = await api.GetAsync<MfaStatus>("auth/mfa/status");
            RenderMfa();
            passwordChangeRequest = await api.GetOptionalAsync<PasswordChangeResult>("auth/password-change/pending");
            RenderPasswordChangeRequest();
            UpdateProgressBar();
        }
        catch (Exception ex)
        {
            loadError = ex;
        }
        finally
        {
            profileLoading = false;
            Refresh.IsRefreshing = false;
        }

        if (loadError is not null)
            await DisplayAlertAsync("Unable to load profile", loadError.Message, "OK");
    }

    private void UpdateSchoolChips()
    {
        SchoolChipsContainer.Children.Clear();
        var isDark = ((App)Application.Current!).UserAppTheme == AppTheme.Dark;
        foreach (var school in schools)
        {
            var isSelected = selectedSchool?.Id == school.Id;
            var border = new Border
            {
                Padding = new Thickness(16, 8),
                StrokeThickness = 1,
                StrokeShape = new RoundRectangle { CornerRadius = 18 },
                Stroke = isSelected ? Color.FromArgb("#08543D") : Color.FromArgb("#DDE4DF"),
                BackgroundColor = isSelected
                    ? Color.FromArgb("#08543D")
                    : (isDark ? Color.FromArgb("#151D19") : Colors.White),
            };

            var label = new Label
            {
                Text = !string.IsNullOrWhiteSpace(school.ShortName) ? school.ShortName : school.Name,
                FontSize = 11,
                FontAttributes = FontAttributes.Bold,
                TextColor = isSelected ? Colors.White : (isDark ? Color.FromArgb("#F2F6F3") : Color.FromArgb("#111814")),
                VerticalTextAlignment = TextAlignment.Center,
                HorizontalTextAlignment = TextAlignment.Center,
            };

            border.Content = label;
            var tap = new TapGestureRecognizer();
            tap.Tapped += async (_, _) =>
            {
                await border.ScaleToAsync(0.92, 50, Easing.CubicOut);
                await border.ScaleToAsync(1.0, 60, Easing.CubicIn);
                selectedSchool = school;
                UpdateSchoolChips();
                UpdateSaveButtons();
            };
            border.GestureRecognizers.Add(tap);
            SchoolChipsContainer.Children.Add(border);
        }
    }

    private void UpdateProgressBar()
    {
        var status = student?.VerificationStatus ?? verification?.Status;
        int completion = status == "APPROVED" ? 80 : (student is not null ? 55 : 20);
        CompletionLabel.Text = $"{completion}% profile complete";
        var baseWidth = ProfileCard.Width > 0 ? (ProfileCard.Width - 40) : 260;
        ProgressBarFill.WidthRequest = Math.Max(24, baseWidth * (completion / 100.0));
    }

    private void SaveStudentSnapshot()
    {
        savedSchoolId = selectedSchool?.Id ?? "";
        savedProgram = ProgramEntry.Text?.Trim() ?? "";
        savedYear = YearEntry.Text?.Trim() ?? "";
        savedBio = BioEntry.Text?.Trim() ?? "";
    }

    private void SaveProviderSnapshot()
    {
        savedHeadline = HeadlineEntry.Text?.Trim() ?? "";
        savedProviderBio = ProviderBioEntry.Text?.Trim() ?? "";
        savedSkills = SkillsEntry.Text?.Trim() ?? "";
        savedAvailability = AvailableSwitch.IsToggled;
    }

    private void UpdateSaveButtons()
    {
        var studentChanged = savedSchoolId != (selectedSchool?.Id ?? "") ||
                             savedProgram != (ProgramEntry.Text?.Trim() ?? "") ||
                             savedYear != (YearEntry.Text?.Trim() ?? "") ||
                             savedBio != (BioEntry.Text?.Trim() ?? "");
        SetSaveButtonState(SaveStudentButton, ProfileActionRules.CanSaveStudent(
            studentChanged, selectedSchool?.Id, ProgramEntry.Text, YearEntry.Text), "#0F6B4F");

        var providerChanged = savedHeadline != (HeadlineEntry.Text?.Trim() ?? "") ||
                              savedProviderBio != (ProviderBioEntry.Text?.Trim() ?? "") ||
                              savedSkills != (SkillsEntry.Text?.Trim() ?? "") ||
                              savedAvailability != AvailableSwitch.IsToggled;
        var providerValid = (HeadlineEntry.Text?.Trim().Length ?? 0) >= 3 &&
                            (ProviderBioEntry.Text?.Trim().Length ?? 0) >= 20 &&
                            !string.IsNullOrWhiteSpace(SkillsEntry.Text);
        SetSaveButtonState(SaveProviderButton, providerChanged && providerValid, "#08543D");
    }

    private static void SetSaveButtonState(BusyButton button, bool enabled, string activeColor)
    {
        button.IsEnabled = enabled;
        button.FillColor = Color.FromArgb(activeColor);
    }

    private void UpdateSecurityButtons()
    {
        var current = CurrentPasswordEntry.Text ?? "";
        var next = NewPasswordEntry.Text ?? "";
        var confirmation = ConfirmPasswordEntry.Text ?? "";
        var mfaCode = PasswordMfaEntry.Text?.Trim() ?? "";
        UpdatePasswordButton.IsEnabled = ProfileActionRules.CanChangePassword(
            current, next, confirmation, mfa.Enabled, mfaCode);
        ConfirmMfaButton.IsEnabled = ProfileActionRules.CanConfirmMfa(MfaSetupCodeEntry.Text);
    }

    private void UpdateVerificationButton()
    {
        VerificationButton.FillColor = Color.FromArgb("#0F6B4F");
        VerificationButton.IsEnabled = ProfileActionRules.CanSubmitVerification(
            student is not null, chosenStudentIdFile is not null);
    }

    private void RenderVerification()
    {
        var status = student?.VerificationStatus ?? verification?.Status ?? "NOT_SUBMITTED";
        if (status is "APPROVED")
        {
            VerificationStatusBadge.IsVisible = true;
            VerificationStatusBadge.BackgroundColor = Color.FromArgb("#E2F1E8");
            VerificationStatusLabel.TextColor = Color.FromArgb("#08543D");
            VerificationStatusLabel.Text = "✓ Student verified · Provider access unlocked";
            IdPickerBox.IsVisible = false;
            VerificationButton.IsVisible = false;
            VerificationReasonLabel.IsVisible = false;
        }
        else if (status is "PENDING")
        {
            VerificationStatusBadge.IsVisible = true;
            VerificationStatusBadge.BackgroundColor = Color.FromArgb("#FEF6EE");
            VerificationStatusLabel.TextColor = Color.FromArgb("#B54708");
            VerificationStatusLabel.Text = "Review in progress · Submitted recently";
            IdPickerBox.IsVisible = false;
            VerificationButton.IsVisible = false;
            VerificationReasonLabel.IsVisible = false;
        }
        else if (status is "REJECTED")
        {
            VerificationStatusBadge.IsVisible = true;
            VerificationStatusBadge.BackgroundColor = Color.FromArgb("#FFF0ED");
            VerificationStatusLabel.TextColor = Color.FromArgb("#B42318");
            VerificationStatusLabel.Text = "Previous request needs attention";
            VerificationReasonLabel.Text = verification?.RejectionReason ?? "Please upload a clearer ID.";
            VerificationReasonLabel.IsVisible = true;
            IdPickerBox.IsVisible = true;
            VerificationButton.IsVisible = true;
        }
        else
        {
            VerificationStatusBadge.IsVisible = false;
            VerificationReasonLabel.IsVisible = false;
            IdPickerBox.IsVisible = true;
            VerificationButton.IsVisible = true;
        }
        UpdateVerificationButton();
    }

    private void RenderMfa()
    {
        MfaBadge.Text = MfaPresentationRules.StatusLabel(mfa.Enabled);
        MfaDetailsLabel.Text = MfaPresentationRules.Summary(
            mfa.Enabled, mfa.RecoveryCodesRemaining, mfa.TrustedDeviceCount);
        var isDark = Application.Current?.RequestedTheme == AppTheme.Dark;
        MfaBadgeContainer.BackgroundColor = Color.FromArgb(mfa.Enabled
            ? (isDark ? "#1D513E" : "#D9F2E7")
            : (isDark ? "#28352F" : "#E8EEEB"));
        MfaBadge.TextColor = Color.FromArgb(mfa.Enabled
            ? (isDark ? "#91E3C2" : "#087052")
            : (isDark ? "#B8C5BF" : "#66716B"));
        SetupMfaButton.IsVisible = !mfa.Enabled && !MfaSetupPanel.IsVisible;
        EnabledMfaActions.IsVisible = mfa.Enabled;
        PasswordMfaPanel.IsVisible = mfa.Enabled;
        UpdateSecurityButtons();
    }

    private async void OnThemeToggled(object? sender, EventArgs e)
    {
        var isDark = ((App)Application.Current!).UserAppTheme == AppTheme.Dark;
        var nextDark = !isDark;
        ((App)Application.Current!).UserAppTheme = nextDark ? AppTheme.Dark : AppTheme.Light;
        Preferences.Default.Set("campusgig_dark_mode", nextDark);
        MainTabbedPage.Instance?.RefreshTheme();
        await ThemeThumb.TranslateToAsync(nextDark ? 30 : 0, 0, 160, Easing.CubicOut);
        UpdateSchoolChips();
    }

    private async void OnSaveStudentClicked(object? sender, EventArgs e)
    {
        if (selectedSchool is null || !int.TryParse(YearEntry.Text, out var year) || year is < 1 or > 10 || string.IsNullOrWhiteSpace(ProgramEntry.Text))
        {
            await DisplayAlertAsync("Check student profile", "Choose a school, enter your program, and use a year level from 1 to 10.", "OK");
            return;
        }

        await RunAsync(sender as BusyButton, "Campus identity updated", async () =>
        {
            student = (await api.PutAsync<ApiResult<StudentProfile>>("profile/student", new
            {
                schoolId = selectedSchool.Id,
                program = ProgramEntry.Text.Trim(),
                yearLevel = year,
                bio = BioEntry.Text?.Trim()
            })).Data;
            SaveStudentSnapshot();
            UpdateProgressBar();
            UpdateSaveButtons();
        }, successMessage: "Your school, program, year level, and bio changes were saved successfully.");
    }

    private async void OnSaveProviderClicked(object? sender, EventArgs e)
    {
        var skills = (SkillsEntry.Text ?? "")
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if ((HeadlineEntry.Text?.Trim().Length ?? 0) < 3 || (ProviderBioEntry.Text?.Trim().Length ?? 0) < 20 || skills.Length == 0)
        {
            await DisplayAlertAsync("Check provider profile", "Use a headline, a bio of at least 20 characters, and at least one skill.", "OK");
            return;
        }

        await RunAsync(sender as BusyButton, "Provider profile updated", async () =>
        {
            await api.PutAsync<ApiResult<ProviderProfile>>("provider/profile", new
            {
                headline = HeadlineEntry.Text!.Trim(),
                bio = ProviderBioEntry.Text!.Trim(),
                skills,
                isAvailable = AvailableSwitch.IsToggled
            });
            SaveProviderSnapshot();
            UpdateSaveButtons();
        }, successMessage: "Your provider headline, bio, skills, and availability were updated successfully.");
    }

    private async void OnVerificationClicked(object? sender, EventArgs e)
    {
        if (student is null)
        {
            await DisplayAlertAsync("Save your profile first", "Student information is required before verification.", "OK");
            return;
        }

        var file = await FilePicker.Default.PickAsync(new PickOptions { PickerTitle = "Choose student ID" });
        if (file is null) return;

        var fileSize = await GetFileSizeAsync(file);
        if (MobileFileRules.ExceedsProfileUploadLimit(fileSize))
        {
            await DisplayAlertAsync("File too large", "Choose a file no larger than 5 MB.", "OK");
            return;
        }

        chosenStudentIdFile = file;
        SelectedIdNameLabel.Text = file.FileName;
        SelectedIdSizeLabel.Text = MobileFileRules.DescribeSelection(fileSize);
        UpdateVerificationButton();
    }

    private async void OnSubmitVerificationClicked(object? sender, EventArgs e)
    {
        if (chosenStudentIdFile is null)
        {
            await DisplayAlertAsync("No document chosen", "Tap 'Choose student ID' to select a document before submitting.", "OK");
            return;
        }

        await RunAsync(sender as BusyButton, "Student ID submitted", async () =>
        {
            verification = (await api.PostMultipartAsync<ApiResult<VerificationRequest>>(
                "profile/student/verification",
                new Dictionary<string, string?>(),
                [Upload("studentId", chosenStudentIdFile)])).Data;

            if (student is not null) student.VerificationStatus = "PENDING";
            chosenStudentIdFile = null;
            SelectedIdNameLabel.Text = "Choose student ID";
            SelectedIdSizeLabel.Text = "JPG, PNG, or PDF · maximum 5 MB";
            RenderVerification();
            UpdateProgressBar();
        }, successMessage: "Your student ID was submitted securely and is now waiting for administrator review.");
    }

    private async void OnProviderProfileRowClicked(object? sender, EventArgs e)
    {
        var user = session.User;
        try
        {
            user = await api.GetAsync<AuthUser>("auth/me");
            await session.UpdateUserAsync(user);
            BindAccount();
        }
        catch (CampusGigApiException)
        {
        }
        if (user?.Roles.Contains("PROVIDER") != true)
        {
            await DisplayAlertAsync("Provider access is locked", "Complete student verification first. Once approved, CampusGig automatically adds the Provider role to your account.", "OK");
            return;
        }

        ProviderPanel.IsVisible = !ProviderPanel.IsVisible;
        SettingsPanel.IsVisible = false;
        SettingsChevron.Text = "›";
        ProviderChevron.Text = ProviderPanel.IsVisible ? "⌃" : "›";
        if (ProviderPanel.IsVisible)
        {
            ProviderPanel.Opacity = 0;
            ProviderPanel.TranslationY = -8;
            await Task.WhenAll(
                ProviderPanel.FadeToAsync(1, 170, Easing.CubicOut),
                ProviderPanel.TranslateToAsync(0, 0, 190, Easing.CubicOut));
        }
    }

    private async void OnAccountSettingsRowClicked(object? sender, EventArgs e)
    {
        SettingsPanel.IsVisible = !SettingsPanel.IsVisible;
        ProviderPanel.IsVisible = false;
        ProviderChevron.Text = "›";
        SettingsChevron.Text = SettingsPanel.IsVisible ? "⌃" : "›";
        if (SettingsPanel.IsVisible)
        {
            SettingsPanel.Opacity = 0;
            SettingsPanel.TranslationY = -8;
            await Task.WhenAll(
                SettingsPanel.FadeToAsync(1, 170, Easing.CubicOut),
                SettingsPanel.TranslateToAsync(0, 0, 190, Easing.CubicOut));
        }
    }

    private async void OnAvatarClicked(object? sender, EventArgs e)
    {
        var file = await FilePicker.Default.PickAsync(new PickOptions
        {
            PickerTitle = "Choose profile picture",
            FileTypes = FilePickerFileType.Images
        });
        if (file is null) return;

        if (!string.Equals(file.ContentType, "image/jpeg", StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(file.ContentType, "image/png", StringComparison.OrdinalIgnoreCase))
        {
            await DisplayAlertAsync("Unsupported image", "Choose a JPG or PNG image.", "OK");
            return;
        }

        var fileSize = await GetFileSizeAsync(file);
        if (MobileFileRules.ExceedsProfileUploadLimit(fileSize))
        {
            await DisplayAlertAsync("File too large", "Choose an image no larger than 5 MB.", "OK");
            return;
        }

        await RunAsync("Profile picture updated", async () =>
        {
            await api.PostMultipartAsync<ApiResult<object>>("profile/avatar", new Dictionary<string, string?>(), [Upload("avatar", file)]);
            if (session.User is not null)
            {
                session.User.HasAvatar = true;
                await session.UpdateUserAsync(session.User);
            }
            BindAccount();
        }, successMessage: "Your new profile picture is now visible across CampusGig.");
    }

    private static ApiUpload Upload(string field, FileResult file) =>
        new(field, file.FileName, file.ContentType ?? "application/octet-stream", file.OpenReadAsync);

    private static async Task<long?> GetFileSizeAsync(FileResult file)
    {
        if (!string.IsNullOrWhiteSpace(file.FullPath) && File.Exists(file.FullPath))
            return new FileInfo(file.FullPath).Length;

        await using var stream = await file.OpenReadAsync();
        return stream.CanSeek ? stream.Length : null;
    }

    private async void OnChangePasswordClicked(object? sender, EventArgs e)
    {
        var current = CurrentPasswordEntry.Text ?? "";
        var next = NewPasswordEntry.Text ?? "";

        if (current.Length < 8 || next.Length < 8 || next != ConfirmPasswordEntry.Text)
        {
            await DisplayAlertAsync("Check passwords", "Passwords must contain at least 8 characters and the new passwords must match.", "OK");
            return;
        }

        if (sender is not BusyButton button || button.IsBusy) return;
        button.IsBusy = true;
        try
        {
            var result = await api.PostAsync<PasswordChangeResult>("auth/change-password", new
            {
                currentPassword = current,
                newPassword = next,
                mfaCode = mfa.Enabled ? PasswordMfaEntry.Text?.Trim() : null,
                recoveryCode = mfa.Enabled && RecoveryCodeSwitch.IsToggled
            });
            CurrentPasswordEntry.Text = NewPasswordEntry.Text = ConfirmPasswordEntry.Text = PasswordMfaEntry.Text = "";
            if (PasswordChangeFlowRules.IsImmediate(result))
            {
                await session.ForgetTrustedDeviceAsync();
                button.IsBusy = false;
                await DisplayAlertAsync("Password changed", result.Message, "OK");
                return;
            }

            passwordChangeRequest = result;
            RenderPasswordChangeRequest();
        }
        catch (Exception ex)
        {
            await DisplayAlertAsync("Unable to change password", ex.Message, "OK");
        }
        finally
        {
            button.IsBusy = false;
            UpdateSecurityButtons();
        }
    }

    private void RenderPasswordChangeRequest()
    {
        var isPending = PasswordChangeFlowRules.IsPending(passwordChangeRequest);
        PasswordForm.IsVisible = !isPending;
        PasswordPendingPanel.IsVisible = isPending;
        if (!isPending)
        {
            StopPasswordStatusPolling();
            return;
        }

        PasswordPendingBody.Text = $"Open the email sent to {session.User?.Email}, then approve or reject the request. Your current password remains active while you wait.";
        PasswordPendingExpiry.Text = $"Expires {passwordChangeRequest!.ExpiresAt.ToLocalTime():h:mm tt}";
        StartPasswordStatusPolling();
    }

    private void StartPasswordStatusPolling()
    {
        if (passwordStatusTimer is null)
        {
            passwordStatusTimer = Dispatcher.CreateTimer();
            passwordStatusTimer.Interval = TimeSpan.FromSeconds(2);
            passwordStatusTimer.Tick += async (_, _) => await PollPasswordStatusAsync();
        }
        if (!passwordStatusTimer.IsRunning)
            passwordStatusTimer.Start();
    }

    private void StopPasswordStatusPolling() => passwordStatusTimer?.Stop();

    private async Task PollPasswordStatusAsync()
    {
        if (passwordStatusLoading || !PasswordChangeFlowRules.IsPending(passwordChangeRequest)) return;
        passwordStatusLoading = true;
        try
        {
            var result = await api.GetAsync<PasswordChangeResult>($"auth/password-change/{passwordChangeRequest!.Id}/status");
            passwordChangeRequest = result;
            if (!PasswordChangeFlowRules.IsTerminal(result)) return;

            RenderPasswordChangeRequest();
            if (PasswordChangeFlowRules.WasSuccessful(result))
            {
                await session.ForgetTrustedDeviceAsync();
                await DisplayAlertAsync("Password changed", "Your email confirmation was accepted. Use the new password next time you sign in.", "OK");
            }
            else
            {
                var message = result.Status == "REJECTED"
                    ? "The email confirmation was rejected."
                    : "The password request is no longer valid. Your password was not changed.";
                await DisplayAlertAsync("Password unchanged", message, "OK");
            }
            passwordChangeRequest = null;
        }
        catch
        {
            // A transient network failure is retried on the next timer tick.
        }
        finally
        {
            passwordStatusLoading = false;
        }
    }

    private async void OnCancelPasswordChangeClicked(object? sender, EventArgs e)
    {
        if (!PasswordChangeFlowRules.IsPending(passwordChangeRequest)) return;
        await RunAsync(sender as BusyButton, "Request cancelled", async () =>
        {
            await api.PostAsync<PasswordChangeResult>($"auth/password-change/{passwordChangeRequest!.Id}/cancel");
            passwordChangeRequest = null;
            RenderPasswordChangeRequest();
            await DisplayAlertAsync("Request cancelled", "The email confirmation link is no longer valid. Your password was not changed.", "OK");
        }, false);
    }

    private void OnPasswordVisibilityClicked(object? sender, EventArgs e)
    {
        if (sender is not Button button) return;
        var entry = button.CommandParameter?.ToString() switch
        {
            "current" => CurrentPasswordEntry,
            "new" => NewPasswordEntry,
            "confirm" => ConfirmPasswordEntry,
            _ => null,
        };
        if (entry is null) return;

        entry.IsPassword = PasswordVisibilityRules.Toggle(entry.IsPassword);
        button.Text = PasswordVisibilityRules.ButtonLabel(entry.IsPassword);
        entry.Focus();
    }

    private async void OnSetupMfaClicked(object? sender, EventArgs e) =>
        await RunAsync(sender as BusyButton, "Authenticator setup", async () =>
        {
            var setup = await api.PostAsync<MfaSetup>("auth/mfa/setup");
            MfaSecretLabel.Text = setup.Secret;
            MfaQrImage.Source = setup.QrCodeDataUrl;
            MfaSetupPanel.IsVisible = true;
            SetupMfaButton.IsVisible = false;
        }, false);

    private async void OnConfirmMfaClicked(object? sender, EventArgs e) =>
        await RunAsync(sender as BusyButton, "Two-factor authentication enabled", async () =>
        {
            var r = await api.PostAsync<RecoveryCodeResult>("auth/mfa/setup/confirm", new { code = MfaSetupCodeEntry.Text?.Trim() });
            ShowCodes(r.RecoveryCodes);
            MfaSetupPanel.IsVisible = false;
            mfa = await api.GetAsync<MfaStatus>("auth/mfa/status");
            RenderMfa();
        });

    private async void OnRegenerateCodesClicked(object? sender, EventArgs e)
    {
        var confirmed = await AppDialog.ConfirmAsync(this, "Replace recovery codes?",
            "Your existing recovery codes will stop working immediately.", "Replace codes", "Keep current codes");
        if (!confirmed) return;
        var code = await AppDialog.PromptAsync(this, "Authenticator code", "Enter the current 6-digit code:", keyboard: Keyboard.Numeric, maxLength: 6);
        if (string.IsNullOrWhiteSpace(code)) return;
        await RunAsync("Recovery codes replaced", async () =>
            ShowCodes((await api.PostAsync<RecoveryCodeResult>("auth/mfa/recovery-codes", new { code })).RecoveryCodes));
    }

    private async void OnRevokeDevicesClicked(object? sender, EventArgs e)
    {
        var confirmed = await AppDialog.ConfirmAsync(this, "Revoke remembered devices?",
            "Every remembered device, including this one, will need a 2FA code at the next sign-in.", "Revoke devices", "Cancel");
        if (!confirmed) return;
        await RunAsync("Remembered devices removed", async () =>
        {
            await api.PostAsync<RevokedDevicesResult>("auth/mfa/trusted-devices/revoke");
            await session.ForgetTrustedDeviceAsync();
            mfa = await api.GetAsync<MfaStatus>("auth/mfa/status");
            RenderMfa();
        });
    }

    private async void OnDisableMfaClicked(object? sender, EventArgs e)
    {
        var confirmed = await AppDialog.ConfirmAsync(this, "Disable two-factor authentication?",
            "Your account will only be protected by your password.", "Continue", "Keep enabled");
        if (!confirmed) return;
        var password = await AppDialog.PromptAsync(this, "Confirm your password", "Enter your current password:");
        if (string.IsNullOrWhiteSpace(password)) return;
        var code = await AppDialog.PromptAsync(this, "Authenticator code", "Enter the current 6-digit code:", keyboard: Keyboard.Numeric, maxLength: 6);
        if (string.IsNullOrWhiteSpace(code)) return;
        await RunAsync("Two-factor authentication disabled", async () =>
        {
            await api.PostAsync<ApiMessage>("auth/mfa/disable", new { currentPassword = password, code });
            mfa = await api.GetAsync<MfaStatus>("auth/mfa/status");
            RecoveryCodesPanel.IsVisible = false;
            RenderMfa();
        });
    }

    private void ShowCodes(IEnumerable<string> codes)
    {
        RecoveryCodesLabel.Text = string.Join(Environment.NewLine, codes);
        RecoveryCodesPanel.IsVisible = true;
    }

    private Task RunAsync(string title, Func<Task> action, bool notify = true, string? successMessage = null) =>
        RunAsync(null, title, action, notify, successMessage);

    private async Task RunAsync(BusyButton? button, string title, Func<Task> action, bool notify = true, string? successMessage = null)
    {
        if (button?.IsBusy == true) return;
        if (button is not null)
            button.IsBusy = UiInteractionRules.ShouldShowBusy(operationRunning: true, awaitingUserFeedback: false);
        Exception? failure = null;
        try
        {
            await action();
        }
        catch (Exception ex)
        {
            failure = ex;
        }
        finally
        {
            if (button is not null)
                button.IsBusy = UiInteractionRules.ShouldShowBusy(operationRunning: false, awaitingUserFeedback: true);
        }

        // Feedback dialogs can remain open indefinitely; the action button must
        // return to its idle visual state before waiting for the user to dismiss one.
        if (failure is not null)
            await DisplayAlertAsync("Unable to save change", failure.Message, "OK");
        else if (notify)
            await DisplayAlertAsync(title, successMessage ?? "The change was saved successfully.", "OK");
    }

    private new Task DisplayAlertAsync(string title, string message, string cancel)
        => AppDialog.AlertAsync(this, title, message, cancel);

    private async void OnRefreshing(object? sender, EventArgs e)
    {
        try
        {
            await LoadAsync();
        }
        finally
        {
            Refresh.IsRefreshing = false;
        }
    }

    private async void OnSaveApiClicked(object? sender, EventArgs e)
    {
        if (!Uri.TryCreate(ApiUrlEntry.Text?.Trim(), UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https"))
        {
            await DisplayAlertAsync("Invalid address", "Enter a complete HTTP or HTTPS API URL.", "OK");
            return;
        }
        Preferences.Default.Set("campusgig_api_url", uri.ToString().TrimEnd('/'));
        await DisplayAlertAsync("API address saved", "Restart the app to apply it.", "OK");
    }

    private async Task SignOutAsync()
    {
        SignOutButton.IsEnabled = false;
        try
        {
            var app = (App)Application.Current!;
            var hostPage = app.Windows.FirstOrDefault()?.Page;
            var confirmed = hostPage is null || await hostPage.DisplayAlertAsync(
                "Sign out", "Sign out on this device?", "Sign out", "Cancel");
            if (!confirmed) return;

            try { await googleIdentity.SignOutAsync(); } catch { }
            await MainThread.InvokeOnMainThreadAsync(app.ShowLoginAsync);
        }
        catch (Exception exception)
        {
            await DisplayAlertAsync("Unable to sign out", exception.Message, "OK");
        }
        finally
        {
            SignOutButton.IsEnabled = true;
        }
    }

    private static async void OnButtonPressed(object? sender, EventArgs e)
    {
        if (sender is VisualElement element) await element.ScaleToAsync(0.975, 55, Easing.CubicOut);
    }

    private static async void OnButtonReleased(object? sender, EventArgs e)
    {
        if (sender is VisualElement element) await element.ScaleToAsync(1, 110, Easing.CubicOut);
    }
}
public sealed class RecoveryCodeResult { public List<string> RecoveryCodes { get; set; } = []; }
public sealed class RevokedDevicesResult { public int Revoked { get; set; } }
