# CampusGig Mobile Source-Code Guide

CampusGig Mobile is the Expo React Native client for student clients and student service providers. It is currently an interactive Phase 1 prototype connected to the CampusGig REST API.

Refer to the repository-level [development roadmap](../ROADMAP.md) for overall completion and remaining milestones.

## Current implementation

- Student service-discovery home screen
- Search and category filtering
- Preferred-school filtering
- Approved Phase 1 service categories
- API-loaded active schools and published services
- Orders empty state and lifecycle-ready navigation
- Order-based messaging empty state
- Student-profile and school-verification setup interface
- Provider-profile entry point
- Responsive bottom navigation
- Loading and clean empty states
- Android emulator support

The Orders, Messages, Profile, authentication, verification, booking, and provider actions are not complete backend workflows yet. They intentionally show prototype or empty states until authenticated endpoints are implemented.

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

Preferred-school selection matches the selected active school ID against the service provider's `schoolId`. “All schools” is the default and does not restrict results.

## Validate the source

```powershell
.\mobile\node_modules\.bin\tsc.CMD --noEmit -p mobile\tsconfig.json
```

## What should be developed next

1. Authentication and persistent sessions
2. Student profiles and school-verification submission
3. Protected navigation based on user role
4. Real service and provider details
5. Order creation and lifecycle screens
6. Real-time order messaging and private file uploads
7. Revisions, completion, and verified reviews
8. Automated testing and Android release builds

Complete the fixed-price service and order flow before adding the Phase 2 custom job-posting and proposal marketplace.
