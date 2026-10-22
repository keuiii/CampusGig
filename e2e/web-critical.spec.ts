import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PrismaClient, hash } from "../api/test/support/e2e-dependencies";

const prisma = new PrismaClient();
const password = "Browser-Test-934!";
const fixtureSchoolId = randomUUID();
const fixtureCategoryId = `e2e-${randomUUID()}`;

test.setTimeout(120_000);

test.beforeAll(async () => {
  await prisma.$transaction([
    prisma.school.create({
      data: {
        id: fixtureSchoolId,
        name: "CampusGig Browser Test School",
        shortName: "E2E",
        emailDomain: "e2e.example.test",
        status: "ACTIVE",
      },
    }),
    prisma.category.create({
      data: {
        id: fixtureCategoryId,
        name: "Browser Testing",
        icon: "E2E",
        color: "mint",
        sortOrder: 999,
      },
    }),
  ]);
});

async function removeUsersAndWork(emailAddresses: string[]) {
  const users = await prisma.user.findMany({
    where: { email: { in: emailAddresses } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (userIds.length) {
    await prisma.verificationRequest.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.order.deleteMany({
      where: {
        OR: [{ clientId: { in: userIds } }, { providerId: { in: userIds } }],
      },
    });
    await prisma.service.deleteMany({ where: { providerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  const remaining = await prisma.user.count({
    where: { email: { in: emailAddresses } },
  });
  expect(
    remaining,
    "Disposable browser-test accounts were not fully removed",
  ).toBe(0);
}

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Continue to CampusGig" }).click();
}

test.afterAll(async () => {
  try {
    await prisma.$transaction([
      prisma.school.deleteMany({ where: { id: fixtureSchoolId } }),
      prisma.category.deleteMany({ where: { id: fixtureCategoryId } }),
    ]);
  } finally {
    await prisma.$disconnect();
  }
});

test("a provider can change availability from the rendered dashboard", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const email = `e2e-web-provider-profile-${suffix}@example.test`;
  const displayName = `Browser Provider Profile ${suffix}`;

  try {
    const school = await prisma.school.findFirstOrThrow({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
    });
    await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash: await hash(password, 4),
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: {
          create: [
            { role: "CLIENT" },
            { role: "STUDENT" },
            { role: "PROVIDER" },
          ],
        },
        studentProfile: {
          create: {
            schoolId: school.id,
            verificationStatus: "APPROVED",
            verifiedAt: new Date(),
          },
        },
        providerProfile: {
          create: {
            headline: "Browser availability tester",
            bio: "Disposable provider profile for rendered availability validation.",
            skills: ["Browser testing"],
            isAvailable: true,
          },
        },
      },
    });

    await signIn(page, email);
    await expect(
      page.getByRole("heading", { name: "Provider dashboard" }),
    ).toBeVisible();

    const availability = page.getByLabel("Available for new orders");
    await expect(availability).toBeChecked();
    await availability.uncheck();
    await page.getByRole("button", { name: "Save provider profile" }).click();
    await expect(page.getByText("Unavailable", { exact: true })).toBeVisible();

    const savedProfile = await prisma.providerProfile.findUniqueOrThrow({
      where: {
        userId: (await prisma.user.findUniqueOrThrow({ where: { email } })).id,
      },
    });
    expect(savedProfile.isAvailable).toBe(false);
  } finally {
    await removeUsersAndWork([email]);
  }
});

test("a platform administrator can register a pending school", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const email = `e2e-web-admin-${suffix}@example.test`;
  const schoolName = `Browser Campus ${suffix}`;

  try {
    await prisma.user.create({
      data: {
        email,
        displayName: `Browser Admin ${suffix}`,
        passwordHash: await hash(password, 4),
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: "ADMIN" }] },
      },
    });

    await signIn(page, email);
    await expect(
      page.getByRole("heading", { name: "Platform overview" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Schools" }).click();
    await page.getByRole("button", { name: "Add school" }).click();

    const dialog = page.getByRole("dialog", { name: "Register a school" });
    await dialog.getByLabel("School name").fill(schoolName);
    await dialog.getByLabel("Short name").fill(`BC-${suffix}`);
    await dialog.getByLabel("Email domain").fill(`${suffix}.example.test`);
    await dialog.getByRole("button", { name: "Add as pending" }).click();
    await expect(page.getByText(schoolName, { exact: true })).toBeVisible();

    const school = await prisma.school.findFirstOrThrow({
      where: { name: schoolName },
    });
    expect(school.status).toBe("PENDING");
  } finally {
    await prisma.school.deleteMany({ where: { name: schoolName } });
    await removeUsersAndWork([email]);
  }
});

test("a school administrator can approve only an assigned-school student", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `e2e-web-school-admin-${suffix}@example.test`;
  const studentEmail = `e2e-web-school-student-${suffix}@example.test`;
  const studentName = `Browser School Student ${suffix}`;

  try {
    const school = await prisma.school.findFirstOrThrow({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
    });
    await prisma.user.create({
      data: {
        email: adminEmail,
        displayName: `Browser School Admin ${suffix}`,
        passwordHash: await hash(password, 4),
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: "CLIENT" }, { role: "SCHOOL_ADMIN" }] },
        schoolAdminAssignment: { create: { schoolId: school.id } },
      },
    });
    const student = await prisma.user.create({
      data: {
        email: studentEmail,
        displayName: studentName,
        passwordHash: await hash(password, 4),
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: "CLIENT" }, { role: "STUDENT" }] },
        studentProfile: {
          create: {
            schoolId: school.id,
            program: "Quality Engineering",
            yearLevel: 4,
            verificationStatus: "PENDING",
          },
        },
      },
    });
    const request = await prisma.verificationRequest.create({
      data: {
        userId: student.id,
        schoolId: school.id,
        studentIdFilePath: `e2e/${suffix}/student-id.png`,
        status: "PENDING",
      },
    });

    await signIn(page, adminEmail);
    await expect(
      page.getByRole("heading", { name: "Student verification" }),
    ).toBeVisible();
    const row = page.locator(".verify-row").filter({ hasText: studentName });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "Approve" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Approve this student?",
    });
    await dialog.getByRole("button", { name: "Approve student" }).click();
    await expect(row).toHaveCount(0);

    const [savedRequest, savedProfile] = await Promise.all([
      prisma.verificationRequest.findUniqueOrThrow({
        where: { id: request.id },
      }),
      prisma.studentProfile.findUniqueOrThrow({
        where: { userId: student.id },
      }),
    ]);
    expect(savedRequest.status).toBe("APPROVED");
    expect(savedProfile.verificationStatus).toBe("APPROVED");
  } finally {
    await removeUsersAndWork([adminEmail, studentEmail]);
  }
});

