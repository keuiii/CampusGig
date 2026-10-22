# CampusGig Laravel migration

The Laravel backend in `laravel-api/` is a side-by-side replacement for the
existing NestJS API. The NestJS application remains the production source of
truth until every compatibility gate below passes.

## Non-negotiable compatibility boundaries

- Preserve the `/api/v1` route prefix and existing JSON response shapes.
- Preserve UUID identifiers and existing enum values.
- Preserve mobile bearer access tokens and rotating refresh tokens.
- Preserve browser refresh cookies and their security attributes.
- Preserve server-side role, ownership, and state-transition authorization.
- Preserve PayMongo signature verification, idempotency, and ledger behavior.
- Preserve private file storage and authenticated download authorization.
- Do not reset, seed over, or destructively alter the restored PostgreSQL data.

## Migration sequence

1. Establish Laravel health, error, CORS, and security contracts.
2. Translate the Prisma schema into forward-only MySQL migrations.
3. Port authentication, sessions, MFA, and account recovery.
4. Port schools, profiles, categories, listings, and media.
5. Port orders, conversations, notifications, and reviews.
6. Port payment checkout, webhooks, refunds, earnings, disputes, and payouts.
7. Add PostgreSQL-to-MySQL export/import tooling with reconciliation reports.
8. Run API contract tests against NestJS and Laravel and compare responses.
9. Exercise the existing Web and MAUI clients against Laravel in staging.
10. Deploy to a Hostinger staging subdomain, rehearse rollback, then cut over.

## Cutover rule

Do not point production clients at Laravel until authentication, authorization,
order lifecycle, payment webhooks, refunds, file access, migration counts, and
backup restoration have all been verified in staging.

## Verified milestones

### Core authentication and sessions

