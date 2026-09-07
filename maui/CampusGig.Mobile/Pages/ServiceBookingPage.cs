using CampusGig.Mobile.Controls;
using CampusGig.Mobile.Models;
using CampusGig.Mobile.Services;
using Microsoft.Maui.Controls.Shapes;

namespace CampusGig.Mobile.Pages;

public sealed class ServiceBookingPage : ContentPage
{
    private readonly CampusGigApi api;
    private readonly ServiceItem service;
    private readonly VerticalStackLayout packageList = new() { Spacing = 10 };
    private readonly Editor requirements = new()
    {
        Placeholder = "Describe what you need, including style, dimensions, deadline, and references…",
        MaxLength = 3000,
        HeightRequest = 145,
        AutoSize = EditorAutoSizeOption.TextChanges,
    };
    private readonly Label requirementsCount = MutedLabel();
    private readonly Label summaryPrice = new() { FontSize = 20, FontAttributes = FontAttributes.Bold, TextColor = Color.FromArgb("#0F6B4F") };
    private readonly BusyButton submit = new()
    {
        Text = "Send service request  →",
        BusyText = "Sending request",
        FillColor = Color.FromArgb("#0F8060"),
        TextColor = Colors.White,
        HeightRequest = 50,
        HorizontalOptions = LayoutOptions.Fill,
    };
    private ServicePackage? selectedPackage;

