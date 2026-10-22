using System.ComponentModel;
using System.Runtime.CompilerServices;
using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;

namespace CampusGig.Mobile.ViewModels;

public sealed class ProfileViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly CampusGigApi api;
    private readonly SessionService session;
    private readonly RealtimeService realtime;
    private readonly SemaphoreSlim refreshGate = new(1, 1);
    private CancellationTokenSource lifecycleCancellation = new();
    private bool active;

    public ProfileViewModel(CampusGigApi api, SessionService session, RealtimeService realtime)
    {
        this.api = api;
        this.session = session;
        this.realtime = realtime;
        ApplySession();
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    public event Action? RefreshRequested;

    public AuthUser? User => session.User;
    public CancellationToken LifecycleToken => lifecycleCancellation.Token;
    public string DisplayName { get; private set; } = "CampusGig user";
    public string Email { get; private set; } = "";
    public string RolesText { get; private set; } = "CLIENT";
    public bool IsStudent { get; private set; }
    public bool IsClientOnly { get; private set; }
    public bool ShowsProviderJourney { get; private set; }
    public bool IsProvider { get; private set; }
    public string ProviderSubtitle { get; private set; } = "Unlocks after student verification";

    public void Activate()
    {
        if (lifecycleCancellation.IsCancellationRequested)
        {
            lifecycleCancellation.Dispose();
            lifecycleCancellation = new CancellationTokenSource();
        }

        if (!active)
        {
            realtime.AccountChanged += OnRealtimeAccountChanged;
            realtime.ReconciliationRequired += OnRealtimeReconciliationRequired;
            active = true;
        }

        ApplySession();
    }

    public void Deactivate()
    {
        lifecycleCancellation.Cancel();
        if (!active) return;
        realtime.AccountChanged -= OnRealtimeAccountChanged;
        realtime.ReconciliationRequired -= OnRealtimeReconciliationRequired;
        active = false;
    }

    public async Task<ProfileRefreshResult?> RefreshAccountAsync()
    {
        if (LifecycleToken.IsCancellationRequested || !await refreshGate.WaitAsync(0, LifecycleToken))
            return null;

        try
        {
            var expectedGeneration = session.Generation;
            var previousRoles = session.User?.Roles.ToArray() ?? [];
            var account = await api.GetAsync<AuthUser>("auth/me", LifecycleToken);
            LifecycleToken.ThrowIfCancellationRequested();
            if (!await session.UpdateUserAsync(account, expectedGeneration)) return null;
            ApplySession();
            return new ProfileRefreshResult(account, previousRoles);
        }
        finally
        {
            refreshGate.Release();
        }
    }

    public void ApplySession()
    {
        var state = ProfileAccountState.From(session.User);
        DisplayName = state.DisplayName;
        Email = state.Email;
        RolesText = state.RolesText;
        IsStudent = state.IsStudent;
        IsClientOnly = state.IsClientOnly;
        ShowsProviderJourney = state.ShowsProviderJourney;
        IsProvider = state.IsProvider;
        ProviderSubtitle = state.ProviderSubtitle;
        OnPropertyChanged(string.Empty);
    }

    private void OnRealtimeAccountChanged(string resource)
    {
        if (AccountRefreshRules.ShouldRefreshForResource(resource))
            RefreshRequested?.Invoke();
    }

    private void OnRealtimeReconciliationRequired() => RefreshRequested?.Invoke();

    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    public void Dispose()
    {
        Deactivate();
        lifecycleCancellation.Dispose();
        refreshGate.Dispose();
    }
}

public sealed record ProfileRefreshResult(AuthUser User, IReadOnlyList<string> PreviousRoles);
