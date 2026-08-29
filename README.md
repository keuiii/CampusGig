# CampusGig

CampusGig is a multi-school student-services marketplace for participating schools in Lipa City. It combines fixed-price student service listings with a planned custom job-posting and proposal marketplace.

The repository currently represents the **Phase 1 foundation and interactive prototype**. It includes a Next.js web app, an Expo React Native mobile app, a NestJS REST API, and a PostgreSQL database design using Prisma.

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
- Working registration, login, JWT, protected profile, and mobile authentication screens

Not yet fully implemented:

- Web authentication screens and production-grade refresh-token sessions
- Applying role authorization to all protected marketplace endpoints
- Student ID upload and verification workflow
- Service creation, editing, and moderation
- Persistent order creation and lifecycle actions
- Real-time messaging and private file sharing
- Revisions, disputes, and reviews
- Payments, commissions, Pro subscriptions, and featured listings
- Custom job postings and proposals
- Production deployment and automated testing

The current admin, provider, order, message, and profile screens include prototype or empty states where their backend workflows have not yet been connected.

## Technology

- **Web:** Next.js 15, React 19, TypeScript
- **Mobile:** Expo SDK 54, React Native, TypeScript
- **API:** NestJS 11 and REST
- **Database:** PostgreSQL 17 and Prisma ORM
- **API documentation:** Swagger
- **Local database option:** Docker Compose

Authentication and private file storage still need to be selected and integrated. A managed platform such as Supabase is a suitable MVP option, but it is not currently implemented.

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

Placeholder routes that still require implementation:

- `GET /api/v1/orders`
- `GET /api/v1/provider/dashboard`
- `GET /api/v1/admin/dashboard`
- `GET /api/v1/admin/verifications`
- `POST /api/v1/admin/verifications/:id/approve`
- `POST /api/v1/admin/verifications/:id/reject`

Authentication routes implemented in the API:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me` (Bearer token required)

Registration creates a local account with a hashed password and the default `STUDENT` role. Registration, login, JWT issuance, and `/auth/me` have been tested end-to-end against the local PostgreSQL container. The temporary test account was removed after verification.

## Build validation

```powershell
npm run api:build
npm run build
.\mobile\node_modules\.bin\tsc.CMD --noEmit -p mobile\tsconfig.json
```

## Recommended next milestone

Add participating-school administration and student-profile setup, then apply role-based protection to marketplace endpoints. Web authentication and stronger refresh-token/session handling also remain.

## Documentation

- [Development roadmap](./ROADMAP.md)
- [Mobile source-code guide](./mobile/SOURCE_CODE_GUIDE.md)