    public ServiceBookingPage(CampusGigApi api, ServiceItem service)
    {
        NavigationPage.SetHasNavigationBar(this, false);
        this.api = api;
        this.service = service;
        selectedPackage = service.Packages.FirstOrDefault();
        Title = "Service request";
        this.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F7FAF8"), Color.FromArgb("#111713"));

        var close = new Button
        {
            Text = "‹  Discover",
            BackgroundColor = Colors.Transparent,
            TextColor = Color.FromArgb("#0F6B4F"),
            HorizontalOptions = LayoutOptions.Start,
            Padding = new Thickness(0, 8),
            FontAttributes = FontAttributes.Bold,
        };
        close.Clicked += async (_, _) => await CloseAsync();
        requirements.TextChanged += (_, _) => RenderSummary();
        submit.Clicked += SubmitAsync;

        var content = new VerticalStackLayout
        {
            Padding = new Thickness(20, 8, 20, 34),
            Spacing = 13,
            MaximumWidthRequest = 620,
            HorizontalOptions = LayoutOptions.Fill,
        };
        content.Children.Add(close);
        content.Children.Add(Eyebrow(service.Category));
        content.Children.Add(new Label { Text = service.Title, FontSize = 27, FontAttributes = FontAttributes.Bold });
        content.Children.Add(MutedLabel($"{service.Provider}  •  {service.School}", 11));
        if (!string.IsNullOrWhiteSpace(service.CoverImageUrl))
            content.Children.Add(Rounded(new Image { Source = service.CoverImageUrl, Aspect = Aspect.AspectFill }, 0, 190));
        content.Children.Add(new Label { Text = service.Description, FontSize = 13, LineHeight = 1.35 });
        content.Children.Add(Eyebrow("CHOOSE A PACKAGE"));
        content.Children.Add(packageList);
        content.Children.Add(Eyebrow("PROJECT REQUIREMENTS"));
        content.Children.Add(Rounded(requirements, 12));
        content.Children.Add(requirementsCount);

        var summary = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 12 };
        summary.Add(new VerticalStackLayout
        {
            Spacing = 2,
            Children = { Eyebrow("TOTAL FOR THIS REQUEST"), MutedLabel("Secure payment is arranged after the provider accepts.") },
        });
        summary.Add(summaryPrice, 1);
        content.Children.Add(Rounded(summary, 14));
        content.Children.Add(submit);
        content.Children.Add(MutedLabel("The provider will receive an in-app notification immediately.", centered: true));
        Content = new ScrollView { Content = content };
        RenderPackages();
        RenderSummary();
    }

    private static Label Eyebrow(string text) => new()
    {
        Text = text,
        FontSize = 9,
        CharacterSpacing = 1.2,
        FontAttributes = FontAttributes.Bold,
        TextColor = Color.FromArgb("#0F6B4F"),
    };

    private static Label MutedLabel(string text = "", double fontSize = 10, bool centered = false)
    {
        var label = new Label { Text = text, FontSize = fontSize, HorizontalTextAlignment = centered ? TextAlignment.Center : TextAlignment.Start };
        label.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#66716B"), Color.FromArgb("#AAB6AF"));
        return label;
    }

    private static Border Rounded(View content, double padding, double height = -1)
    {
        var border = new Border
        {
            Padding = padding,
            HeightRequest = height,
            StrokeShape = new RoundRectangle { CornerRadius = 14 },
            Content = content,
        };
        border.SetAppThemeColor(Border.StrokeProperty, Color.FromArgb("#DDE3DF"), Color.FromArgb("#385046"));
        border.SetAppThemeColor(Border.BackgroundColorProperty, Color.FromArgb("#FFFFFF"), Color.FromArgb("#1C2520"));
        return border;
    }

    private void RenderPackages()
    {
        packageList.Children.Clear();
        foreach (var package in service.Packages)
        {
            var selected = package.Id == selectedPackage?.Id;
            var heading = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)] };
            heading.Add(new VerticalStackLayout
            {
                Spacing = 2,
                Children = { Eyebrow(package.Tier), new Label { Text = package.Name, FontSize = 15, FontAttributes = FontAttributes.Bold } },
            });
            heading.Add(new Label
            {
                Text = $"₱{package.PriceCentavos / 100m:N0}",
                FontSize = 16,
                FontAttributes = FontAttributes.Bold,
                TextColor = Color.FromArgb("#0F6B4F"),
            }, 1);
            var card = Rounded(new VerticalStackLayout
            {
                Spacing = 7,
                Children =
                {
                    heading,
                    MutedLabel(package.Description, 11),
                    MutedLabel($"{package.DeliveryDays} day delivery  •  {package.RevisionLimit} revision{(package.RevisionLimit == 1 ? "" : "s")}"),
                },
            }, 14);
            card.SetAppThemeColor(Border.StrokeProperty,
                Color.FromArgb(selected ? "#0F6B4F" : "#DDE3DF"),
                Color.FromArgb(selected ? "#69C59F" : "#385046"));
            card.StrokeThickness = selected ? 2 : 1;
            card.SetAppThemeColor(BackgroundColorProperty,
                Color.FromArgb(selected ? "#EEF6F1" : "#FFFFFF"),
                Color.FromArgb(selected ? "#203B30" : "#1C2520"));
            var tap = new TapGestureRecognizer();
            tap.Tapped += async (_, _) =>
            {
                if (selectedPackage?.Id == package.Id) return;
                await card.ScaleToAsync(0.975, 60, Easing.CubicOut);
                selectedPackage = package;
                RenderPackages();
                RenderSummary();
            };
            card.GestureRecognizers.Add(tap);
            packageList.Children.Add(card);
        }
    }

    private void RenderSummary()
    {
        requirementsCount.Text = $"{requirements.Text?.Trim().Length ?? 0}/3000  •  minimum 10 characters";
        summaryPrice.Text = selectedPackage is null ? "—" : $"₱{selectedPackage.PriceCentavos / 100m:N0}";
        submit.IsEnabled = ServiceBookingRules.CanSubmit(selectedPackage, requirements.Text);
        submit.Opacity = submit.IsEnabled ? 1 : 0.45;
    }

    private async void SubmitAsync(object? sender, EventArgs e)
    {
        if (!ServiceBookingRules.CanStartSubmission(submit.IsBusy, selectedPackage, requirements.Text)) return;
        submit.IsBusy = true;
        ApiResult<OrderItem>? result = null;
        Exception? failure = null;
        try
        {
            result = await api.PostAsync<ApiResult<OrderItem>>("orders", new
            {
                serviceId = service.Id,
                servicePackageId = selectedPackage!.Id,
                requirements = requirements.Text!.Trim(),
            });
        }
        catch (Exception exception) { failure = exception; }
        finally
        {
            submit.IsBusy = false;
            RenderSummary();
        }

        if (failure is not null)
        {
            await AppDialog.AlertAsync(this, "Request not sent", failure.Message, "Try again");
            return;
        }

        await AppDialog.AlertAsync(this, "Request sent", $"{result!.Data.OrderNumber} was created. {result.Message}");
        await Navigation.PopModalAsync();
        if (MainTabbedPage.Instance is not null)
            await MainTabbedPage.Instance.SelectTabAsync("orders");
    }

    protected override bool OnBackButtonPressed()
    {
        _ = CloseAsync();
        return true;
    }

    private Task CloseAsync() => Navigation.NavigationStack.Count > 1
        ? Navigation.PopAsync()
        : Navigation.PopModalAsync();
}