The Laravel API currently implements and tests these compatible routes:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/social`
- `POST /api/v1/auth/verify-email`
- `POST /api/v1/auth/resend-verification`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/mfa/challenge`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/sessions`
- `DELETE /api/v1/auth/sessions/{id}`
- `POST /api/v1/auth/logout-all`
- `GET /api/v1/auth/mfa/status`
- `POST /api/v1/auth/mfa/setup`
- `POST /api/v1/auth/mfa/setup/confirm`
- `POST /api/v1/auth/mfa/disable`
- `POST /api/v1/auth/mfa/recovery-codes`
- `POST /api/v1/auth/mfa/trusted-devices/revoke`
- `POST /api/v1/auth/change-password`
- `GET /api/v1/auth/password-change/pending`
- `GET /api/v1/auth/password-change/{id}/status`
- `POST /api/v1/auth/password-change/{id}/cancel`
- `GET /api/v1/auth/password-change/review`
- `POST /api/v1/auth/password-change/decision`

The implementation preserves mobile refresh-token responses, secure browser
refresh cookies, rotating refresh tokens, replay grace, token-family
revocation, session-version invalidation, password recovery, NestJS bcrypt
password-hash compatibility, AES-256-GCM compatibility for existing MFA
secrets, authenticator setup, MFA challenges, recovery codes, and trusted
devices, the email-confirmed password-change workflow, and signed Google ID
token verification/account linking. The complete authentication feature suite
has passed on SQLite and MySQL 8.4.

### Marketplace reference data and pricing

The Laravel API now also implements public active categories with published
service counts, public active schools, administrator school listing/creation/
status changes with server-side `ADMIN` enforcement, and authoritative
single-price service quotes including eligible rush tiers, rush surcharge,
platform fee, queue-capacity checks, and self-order prevention.

The public marketplace compatibility slice also implements and tests:

- `GET /api/v1/services` with pagination, search, category, school, budget,
  rating, delivery-time, and sorting filters
- `GET /api/v1/services/{id}`
- `GET /api/v1/services/{id}/media/{mediaId}` with private local storage
- `GET /api/v1/services/saved/ids`
- `GET /api/v1/services/saved`
- `PUT /api/v1/services/{id}/save`
- `DELETE /api/v1/services/{id}/save`

Discovery preserves both valid legacy-package listings and current fixed-price
listings so existing published data remains readable during migration. Private
media can be relocated outside the public web root by setting
`PRIVATE_STORAGE_ROOT`; it must contain the existing `service-media/`
namespace.

The public provider surface now also includes `GET /api/v1/providers/{id}/public`
and `GET /api/v1/providers/{id}/reviews`, including paginated review summaries
and privacy-preserving reviewer labels.

Authenticated providers can now use the compatible dashboard, profile,
availability, owned-service list, service create/update, submit/revise, and
pause/resume/archive/restore routes. Listing transitions use conditional writes
to reject stale concurrent actions, and existing legacy listings remain
editable while new fixed-price client behavior remains supported.

Provider media mutation now preserves the existing multipart contract for one
image cover and up to five JPG, PNG, WebP, or PDF portfolio files. Uploads are
content-signature checked, scanned before persistence, stored privately with
server-generated keys, transactionally recorded, and cleaned up after failed
operations. Production fails closed unless `MALWARE_SCANNER_DRIVER=clamav` is
configured. Owned preview and deletion routes enforce provider ownership and
draft/rejected edit rules.

### Initial order lifecycle

The authenticated Laravel order slice now implements and tests:

- `GET /api/v1/orders` for client/provider active and archived views with the
  existing opaque cursor contract
- `POST /api/v1/orders` for fixed-price and readable legacy-package listings
- `GET /api/v1/orders/{id}` with participant-only authorization
- `POST /api/v1/orders/{id}/accept`
- `POST /api/v1/orders/{id}/reject`
- `POST /api/v1/orders/{id}/cancel`
- `POST /api/v1/orders/{id}/start`, including the mandatory paid-payment gate
- `POST /api/v1/orders/{id}/deliver` with one to five private deliverable files,
  SHA-256 evidence, request-id idempotency, and revision resubmission support
- `GET /api/v1/orders/{id}/files/{fileId}` with participant authorization and
  delivery-file access auditing
- `POST /api/v1/orders/{id}/revision` for included revisions during the active
  48-hour delivery review window
- `POST /api/v1/orders/{id}/revisions/correction-claim` and
  `POST /api/v1/orders/{id}/revisions/{revisionId}/correction-decision` for
  provider-acknowledged free corrections without consuming included revisions
- `GET /api/v1/orders/{orderId}/payments`
- `POST /api/v1/orders/{orderId}/payments/checkout` for web and mobile PayMongo
  return targets
- `GET /api/v1/orders/{orderId}/payments/revision-quote` and
  `POST /api/v1/orders/{orderId}/payments/revision-checkout` for authoritative
  paid-extra-revision pricing and checkout
- `GET /api/v1/orders/{orderId}/payments/refund-eligibility` for participant-
  scoped refund state and client policy eligibility
- `POST /api/v1/orders/{orderId}/payments/refunds` for full original-order
  refunds before work starts or after a missed fixed-price rush deadline
- participant dispute routes for opening cases, submitting responses, adding
  private evidence, and downloading evidence with order authorization
- administrator dispute queues, detail/evidence review, response requests,
  ready/review transitions, and idempotent final resolution
- administrator refunds for client-win disputes, stale paid revisions, and
  documented pre-delivery policy exceptions, plus provider reconciliation
- order and pre-order conversation inbox routes, chronological message paging,
  unread/read state, personal pin/archive/hide preferences, and participant-
  scoped private order attachments
- `POST /api/v1/payments/paymongo/webhook` with raw-body HMAC verification,
  timestamp tolerance, event idempotency, and authoritative amount/currency
  checks
- `GET /api/v1/payments/mobile-return` for the Android app deep-link bridge
- `POST /api/v1/orders/{id}/complete` with reconciled provider-earning release
- `POST /api/v1/orders/{id}/review` with serialized aggregate updates
- personal archive, restore, and remove actions without changing the shared
  order state

Creation preserves request-id idempotency, the existing request fingerprint,
provider pending-capacity locking, immutable price and delivery snapshots,
conversation participants, status history, and notifications in one database
transaction. State changes use conditional writes so stale concurrent actions
cannot silently overwrite a newer order state. Delivery submission preserves
immutable versioned evidence, enrolls the current submission in the review
policy, rejects active disputes and unpaid work, and resolves the exact active
revision when corrected work is submitted. Deliverables use the same private,
signature-checked, malware-scanned storage boundary as service media.

PayMongo checkout creation records the server-side financial snapshot before
the external call. Signed paid events create the pending provider earning and
immutable ledger credit exactly once, while fixed-price deadlines begin from
PayMongo's authoritative paid timestamp. A throttled read-time fallback checks
the provider checkout when a signed webhook is delayed and applies the same
idempotent ledger transition. Client-requested full refunds freeze the earning,
cancel eligible work, submit an idempotent PayMongo refund, reverse provider
principal and platform-fee ledgers only after provider success, and process
signed refund updates without duplicating accounting. Unknown provider outcomes
remain frozen for administrator reconciliation. Client acceptance releases the
reconciled earning; the scheduled `orders:reconcile-expired-reviews` command
does the same after an eligible 48-hour review window expires. Production
configuration fails closed unless live-mode PayMongo keys, a webhook secret,
HTTPS return URLs, and ClamAV are configured.

Revision handling now distinguishes included revisions, provider-acknowledged
corrections, and paid extra revisions. Paid revision quotes use immutable order
principal and duration evidence, checkout returns include the revision purchase
identifier, signed payment confirmation atomically activates the exact revision,
and a separate pending provider earning is recorded. Stale paid revision state
is retained for administrator reconciliation rather than silently activating or
discarding paid work. Administrators can now refund that exact revision payment;
the revision earning and platform fee are reversed only after PayMongo confirms
success, and repeat requests cannot duplicate provider or accounting effects.

Disputes now preserve the existing NestJS contract. Opening a case targets the
exact delivery or revision purchase, pauses an active delivery-review deadline,
freezes only the affected earning, starts a 48-hour response window, stores
append-only private evidence, and records an auditable timeline. Participant and
administrator authorization is enforced server-side. Provider-win or closed
cases restore the prior earning state and remaining review time; client-win
cases keep the earning frozen until an administrator starts the idempotent
refund. A scheduled command moves expired response windows to administrator
review without selecting a winner automatically.

Messaging now supports the existing web and MAUI REST contracts. Inbox results
are snapshot-paginated with pinned conversations first, unread totals exclude
the user's own messages, opening a conversation atomically marks matching
message notifications read, and sending a message restores a hidden or archived
thread for both participants. Attachments pass through the same signature,
malware-scanning, private-storage, and participant-download boundary as order
files. The Hostinger static Web build deliberately uses bounded REST polling and
does not attempt Socket.IO connections; order workspaces refresh every 20
seconds and the application-level sync refreshes marketplace, orders, and
notifications every 10 seconds. The existing socket path remains enabled for
the NestJS/staging runtime. MAUI retains its existing REST fallback timers, so
the Laravel shared-hosting cutover does not depend on a persistent WebSocket
process.

Notifications and support now preserve the authenticated REST contracts as
well. Notification lists are recipient-scoped, unread counts are derived
server-side, and both individual and read-all actions are idempotent. Support
tickets remain private to their creator, return only the user's ten newest
submissions, and enforce the existing five-per-hour server-side limit.

Student profile, avatar, verification, and administrator moderation routes are
also implemented. Avatar and student-ID files remain in private storage and
pass signature and malware checks. Verification approval is serialized,
school-administrator review is restricted to the assigned school, and provider
role assignment occurs only after an authorized approval. Platform
administrators can manage verification, service moderation, and school-admin
assignments with cursor-bounded lists and server-side role enforcement.

Provider earnings and payout administration now preserve the existing REST
contracts. Earnings are reconciled from immutable ledger credits, observe the
24-hour withdrawal hold, and exclude active disputes, refunds, and payout
reservations. Payout requests are idempotent, reserve each exact earning, and
can only use an active administrator-reviewed destination. Cancellation or
rejection releases the reservation without changing its original eligibility
timestamp. Approval never claims that funds moved: an administrator must start
manual processing and record matching amount, reference, timestamp, and note
evidence before earnings become paid out. Automated disbursement remains
disabled until a production payout-provider adapter is implemented. New payout
destinations retain the normalized transfer identifier with AES-256-GCM
encryption under the separate `PAYOUT_DESTINATION_ENCRYPTION_KEY`; all normal
responses remain masked. Only an authenticated platform administrator can use
the explicit no-store reveal route, each reveal is security logged without the
identifier, and legacy destinations lacking recoverable encrypted details must
be recreated before review or payout approval.

The complete Laravel test suite passes on both SQLite and MySQL 8.4 with 41
tests and 668 assertions. The MySQL run exercises the production database
engine's foreign-key, collation, transaction, and table-name behavior. The
regenerated forward-only production schema applies cleanly with 49 domain
tables and 106 foreign-key constraints. All application and feature-test PHP
files pass the formatter gate. A reachable ClamAV service remains a deployment
prerequisite and must be exercised in staging.

Production clients must remain on NestJS until administrator refund
reconciliation is exercised against live-mode evidence, and the documented
manual payout procedure, staging file scanning, polling behavior, and
data-reconciliation gates pass.

## Schema generation

`laravel-api/scripts/generate-mysql-schema.mjs` converts the authoritative
Prisma schema to a MySQL-compatible Prisma schema and deterministic SQL. It
preserves Prisma table and column names so the data migration and API port can
be reconciled directly. PostgreSQL UUID columns become `CHAR(36)`, and the only
PostgreSQL scalar-list field (`ProviderProfile.skills`) becomes JSON. Content
fields whose API contracts exceed MySQL's default 191-character Prisma string
mapping are explicitly generated as `TEXT`; identifiers, indexed values, and
short labels remain bounded `VARCHAR` columns.

Regenerate after every Prisma schema change:

```powershell
node laravel-api/scripts/generate-mysql-schema.mjs
```

The production schema migration is intentionally forward-only. A failed or
reversed production cutover must restore a verified database backup; it must
never attempt a destructive automatic rollback.

Composer dependency resolution is pinned to PHP 8.2, matching the supported
Hostinger Laravel runtime. The schema gate is exercised against MySQL 8.4 and
must continue to produce 49 domain tables and 106 foreign-key constraints.

## Data migration and reconciliation

The `campusgig:migrate-postgres-to-mysql` command reads the PostgreSQL source
and writes only to the configured MySQL target. It refuses to execute when the
target contains any domain rows, requires identical table and column sets,
converts PostgreSQL arrays to MySQL JSON, copies all 49 tables in one target
transaction, checks every foreign-key relationship, and compares per-table row
counts and canonical SHA-256 content hashes. Reports contain counts and hashes,
never connection strings or credentials.

The machine running the command must have both `pdo_pgsql` and `pdo_mysql`.
The repository PHP test image includes both. Run `php artisan migrate --force`
against the empty MySQL database first. This applies the generated CampusGig
schema and creates Laravel's cache and queue infrastructure tables. The data
migrator explicitly excludes those target-only infrastructure tables from the
49-table source reconciliation. Then set the normal `DB_*` target variables
plus a read-only PostgreSQL URL in `MIGRATION_SOURCE_DATABASE_URL`.

Run a non-mutating preflight first:

```powershell
php artisan campusgig:migrate-postgres-to-mysql --report=preflight.json
```

For the cutover, stop API writes, create and verify a final PostgreSQL backup,
then run:

```powershell
php artisan campusgig:migrate-postgres-to-mysql --execute --report=cutover.json
```

The command writes reports under `storage/app/migration-reports`. A failed copy
rolls back the target and re-enables foreign-key checks. It never truncates or
deletes target data, and it never modifies the source. Private files are not
database rows: copy the private storage namespaces separately, compare file
counts and hashes, and keep the PostgreSQL/database and file backups together
for rollback. Do not start Laravel or change client API URLs until both the
database report and the private-file reconciliation pass.
