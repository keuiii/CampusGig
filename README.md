# CampusGig

CampusGig is a multi-school student-services marketplace for participating schools in Lipa City. It combines fixed-price student service listings with a planned custom job-posting and proposal marketplace.

The repository currently represents an **integrated Phase 1 MVP in active development**. It includes a Next.js web app, an Expo React Native mobile app, a NestJS REST API, and a PostgreSQL database using Prisma.

For the full progress report and remaining milestones, read [ROADMAP.md](./ROADMAP.md).

## Current progress

Implemented:

- Responsive web marketplace prototype
- Expo mobile application tested with an Android emulator
- Service discovery, category selection, and search interfaces
- Preferred-school filtering on web and mobile
- Active-school, category, and published-service API queries
- Provider, order, profile, messaging, and admin interface foundations
- NestJS API with Swagger documentation
- PostgreSQL/Prisma schema for the Phase 1 domain
- Clean category-only database seed
- Local PostgreSQL container and initial Prisma migration
- Working registration, six-digit email verification, login, forgot/reset password, JWT, authenticator-app two-factor authentication, one-use recovery codes, protected profiles, and mobile authentication screens
- Secure Google social sign-in foundation for web and mobile, including verified ID-token exchange and persistent provider-account linking
- Role-protected platform admin, school admin, provider, and order API foundations
- Admin endpoints for registering participating schools and changing their status
- Database-backed student profile setup in the mobile app
- Mobile provider-profile editor with headline, bio, skills, and availability
- Mobile account settings with role visibility and authenticated password changes
- Persistent JPG/PNG profile-picture uploads shared across web and mobile account icons
- Private student-ID upload and verification-request submission in the mobile app
- Admin-only verification queue, document access, approval, and rejection endpoints
- Web administrator sign-in with a persistent local browser session
- Connected admin dashboard for real statistics, verification review, and participating-school management
- Verified-provider web sign-in and persistent local provider session
- Provider profile setup with headline, bio, skills, and availability
- Service draft creation with persisted category, delivery method, and Basic package pricing
- Provider listing status and submission to administrator moderation
- Mobile service details with real package selection and client requirements
- Transactional order creation with immutable package snapshots, status history, and an order conversation
- Durable in-app notifications for providers when clients request their services
- Real client Orders tab and provider notification feed
- Functional web notification bell with unread badges and provider Accept/Reject request actions
- Client notifications for provider decisions, visible from the mobile bell
- Persistent animated night-mode controls on mobile (Profile → Appearance) and the web header
- Shared web interaction system with scroll progress, section reveals, page transitions, card motion, and reduced-motion accessibility
- Participant-only order workspaces with persisted status timelines, client/provider messaging, and private message attachments
- Dedicated mobile conversation inbox and chat screen with latest-message previews, unread counts, search, attachments, and downloads; order workspaces remain focused on project lifecycle actions
- Private provider deliverable uploads, client revision requests with package-limit enforcement, delivery acceptance, completion, and verified post-order reviews

Not yet fully implemented:

- Production Resend credentials/domain verification and production-grade refresh-token sessions
- Completing role authorization as new marketplace endpoints are implemented
- Production object storage for profile, verification, and service media files
- Listing preview, pause, archive, pagination, sorting, and advanced marketplace filters
- Order detail/timeline screens and lifecycle actions after provider acceptance
- Real-time messaging and private file sharing
- Dispute reporting and administrator dispute resolution
- Payments, commissions, Pro subscriptions, and featured listings
- Custom job postings and proposals
- Production deployment and automated testing

Dispute handling, payment processing, production email credential setup, and production object storage remain future work. Mobile delivery files use authenticated temporary downloads and the device share/open sheet.

## Technology

- **Web:** Next.js 15, React 19, TypeScript
- **Mobile:** Expo SDK 54, React Native, TypeScript
- **API:** NestJS 11 and REST
- **Database:** PostgreSQL 17 and Prisma ORM
- **API documentation:** Swagger
- **Local database option:** Docker Compose

