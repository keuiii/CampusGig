using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using Microsoft.Maui.Controls.Shapes;

namespace CampusGig.Mobile.Pages;

public sealed class ProviderEarningsPage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly VerticalStackLayout summary = new() { Spacing = 12 };
    private readonly CollectionView history;
    private readonly RefreshView refresh;
    private readonly VerticalStackLayout loading;
    private IReadOnlyList<PayoutDestinationItem> payoutDestinations = [];
    private IReadOnlyList<ProviderPayoutItem> payouts = [];
    private bool isLoading;

    public ProviderEarningsPage(CampusGigApi api)
    {
        this.api = api;
        Title = "Provider Earnings";
        NavigationPage.SetHasNavigationBar(this, false);
        this.SetAppThemeColor(
            BackgroundColorProperty,
            Color.FromArgb("#F3F5F3"),
            Color.FromArgb("#111713"));

        var close = new Button
        {
            Text = "< Profile",
            BackgroundColor = Colors.Transparent,
            TextColor = Color.FromArgb("#0F6B4F"),
            FontAttributes = FontAttributes.Bold,
            Padding = new Thickness(2, 4),
            MinimumHeightRequest = 44,
            HorizontalOptions = LayoutOptions.Start,
        };
        close.Clicked += async (_, _) => await Navigation.PopModalAsync();

        var headerContent = new VerticalStackLayout
        {
            Spacing = 3,
            Children =
            {
                close,
                new Label
                {
                    Text = "PROVIDER WORKSPACE",
                    FontSize = 9,
                    CharacterSpacing = 1.4,
                    FontAttributes = FontAttributes.Bold,
                    TextColor = Color.FromArgb("#0F8060"),
                },
                new Label
                {
                    Text = "Earnings and Payouts",
                    AutomationId = "ProviderEarningsTitle",
                    FontSize = 26,
                    FontAttributes = FontAttributes.Bold,
                },
                new Label
                {
                    Text = "Available earnings become withdrawable exactly 24 hours after the server-recorded availability time. Withdrawable is a subset of Available, not additional earnings.",
                    FontSize = 12,
                    LineHeight = 1.35,
                    TextColor = Color.FromArgb("#66716B"),
                },
            },
        };
        var header = new Border
        {
            Margin = new Thickness(20, 14, 20, 8),
            Padding = new Thickness(16, 12),
            Stroke = Color.FromArgb("#D9E5DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 16 },
            Content = headerContent,
        };
        header.SetAppThemeColor(
            Border.BackgroundColorProperty,
            Colors.White,
            Color.FromArgb("#1C2520"));

        history = new CollectionView
        {
            AutomationId = "ProviderEarningsHistory",
            Margin = new Thickness(20, 2, 20, 24),
            SelectionMode = SelectionMode.None,
            ItemSizingStrategy = ItemSizingStrategy.MeasureAllItems,
            ItemsLayout = new LinearItemsLayout(ItemsLayoutOrientation.Vertical)
            {
                ItemSpacing = 10,
            },
            Header = summary,
            EmptyView = new VerticalStackLayout
            {
                AutomationId = "ProviderEarningsZeroState",
                Padding = new Thickness(24, 40),
                Spacing = 8,
                Children =
                {
                    new Label
                    {
                        Text = "No earnings history",
                        FontSize = 20,
                        FontAttributes = FontAttributes.Bold,
                        HorizontalTextAlignment = TextAlignment.Center,
                    },
                    new Label
                    {
                        Text = "Paid orders will appear here after payment confirmation.",
                        FontSize = 12,
                        TextColor = Color.FromArgb("#66716B"),
                        HorizontalTextAlignment = TextAlignment.Center,
                    },
                },
            },
            ItemTemplate = new DataTemplate(CreateEarningCard),
        };
        refresh = new RefreshView
        {
            Content = history,
            Command = new Command(async () => await LoadAsync()),
        };
        loading = new VerticalStackLayout
        {
            IsVisible = false,
            Padding = new Thickness(20, 16),
            Children =
            {
                new ActivityIndicator
                {
                    IsRunning = true,
                    Color = Color.FromArgb("#0F6B4F"),
                },
                new Label
                {
                    Text = "Loading provider earnings...",
                    HorizontalTextAlignment = TextAlignment.Center,
                    TextColor = Color.FromArgb("#66716B"),
                },
            },
        };

        var body = new Grid();
        body.Add(refresh);
        body.Add(loading);
        var root = new Grid
        {
            RowDefinitions = new RowDefinitionCollection
            {
                new(GridLength.Auto),
                new(GridLength.Star),
            },
        };
        root.Add(header);
        root.Add(body, 0, 1);
        Content = root;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        await LoadAsync();
    }

    private async Task LoadAsync()
    {
        if (isLoading) return;
        isLoading = true;
        loading.IsVisible = history.ItemsSource is null;
        try
        {
            var summaryTask = api.GetAsync<ApiResult<List<ProviderEarningsSummaryItem>>>(
                "provider/earnings/summary");
            var historyTask = api.GetAsync<ApiList<ProviderEarningItem>>(
                "provider/earnings?limit=50");
            var destinationsTask = api.GetAsync<ApiResult<List<PayoutDestinationItem>>>(
                "provider/payouts/destinations");
            var payoutsTask = api.GetAsync<ApiResult<List<ProviderPayoutItem>>>(
                "provider/payouts");
            await Task.WhenAll(summaryTask, historyTask, destinationsTask, payoutsTask);
            payoutDestinations = destinationsTask.Result.Data;
            payouts = payoutsTask.Result.Data;
            RenderSummary(summaryTask.Result.Data);
            history.ItemsSource = historyTask.Result.Data;
        }
        catch (Exception exception)
        {
            await AppDialog.AlertAsync(
                this,
                "Earnings unavailable",
                exception.Message,
                "Try again");
        }
        finally
        {
            isLoading = false;
            loading.IsVisible = false;
            refresh.IsRefreshing = false;
        }
    }

    private void RenderSummary(IReadOnlyList<ProviderEarningsSummaryItem> rows)
    {
        summary.Children.Clear();
        summary.Children.Add(new Label
        {
            Text = "EARNINGS SUMMARY",
            FontSize = 9,
            CharacterSpacing = 1.2,
            FontAttributes = FontAttributes.Bold,
            TextColor = Color.FromArgb("#0F8060"),
        });
        if (rows.Count == 0)
        {
            summary.Children.Add(new Label
            {
                Text = "No paid-order earnings have been recorded yet.",
                AutomationId = "ProviderEarningsSummaryZeroState",
                Padding = new Thickness(14),
                FontSize = 11,
                TextColor = Color.FromArgb("#66716B"),
            });
            return;
        }
        foreach (var row in rows)
        {
            summary.Children.Add(new Label
            {
                Text = row.Currency,
                FontSize = 12,
                FontAttributes = FontAttributes.Bold,
            });
            var grid = new Grid
            {
                ColumnDefinitions =
                {
                    new ColumnDefinition(GridLength.Star),
                    new ColumnDefinition(GridLength.Star),
                },
                RowDefinitions =
                {
                    new RowDefinition(GridLength.Auto),
                    new RowDefinition(GridLength.Auto),
                    new RowDefinition(GridLength.Auto),
                    new RowDefinition(GridLength.Auto),
                },
                ColumnSpacing = 8,
                RowSpacing = 8,
            };
            grid.Add(SummaryCard("Pending", row.PendingCentavos, row.Currency));
            grid.Add(SummaryCard("Available", row.AvailableCentavos, row.Currency), 1);
            grid.Add(SummaryCard("Withdrawable", row.WithdrawableCentavos, row.Currency), 0, 1);
            grid.Add(SummaryCard("Frozen", row.FrozenCentavos, row.Currency), 1, 1);
            grid.Add(SummaryCard("Payout Processing", row.PayoutProcessingCentavos, row.Currency), 0, 2);
            grid.Add(SummaryCard("Paid Out", row.PaidOutCentavos, row.Currency), 1, 2);
            grid.Add(SummaryCard("Refunded", row.RefundedCentavos, row.Currency), 0, 3);
            summary.Children.Add(grid);
            var request = new Button
            {
                Text = $"Withdraw all eligible {row.Currency} earnings",
                AutomationId = $"RequestPayout{row.Currency}",
                IsEnabled = row.WithdrawableCentavos > 0,
                HeightRequest = 46,
                CornerRadius = 12,
                FontAttributes = FontAttributes.Bold,
                BackgroundColor = Color.FromArgb(row.WithdrawableCentavos > 0 ? "#0F6B4F" : "#D5DEDA"),
                TextColor = Color.FromArgb(row.WithdrawableCentavos > 0 ? "#FFFFFF" : "#52605A"),
            };
            request.Clicked += async (_, _) => await RequestPayoutAsync(row);
            summary.Children.Add(request);
        }
        RenderPayoutControls();
        summary.Children.Add(new BoxView
        {
            HeightRequest = 1,
            Margin = new Thickness(0, 8, 0, 12),
            BackgroundColor = Color.FromArgb("#DDE4DF"),
        });
    }

    private static Border SummaryCard(string label, int amountCentavos, string currency) =>
        new()
        {
            Padding = new Thickness(12),
            Stroke = Color.FromArgb("#DDE4DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 13 },
            Content = new VerticalStackLayout
            {
                Spacing = 5,
                Children =
                {
                    new Label
                    {
                        Text = label.ToUpperInvariant(),
                        FontSize = 8,
                        CharacterSpacing = 0.5,
                        TextColor = Color.FromArgb("#66716B"),
                    },
                    new Label
                    {
                        Text = ProviderEarningsPresentation.FormatAmount(amountCentavos, currency),
                        FontSize = 14,
                        FontAttributes = FontAttributes.Bold,
                    },
                },
            },
        };

    private static View CreateEarningCard()
    {
        var orderNumber = new Label
        {
            FontSize = 9,
            TextColor = Color.FromArgb("#66716B"),
        };
        orderNumber.SetBinding(Label.TextProperty, nameof(ProviderEarningItem.OrderNumber));
        var serviceTitle = new Label
        {
            FontSize = 15,
            FontAttributes = FontAttributes.Bold,
        };
        serviceTitle.SetBinding(Label.TextProperty, nameof(ProviderEarningItem.ServiceTitle));
        var source = new Label
        {
            FontSize = 9,
            CharacterSpacing = 0.4,
            TextColor = Color.FromArgb("#0F8060"),
        };
        source.SetBinding(Label.TextProperty, nameof(ProviderEarningItem.SourceLabel));
        var pendingAt = new Label
        {
            FontSize = 10,
            TextColor = Color.FromArgb("#66716B"),
        };
        pendingAt.SetBinding(Label.TextProperty, nameof(ProviderEarningItem.PendingLabel));
        var details = new VerticalStackLayout
        {
            Spacing = 3,
            Children =
            {
                orderNumber,
                serviceTitle,
                source,
                pendingAt,
            },
        };
        var amountLabel = new Label
        {
            FontSize = 14,
            FontAttributes = FontAttributes.Bold,
            HorizontalTextAlignment = TextAlignment.End,
        };
        amountLabel.SetBinding(Label.TextProperty, nameof(ProviderEarningItem.AmountLabel));
        var statusLabel = new Label
        {
            FontSize = 9,
            FontAttributes = FontAttributes.Bold,
            TextColor = Color.FromArgb("#0F6B4F"),
            HorizontalTextAlignment = TextAlignment.End,
        };
        statusLabel.SetBinding(Label.TextProperty, nameof(ProviderEarningItem.StatusLabel));
        var eligibilityLabel = new Label
        {
            FontSize = 9,
            TextColor = Color.FromArgb("#66716B"),
            HorizontalTextAlignment = TextAlignment.End,
        };
        eligibilityLabel.SetBinding(Label.TextProperty, nameof(ProviderEarningItem.EligibilityLabel));
        var amount = new VerticalStackLayout
        {
            HorizontalOptions = LayoutOptions.End,
            Spacing = 4,
            Children =
            {
                amountLabel,
                statusLabel,
                eligibilityLabel,
            },
        };
        var grid = new Grid
        {
            ColumnDefinitions =
            {
                new ColumnDefinition(GridLength.Star),
                new ColumnDefinition(GridLength.Auto),
            },
            ColumnSpacing = 12,
        };
        grid.Add(details);
        grid.Add(amount, 1);
        var card = new Border
        {
            Padding = new Thickness(15),
            Stroke = Color.FromArgb("#DDE4DF"),
            StrokeShape = new RoundRectangle { CornerRadius = 16 },
            Content = grid,
        };
        card.SetAppThemeColor(
            Border.BackgroundColorProperty,
            Colors.White,
            Color.FromArgb("#1A231F"));
        return card;
    }

    private void RenderPayoutControls()
    {
        summary.Children.Add(new Label
        {
            Text = "PAYOUT DESTINATIONS",
            FontSize = 9,
            CharacterSpacing = 1.2,
            FontAttributes = FontAttributes.Bold,
            TextColor = Color.FromArgb("#0F8060"),
        });
        foreach (var destination in payoutDestinations)
        {
            var row = new HorizontalStackLayout { Spacing = 8 };
            row.Children.Add(new Label
            {
                Text = $"{destination.DisplayLabel} {destination.MaskedAccountIdentifier} · {MarketplacePresentation.StatusLabel(destination.VerificationStatus)}",
                FontSize = 11,
                HorizontalOptions = LayoutOptions.Fill,
            });
            if (destination.IsActive)
            {
                var deactivate = new Button { Text = "Deactivate", FontSize = 10 };
                deactivate.Clicked += async (_, _) => await DeactivateDestinationAsync(destination);
                row.Children.Add(deactivate);
            }
            summary.Children.Add(row);
        }
        var addDestination = new Button
        {
            Text = "Add masked payout destination",
            AutomationId = "AddPayoutDestination",
            HeightRequest = 46,
            CornerRadius = 12,
            FontAttributes = FontAttributes.Bold,
            BackgroundColor = Color.FromArgb("#0F6B4F"),
            TextColor = Colors.White,
        };
        addDestination.Clicked += async (_, _) => await AddDestinationAsync();
        summary.Children.Add(addDestination);
        summary.Children.Add(new Label
        {
            Text = "PAYOUT HISTORY",
            FontSize = 9,
            CharacterSpacing = 1.2,
            FontAttributes = FontAttributes.Bold,
            TextColor = Color.FromArgb("#0F8060"),
        });
        foreach (var payout in payouts)
        {
            var stack = new VerticalStackLayout { Spacing = 3 };
            stack.Children.Add(new Label
            {
                Text = $"{payout.AmountLabel} · {payout.StatusLabel}",
                FontAttributes = FontAttributes.Bold,
            });
            stack.Children.Add(new Label
            {
                Text = $"Fee {ProviderEarningsPresentation.FormatAmount(payout.PayoutFeeCentavos, payout.Currency)} · {payout.DestinationSnapshot.DisplayLabel} {payout.DestinationSnapshot.MaskedAccountIdentifier}",
                FontSize = 10,
                TextColor = Color.FromArgb("#66716B"),
            });
            stack.Children.Add(new Label
            {
                Text = payout.Status == "PAID"
                    ? "Settlement evidence recorded"
                    : "This status does not mean money was sent.",
                FontSize = 10,
                TextColor = Color.FromArgb("#66716B"),
            });
            if (payout.Status == "REQUESTED")
            {
                var cancel = new Button { Text = "Cancel request", FontSize = 10 };
                cancel.Clicked += async (_, _) => await CancelPayoutAsync(payout);
                stack.Children.Add(cancel);
            }
            summary.Children.Add(new Border
            {
                Padding = 12,
                Stroke = Color.FromArgb("#DDE4DF"),
                StrokeShape = new RoundRectangle { CornerRadius = 13 },
                Content = stack,
            });
        }
    }

    private async Task AddDestinationAsync()
    {
        var type = await DisplayActionSheetAsync("Destination type", "Cancel", null, "E-wallet", "Bank account");
        if (type is null or "Cancel") return;
        var displayLabel = await DisplayPromptAsync("Display label", "Use a recognizable label without sensitive details.", maxLength: 80);
        if (string.IsNullOrWhiteSpace(displayLabel)) return;
        var accountIdentifier = await DisplayPromptAsync("Account identifier", "This value is sent once and discarded after the server creates its mask.", maxLength: 80, keyboard: Keyboard.Text);
        if (string.IsNullOrWhiteSpace(accountIdentifier)) return;
        var accountHolderName = await DisplayPromptAsync("Account holder", "Enter the account holder name.", maxLength: 120);
        if (string.IsNullOrWhiteSpace(accountHolderName)) return;
        await api.PostAsync<ApiResult<PayoutDestinationItem>>("provider/payouts/destinations", new
        {
            type = type == "E-wallet" ? "E_WALLET" : "BANK_ACCOUNT",
            displayLabel = displayLabel.Trim(),
            accountIdentifier = accountIdentifier.Trim(),
            accountHolderName = accountHolderName.Trim(),
        });
        await AppDialog.AlertAsync(this, "Destination saved", "An administrator must review this masked destination before it can receive a payout.", "OK");
        await LoadAsync();
    }

    private async Task DeactivateDestinationAsync(PayoutDestinationItem destination)
    {
        if (!await DisplayAlertAsync("Deactivate destination?", $"Deactivate {destination.DisplayLabel} {destination.MaskedAccountIdentifier}?", "Deactivate", "Keep")) return;
        await api.PostAsync<ApiResult<PayoutDestinationItem>>(
            $"provider/payouts/destinations/{destination.Id}/deactivate",
            new { confirmation = "CONFIRM" });
        await LoadAsync();
    }

    private async Task RequestPayoutAsync(ProviderEarningsSummaryItem row)
    {
        var destination = payoutDestinations.FirstOrDefault(item => item.CanReceivePayout);
        if (destination is null)
        {
            await AppDialog.AlertAsync(this, "Reviewed destination required", "Add a destination and wait for administrator review before requesting payout.", "OK");
            return;
        }
        if (!await DisplayAlertAsync(
                "Request payout?",
                $"Reserve all withdrawable {row.Currency} earnings for {destination.DisplayLabel} {destination.MaskedAccountIdentifier}. Fee is zero. This does not send money.",
                "Request payout",
                "Cancel")) return;
        await api.PostAsync<ApiResult<ProviderPayoutItem>>("provider/payouts", new
        {
            destinationId = destination.Id,
            clientRequestId = Guid.NewGuid(),
            currency = row.Currency,
        });
        await LoadAsync();
    }

    private async Task CancelPayoutAsync(ProviderPayoutItem payout)
    {
        if (!await DisplayAlertAsync("Cancel request?", "Reserved earnings return to Available with their original eligibility time.", "Cancel request", "Keep")) return;
        await api.PostAsync<ApiResult<ProviderPayoutItem>>(
            $"provider/payouts/{payout.Id}/cancel",
            new { confirmation = "CONFIRM" });
        await LoadAsync();
    }
}
