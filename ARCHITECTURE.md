# CampusGig architecture

CampusGig is organized as three applications sharing one repository.

## Web (`app/`)

- `page.tsx` coordinates the current single-page experience and feature views.
- `components/` contains reusable visual primitives.
- `lib/http-client.ts` owns URL resolution, local-network support, API errors, and shared requests.
- `lib/api.ts` exposes feature-oriented API methods to the UI.
- `types.ts` contains web-facing API models.

## Mobile (`mobile/`)

- `App.tsx` coordinates sessions and navigation.
- `src/screens/` contains complete screens such as authentication and discovery.
- `src/features/` groups multi-part order and messaging workflows.
- `src/components/` contains reusable controls and navigation.
- `src/types.ts`, `config.ts`, and `catalog.ts` contain models and application data.
- `src/theme.ts` contains light/dark styles and design tokens.

Native `android/` and `ios/` directories are generated build output and are not the source of truth.

## API (`api/`)

- Business capabilities are NestJS modules under `src/modules/`.
- `src/common/` contains reusable infrastructure such as disk-upload configuration.
- Prisma owns persistence through `prisma/schema.prisma` and ordered migrations.
- Private uploads remain outside publicly served web assets.

## Refactoring rules

1. Preserve API contracts and database migrations.
2. Keep screens focused on rendering and interaction.
3. Put network and storage details in shared services.
4. Reuse common UI and infrastructure instead of copying it.
5. Run web/mobile TypeScript checks and the API build after structural changes.

## Validation commands

- `npm run check` checks web types, mobile types, and the API build.
- `npm run build` creates the optimized web production build.
- `npm run format:check` verifies consistent formatting without changing files.