Local email/password authentication with JWT, new-account verification codes, forgot/reset password, and optional authenticator-app 2FA are implemented. Authenticator secrets are AES-256-GCM encrypted, recovery codes are hashed and one-use, and login challenges expire after five minutes. Users may trust a web browser or mobile installation for 30 days after completing 2FA; only a random token hash is stored by the server, expiry is enforced by the API, and all remembered devices can be revoked from account security. In-app password changes remain pending until the account owner approves the secure email review; rejection, cancellation, or 15-minute expiry leaves the existing password unchanged. Personal email accounts are accepted and school-provided email is optional. Production email credentials, refresh-token handling, and production object storage still need to be configured before deployment.

### Real verification email setup

CampusGig already sends signup and password-reset codes through Resend when credentials are configured. Create and verify a sending domain in Resend, then place these values in `api/.env`:

```env
RESEND_API_KEY=re_your_api_key
EMAIL_FROM=CampusGig <accounts@your-verified-domain.com>
MFA_ENCRYPTION_KEY=use-a-long-random-secret-different-from-jwt-secret
```

Restart the API after changing the environment file. Without these two email values, development mode intentionally shows the test code in the application and API terminal. Production mode refuses to expose a development code.

For development or a school demonstration without a custom domain, Gmail SMTP is also supported. Turn on 2-Step Verification for the sending Google account, create a dedicated Google App Password named `CampusGig`, then configure:

```env
SMTP_USER=your-campusgig-sender@gmail.com
SMTP_APP_PASSWORD=your-16-character-google-app-password
EMAIL_FROM=CampusGig <your-campusgig-sender@gmail.com>
```

Gmail SMTP takes priority when both SMTP values are present. Do not use or store your normal Google password. The App Password belongs only in the ignored `api/.env` file and must never be committed. Resend remains the recommended production provider after CampusGig obtains a domain.

## Google social sign-in setup

Google sign-in is implemented but remains disabled until you create OAuth client IDs in Google Cloud Console. Keep email/password login available as the fallback.

1. Create a Google Cloud project and configure its OAuth consent screen.
2. Create a **Web application** OAuth client. Add `http://localhost:3000` as an authorized JavaScript origin.
3. Create an **Android** OAuth client for package `com.campusgig.app`, using the SHA-1 certificate fingerprint of the development or release build.
4. Add the client IDs to the local environment files:

```env
# .env.local
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com

# api/.env
GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
GOOGLE_ANDROID_CLIENT_ID=your-android-client-id.apps.googleusercontent.com

# mobile/.env
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=your-android-client-id.apps.googleusercontent.com
```

Restart the API, web, and Expo terminals after editing environment files. The web button works with the web client ID. Native Google authentication should be tested using an Expo development build because provider redirects and native identity configuration are not production-equivalent in Expo Go.

The API accepts only Google-signed ID tokens whose audience matches one of the configured client IDs. Google accounts are stored in `SocialAccount`, so returning users keep the same CampusGig roles, profiles, orders, and provider workspace.

## Repository structure

```text
CampusGig/
├── app/                 Next.js web application
├── api/                 NestJS API and Prisma schema
├── mobile/              Expo React Native application
├── docker-compose.yml   Local PostgreSQL service
├── ROADMAP.md           Progress and development roadmap
└── package.json         Root development commands
```

## Requirements

- Node.js with npm
- PostgreSQL 17, or Docker Desktop for the provided database container
- Android Studio emulator or Expo Go for mobile testing

## First-time setup

Install dependencies in each application if they are not already installed:

```powershell
cd D:\CampusGig
npm install
npm --prefix api install
npm --prefix mobile install
```

Create environment files:

```powershell
Copy-Item .env.example .env.local
Copy-Item api\.env.example api\.env
Copy-Item mobile\.env.example mobile\.env
```

