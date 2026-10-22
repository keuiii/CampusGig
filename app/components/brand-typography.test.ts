import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CampusGig wordmarks use the tailored brand treatment on web and mobile", async () => {
  const [brand, styles, home, auth, onboarding, splash] = await Promise.all([
    readFile("app/components/brand.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
    readFile("maui/CampusGig.Mobile/Pages/HomePage.xaml", "utf8"),
    readFile("maui/CampusGig.Mobile/Pages/AuthPage.xaml", "utf8"),
    readFile("maui/CampusGig.Mobile/Pages/OnboardingPage.xaml", "utf8"),
    readFile("maui/CampusGig.Mobile/Pages/SplashPage.xaml", "utf8"),
  ]);

  assert.match(brand, /className="logo-wordmark"/);
  assert.match(styles, /\.logo-wordmark\s*\{/);
  assert.match(styles, /letter-spacing: -0\.052em/);
  for (const markup of [home, auth, onboarding, splash]) {
    assert.match(
      markup,
      /FontFamily="OpenSansSemibold"|Property="FontFamily" Value="OpenSansSemibold"/,
    );
  }
});