test("a client can register and verify through the web interface", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const email = `e2e-web-register-${suffix}@example.test`;
  const displayName = `Browser Client ${suffix}`;

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.getByLabel("Full name").fill(displayName);
    await page.getByLabel("Email address").fill(email);
    await page.getByPlaceholder("At least 8 characters").fill(password);
    await page.getByPlaceholder("Enter password again").fill(password);
    await page.getByRole("button", { name: "Create client account" }).click();
    await expect(
      page.getByRole("heading", { name: "Verify your email" }),
    ).toBeVisible();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const verificationCode = "731942";
    await prisma.$transaction([
      prisma.accountCode.deleteMany({
        where: { userId: user.id, purpose: "VERIFY_EMAIL" },
      }),
      prisma.accountCode.create({
        data: {
          userId: user.id,
          purpose: "VERIFY_EMAIL",
          codeHash: await hash(verificationCode, 4),
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      }),
    ]);

    await page.getByLabel("Six-digit code").fill(verificationCode);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(
      page.getByRole("heading", { name: `Welcome, ${displayName}` }),
    ).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
  } finally {
    await removeUsersAndWork([email]);
  }
});

test("a signed-in client can discover a service and confirm a request", async ({
  page,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const providerEmail = `e2e-web-provider-${suffix}@example.test`;
  const clientEmail = `e2e-web-client-${suffix}@example.test`;
  const providerName = `Browser Provider ${suffix}`;
  const clientName = `Browser Buyer ${suffix}`;
  const serviceTitle = `Browser Journey Design ${suffix}`;
  const passwordHash = await hash(password, 4);

  try {
    const school = await prisma.school.findFirstOrThrow({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
    });
    const category = await prisma.category.findFirstOrThrow({
      orderBy: { name: "asc" },
    });
    const provider = await prisma.user.create({
      data: {
        email: providerEmail,
        displayName: providerName,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: {
          create: [
            { role: "CLIENT" },
            { role: "STUDENT" },
            { role: "PROVIDER" },
          ],
        },
        studentProfile: {
          create: {
            schoolId: school.id,
            verificationStatus: "APPROVED",
            verifiedAt: new Date(),
          },
        },
        providerProfile: {
          create: {
            headline: "Disposable browser journey provider",
            bio: "Temporary provider profile used only by the automated browser journey.",
            skills: ["Browser testing"],
            isAvailable: true,
          },
        },
      },
    });
    await prisma.user.create({
      data: {
        email: clientEmail,
        displayName: clientName,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: "CLIENT" }] },
      },
    });
    await prisma.service.create({
      data: {
        providerId: provider.id,
        categoryId: category.id,
        title: serviceTitle,
        slug: `browser-journey-${suffix}`,
        description:
          "A disposable published service created to verify the complete browser booking journey.",
        deliveryMethod: "ONLINE",
        status: "PUBLISHED",
        publishedAt: new Date(),
        packages: {
          create: {
            tier: "BASIC",
            name: "Basic package",
            description:
              "A complete disposable package for browser journey validation.",
            priceCentavos: 125_000,
            deliveryDays: 2,
            revisionLimit: 1,
          },
        },
      },
    });

    await page.goto("/");
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByLabel("Email address").fill(clientEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Continue to CampusGig" }).click();
    await expect(
      page.getByRole("heading", { name: `Welcome, ${clientName}` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Discover" }).click();
    await page
      .getByPlaceholder("What service are you looking for?")
      .fill(serviceTitle);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const serviceCard = page
      .locator(".service-card")
      .filter({ hasText: serviceTitle });
    await serviceCard.getByRole("button", { name: "Save service" }).click();
    await expect(
      serviceCard.getByRole("button", { name: "Remove saved service" }),
    ).toBeVisible();
    await page.reload();
    await page
      .getByPlaceholder("What service are you looking for?")
      .fill(serviceTitle);
    await expect(
      serviceCard.getByRole("button", { name: "Remove saved service" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Saved services" }).click();
    await expect(serviceCard).toBeVisible();
    await page
      .getByRole("heading", { name: serviceTitle, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: serviceTitle }),
    ).toBeVisible();

    const bookingCard = page.locator(".booking-card");
    const continueButton = bookingCard.getByRole("button", {
      name: /^Continue\b/,
    });
    await continueButton.scrollIntoViewIfNeeded();
    await expect(continueButton).toBeVisible();
    await continueButton.click();
    await page
      .getByLabel("Project requirements")
      .fill("Please create the disposable browser journey deliverable.");
    const requestedDeliveryDate = new Date();
    requestedDeliveryDate.setDate(requestedDeliveryDate.getDate() + 7);
    await page
      .getByLabel("Requested delivery date")
      .fill(requestedDeliveryDate.toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Send request" }).click();
    const dialog = page.getByRole("dialog", { name: "Send this request?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(serviceTitle, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Confirm and send" }).click();

    await expect(
      page.getByRole("heading", { name: "My orders" }),
    ).toBeVisible();
    const createdOrder = page
      .locator(".client-orders-table .table-row")
      .filter({ hasText: serviceTitle });
    await expect(createdOrder).toHaveCount(1);
    await expect(
      createdOrder.getByText(serviceTitle, { exact: true }),
    ).toBeVisible();
    await expect(createdOrder.locator('[data-status="REQUESTED"]')).toBeVisible();
  } finally {
    await removeUsersAndWork([providerEmail, clientEmail]);
  }
});
