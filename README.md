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
- Working registration, six-digit email verification, login, forgot/reset password, JWT, protected profile, and mobile authentication screens
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

Not yet fully implemented:

- Production email-provider configuration and production-grade refresh-token sessions
- Completing role authorization as new marketplace endpoints are implemented
- Production object storage for profile, verification, and service media files
- Listing preview, pause, archive, pagination, sorting, and advanced marketplace filters
- Order detail/timeline screens and lifecycle actions after provider acceptance
- Real-time messaging and private file sharing
- Revisions, disputes, and reviews
- Payments, commissions, Pro subscriptions, and featured listings
- Custom job postings and proposals
- Production deployment and automated testing

The current messaging, later order lifecycle, deliverable, revision, dispute, and review screens include prototype or empty states where their backend workflows have not yet been connected.

## Technology

- **Web:** Next.js 15, React 19, TypeScript
- **Mobile:** Expo SDK 54, React Native, TypeScript
- **API:** NestJS 11 and REST
- **Database:** PostgreSQL 17 and Prisma ORM
- **API documentation:** Swagger
- **Local database option:** Docker Compose

Local email/password authentication with JWT, new-account verification codes, and forgot/reset password are implemented. Personal email accounts are accepted and school-provided email is optional. Production email delivery, refresh-token handling, and production object storage still need to be configured before deployment.

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
- `GET /api/v1/notifications` (Bearer token required)
- `PATCH /api/v1/notifications/:id/read` (Bearer token required)

Authentication routes implemented in the API:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/resend-verification`
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