For an Android Studio emulator, set this in `mobile/.env`:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
```

For Expo Go on a physical phone, use the computer's LAN IP and keep both devices on the same network.

## Database setup

Start the provided PostgreSQL container:

```powershell
docker compose up -d postgres
```

Then generate the Prisma client, apply migrations, and seed the approved category taxonomy:

```powershell
npm run db:generate
npm run db:migrate
npm run db:seed
```

To inspect the local database in a browser while Docker Desktop is running:

```powershell
npm run db:studio
```

Prisma Studio is available at `http://localhost:5555` until its terminal is stopped with `Ctrl + C`.

The seed operation preserves Graphic Design, Tutoring, Programming, Photography, Video Editing, and Writing. It does **not** create users, schools, profiles, services, orders, messages, reviews, or fabricated statistics.

Participating schools must be added as real system data and set to `ACTIVE` before they appear in the preferred-school selector.

## Running the project

Use separate PowerShell windows for each application.

### Backend API

```powershell
cd D:\CampusGig
npm run api:dev
```

- API: `http://localhost:4000/api/v1`
- Swagger: `http://localhost:4000/docs`
- Health: `http://localhost:4000/api/v1/health`

### Web application

```powershell
cd D:\CampusGig
npm run dev
```

Open `http://localhost:3000`.

### Mobile application

```powershell
cd D:\CampusGig
npm run mobile:start
```

Press `a` in the Expo terminal to launch the connected Android emulator.

Google sign-in uses native Android code and therefore requires the CampusGig development build instead of Expo Go. With the emulator running, create and install it using:

```powershell
cd D:\CampusGig\mobile
.\node_modules\.bin\expo.cmd run:android
```

After the first native build, normal JavaScript-only changes can be loaded with `npm run mobile:start -- --dev-client`. Rebuild with `expo.cmd run:android` whenever native dependencies or `mobile/app.json` change.

## Current API status

Database-backed routes:

- `GET /api/v1/health`
- `GET /api/v1/categories`
- `GET /api/v1/schools`
- `GET /api/v1/services`
- `GET /api/v1/services/:id`
- `GET /api/v1/services?schoolId=<school-uuid>`
- `GET /api/v1/profile/student` (Bearer token required)
- `PUT /api/v1/profile/student` (Bearer token required)
- `GET /api/v1/profile/student/verification` (Bearer token required)
- `POST /api/v1/profile/student/verification` (Bearer token and JPG, PNG, or PDF required)
- `GET /api/v1/admin/schools` (Admin token required)
- `POST /api/v1/admin/schools` (Admin token required)
- `PATCH /api/v1/admin/schools/:id/status` (Admin token required)
- `GET /api/v1/admin/verifications` (Admin token required)
- `GET /api/v1/admin/verifications/:id/document` (Admin token required)
- `POST /api/v1/admin/verifications/:id/approve` (Admin token required)
- `POST /api/v1/admin/verifications/:id/reject` (Admin token and rejection reason required)
- `GET /api/v1/provider/dashboard` (Provider token required)
- `GET /api/v1/provider/profile` (Provider token required)
- `PUT /api/v1/provider/profile` (Verified provider token required)
- `GET /api/v1/provider/services` (Provider token required)
- `POST /api/v1/provider/services` (Verified provider token required)
- `POST /api/v1/provider/services/:id/submit` (Provider token required)
- `PUT /api/v1/provider/services/:id` (Draft/rejected service editing)
- `POST /api/v1/provider/services/:id/media` (Private cover and portfolio upload)
- `DELETE /api/v1/provider/services/:id/media/:mediaId`

Order and notification routes implemented:

