# CampusGig Mobile Source-Code Guide

CampusGig Mobile is the Expo React Native client for general clients, student clients, and student service providers. It is currently an interactive Phase 1 prototype connected to the CampusGig REST API.

Refer to the repository-level [development roadmap](../ROADMAP.md) for overall completion and remaining milestones.

## Current implementation

- Student service-discovery home screen
- Search and category filtering
- Preferred-school filtering
- Approved Phase 1 service categories
- API-loaded active schools and published services
- Service detail and Basic/Standard/Premium package selection
- Real client requirement submission and database-backed order creation
- Real Orders tab with order number, provider, package, total, due date, and status
- Real notification bell for provider acceptance and rejection updates
- Order-based messaging empty state
- Student-profile and school-verification setup interface
- Provider-profile entry point
- Responsive bottom navigation
- Loading and clean empty states
- Android emulator support
- Real registration and login screens
- Client-only signup by default with an optional Student selection
- Persistent JWT session restoration and sign-out
- Authenticated profile identity and role display

Authentication, profiles, verification submission, service discovery, booking, and the initial client order list are connected to the real CampusGig API and database. Provider order decisions, later lifecycle transitions, and messaging/file screens remain incomplete.

The project contains no fabricated users, schools, services, orders, messages, reviews, or marketplace statistics. Category values remain because they are the approved system taxonomy.

## Technology

- Expo SDK 54
- React Native 0.81
- React 19
- TypeScript
- REST API through `EXPO_PUBLIC_API_URL`

## First-time setup

From the repository root:

```powershell
cd D:\CampusGig
npm --prefix mobile install
Copy-Item mobile\.env.example mobile\.env
```

For an Android Studio emulator:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
```

For Expo Go on a physical device:

```env
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_IP:4000
```

The backend must be running on port `4000`. A physical phone and computer should normally be on the same network.

## Run on the Android emulator

Start the backend in the first PowerShell window:

```powershell
cd D:\CampusGig
npm run api:dev
```

Start Expo in a second PowerShell window:

```powershell
cd D:\CampusGig
npm run mobile:start
```

Press `a` in the Expo terminal. If no emulator is running, start one using Android Studio's Device Manager and press `a` again.

## Important files

- `App.tsx` — screens, state, API loading, filtering, navigation, and styling
- `index.ts` — Expo application entry point
- `app.json` — Expo, Android, and iOS configuration
- `package.json` — dependencies and mobile scripts
- `.env.example` — backend API configuration
- `assets/` — application icons and splash assets

The prototype is intentionally contained mostly in `App.tsx` for presentation speed. It should later be separated into `screens`, `components`, `navigation`, `services`, `hooks`, and `types` folders.

## Mobile API usage

The app currently reads:

- `GET /api/v1/categories`
- `GET /api/v1/schools`
- `GET /api/v1/services`

Authenticated users can also upload a JPG or PNG profile picture from the Profile avatar. The API stores it outside source control and both the web and mobile apps use the same saved picture.

Preferred-school selection matches the selected active school ID against the service provider's `schoolId`. “All schools” is the default and does not restrict results.

## Validate the source

```powershell
.\mobile\node_modules\.bin\tsc.CMD --noEmit -p mobile\tsconfig.json
```

## What should be developed next

1. Refresh-token rotation and stronger production session storage
2. Complete role-based endpoint and navigation protection
3. Mobile service creation and provider dashboard screens
4. Order creation and lifecycle screens
5. Real-time order messaging and private file uploads
6. Revisions, completion, and verified reviews
8. Automated testing and Android release builds

Complete the fixed-price service and order flow before adding the Phase 2 custom job-posting and proposal marketplace.
