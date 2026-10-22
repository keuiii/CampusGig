import { expect, test } from "@playwright/test";

test("Discover loads another server page and resets when the budget changes", async ({
  page,
}) => {
  const service = (index: number) => ({
    id: `service-${index}`,
    title: `Campus service ${index}`,
    description: "Student help",
    providerId: `provider-${index}`,
    provider: "Campus Provider",
    providerHasAvatar: false,
    providerAvatarVersion: 0,
    initials: "CP",
    program: "BSIT",
    school: "Campus School",
    schoolId: "school-1",
    category: "Tutoring",
    price: index === 1 ? 300 : 600,
    rating: 4.5,
    reviews: 2,
    acceptingOrders: true,
    publishedAt: "2026-09-25T00:00:00.000Z",
    delivery: "3 days",
    packages: [
      {
        id: `package-${index}`,
        tier: "BASIC",
        name: "Basic",
        description: "Help",
        priceCentavos: index === 1 ? 30000 : 60000,
        deliveryDays: 3,
        revisionLimit: 1,
      },
    ],
    coverMediaId: null,
    portfolio: [],
  });
  await page.route("**/api/v1/services?*", async (route) => {
    const url = new URL(route.request().url());
    const budget = url.searchParams.get("budgetRange");
    const requestedPage = Number(url.searchParams.get("page"));
    const data =
      budget === "under-500"
        ? [service(1)]
        : requestedPage === 1
          ? Array.from({ length: 20 }, (_, index) => service(index + 1))
          : [service(21), service(22), service(23)];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": new URL(page.url()).origin,
        "access-control-allow-credentials": "true",
      },
      body: JSON.stringify({
        data,
        page: requestedPage,
        pageSize: 20,
        total: budget ? 1 : 23,
        hasMore: !budget && requestedPage === 1,
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator(".service-card")).toHaveCount(20);
  await page.getByRole("button", { name: /Show more services/ }).click();
  await expect(page.locator(".service-card")).toHaveCount(23);
  await page.getByLabel("Budget range").selectOption("under-500");
  await expect(page.locator(".service-card")).toHaveCount(1);
  await expect(page.getByText("1 result", { exact: true })).toBeVisible();
});

test("Discover debounces search and never renders a stale response", async ({
  page,
}) => {
  const service = (id: string, title: string) => ({
    id,
    title,
    description: "Student design help",
    providerId: `provider-${id}`,
    provider: "Campus Provider",
    providerHasAvatar: false,
    providerAvatarVersion: 0,
    acceptingOrders: true,
    initials: "CP",
    program: "BSIT",
    school: "Campus School",
    schoolId: "school-1",
    category: "Graphic Design",
    price: 500,
    rating: 4.8,
    reviews: 4,
    publishedAt: "2026-09-28T00:00:00.000Z",
    delivery: "2 days",
    packages: [],
    coverMediaId: null,
    portfolio: [],
  });
  let slowRequestSeen = false;
  await page.route("**/api/v1/services?*", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("query") ?? "";
    if (query === "slow") {
      slowRequestSeen = true;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    const data =
      query === "loggo design"
        ? [service("logo", "Logo Design Studio")]
        : query === "nothing"
          ? []
          : [
              service(
                query || "initial",
                query ? "Stale result" : "Initial service",
              ),
            ];
    await route
      .fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": new URL(page.url()).origin,
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify({
          data,
          page: 1,
          pageSize: 20,
          total: data.length,
          hasMore: false,
        }),
      })
      .catch(() => undefined);
  });

  await page.goto("/");
  const search = page.getByLabel("Search marketplace services");
  await search.fill("slow");
  await page.waitForTimeout(350);
  await search.fill("loggo   design");

  await expect(
    page.getByText("Logo Design Studio", { exact: true }),
  ).toBeVisible();
  expect(slowRequestSeen).toBe(true);
  await page.waitForTimeout(900);
  await expect(page.getByText("Stale result", { exact: true })).toHaveCount(0);

  await search.fill("nothing");
  await expect(page.getByText("No results for “nothing”")).toBeVisible();
});