- `GET /api/v1/orders?scope=client|provider` (Bearer token required)
- `POST /api/v1/orders` (Bearer token required)
- `POST /api/v1/orders/:id/accept` (Order provider only)
- `POST /api/v1/orders/:id/reject` (Order provider only; reason required)
- `POST /api/v1/orders/:id/start` (Order provider only; accepted orders only)
- `GET /api/v1/orders/:id` (Order client or provider only; includes status history)
- `POST /api/v1/orders/:id/deliver` (Order provider only; multipart delivery files)
- `GET /api/v1/orders/:id/files/:fileId` (Order participants only)
- `POST /api/v1/orders/:id/revision` (Order client only; revision limit enforced)
- `POST /api/v1/orders/:id/complete` (Order client only; submitted work only)
- `POST /api/v1/orders/:id/review` (Order client only; one review per completed order)
- `GET /api/v1/orders/:orderId/messages` (Order participants only)
- `POST /api/v1/orders/:orderId/messages` (Order participants only)
- `POST /api/v1/orders/:orderId/messages/attachments` (Order participants only; up to three private files)
- `GET /api/v1/conversations` (Signed-in user’s participant-only conversation inbox)
- `GET /api/v1/notifications` (Bearer token required)
- `PATCH /api/v1/notifications/:id/read` (Bearer token required)

Authentication routes implemented in the API:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/resend-verification`
- `POST /api/v1/auth/mfa/challenge`
- `GET /api/v1/auth/mfa/status` (Bearer token required)
- `POST /api/v1/auth/mfa/setup` (Bearer token required)
- `POST /api/v1/auth/mfa/setup/confirm` (Bearer token required)
- `POST /api/v1/auth/mfa/recovery-codes` (Bearer token required)
- `POST /api/v1/auth/mfa/disable` (Bearer token required; unavailable to administrator roles)
- `POST /api/v1/auth/mfa/trusted-devices/revoke` (Bearer token required)
- `POST /api/v1/auth/change-password` (creates a pending email-approved request)
- `GET /api/v1/auth/password-change/pending` (Bearer token required)
- `GET /api/v1/auth/password-change/:id/status` (Bearer token required)
- `POST /api/v1/auth/password-change/:id/cancel` (Bearer token required)
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/change-password` (Bearer token required)
- `GET /api/v1/auth/me` (Bearer token required)

Registration creates a local account with a hashed password and the default `CLIENT` role. Selecting “I’m currently a student” adds `STUDENT` while retaining Client access. New accounts must enter a six-digit email code before login. Registration, verification, password reset, JWT issuance, and role isolation have been tested end-to-end against the local PostgreSQL container. Temporary test accounts are removed after verification.

## Build validation

```powershell
npm run api:build
npm run build
.\mobile\node_modules\.bin\tsc.CMD --noEmit -p mobile\tsconfig.json
```

## Recommended next milestone

Administrator service moderation is connected, and providers can create or edit draft/rejected listings with Basic, Standard, and Premium packages. Cover and portfolio files stay private until publication and then appear through guarded public media endpoints. Next, add listing preview/pause/archive controls and production object storage. Stronger refresh-token/session handling also remains.

### Unified web account access

Open the web application and select **Account**. Everyone uses the same Log in / Sign up form; there is no public administrator sign-in option. After login, CampusGig routes `ADMIN` accounts to the platform dashboard, `SCHOOL_ADMIN` accounts to their assigned school’s verification dashboard, `PROVIDER` accounts to the provider workspace, and Client or Student accounts to their account page. Public signup creates a Client account by default and adds Student access only when the user explicitly selects it.

Platform administrators assign school-administrator access from the web dashboard using an existing verified account email and an active participating school. School administrators can view and decide only verification requests belonging to that school. Private IDs from other schools, platform statistics, school management, and service moderation remain inaccessible.

After assigning `ADMIN` through Prisma Studio during development, sign out and back in so a fresh token contains the role.

## Documentation

- [Development roadmap](./ROADMAP.md)
- [Mobile source-code guide](./mobile/SOURCE_CODE_GUIDE.md)
