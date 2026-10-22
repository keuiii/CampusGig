# CampusGig deployment on Hostinger Premium

This deployment keeps the browser application on Hostinger static hosting and
runs the Laravel API on a PHP-capable Hostinger site. It does not require a VPS
or a continuously running Node.js process. The production hostnames are:

- `https://campusgig.net` - static Next.js export
- `https://api.campusgig.net` - Laravel API, document root `public/`

Do not change the current production clients until every cutover gate in this
document passes.

## 1. Hostinger prerequisites

Create a MySQL database and a least-privilege database user for CampusGig.
Create the `api` subdomain and enable SSL for the root domain, `www`, and the
API subdomain. The PHP runtime must be PHP 8.2 or newer with PDO MySQL,
OpenSSL, cURL, Fileinfo, Mbstring, and JSON enabled.

CampusGig uses phpMussel on Hostinger because shared hosting does not provide a
ClamAV daemon. Signature updates are downloaded from phpMussel's official
repository, integrity-checked, and activated atomically. Production fails
closed when signatures are missing, corrupt, or older than the configured age.
Do not set `MALWARE_SCANNER_DRIVER=disabled` for real users.

## 2. Prepare the API

Use this layout so application code and secrets stay outside the public root:

```text
domains/api.campusgig.net/
  laravel-api/     # full Laravel application
  public_html/     # only public files
```

Upload `laravel-api/` beside `public_html`, not inside it. Copy the contents of
`deploy/hostinger/api-public/` into `public_html/`, then copy any public assets
from `laravel-api/public/` without replacing the deployment `index.php`.
Never upload a local `.env`, credentials, migration reports, database backups,
or private keys into `public_html`.

Copy `deploy/hostinger/api.env.example` to `.env` on the server and fill each
blank value through Hostinger's secret/configuration controls. Generate fresh,
independent secrets. `PAYOUT_DESTINATION_ENCRYPTION_KEY` must be backed up and
must remain identical across deployments or saved payout identifiers cannot be
recovered. Use the PayMongo live secret and webhook secret only on the server.

Run from `laravel-api/`:

```text
composer install --no-dev --prefer-dist --optimize-autoloader
php artisan key:generate
php artisan campusgig:malware-signatures:update
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

Run `php artisan migrate --force` against a new, empty MySQL database. This
creates the 49 CampusGig tables plus Laravel's cache and queue infrastructure.
Do not run seeders. Ensure `storage/` and `bootstrap/cache/` are writable by the
PHP process while `.env` and the application source are not publicly served.

Add a Hostinger cron job that runs every minute:

```text
cd /absolute/path/to/laravel-api && php artisan schedule:run
```

The scheduler refreshes malware signatures daily. Run the signature update
command once during deployment so readiness can pass before the first cron run.

Also configure a queue worker if Hostinger supports supervised PHP processes.
The current core flows use database-backed durable state, but email delivery
must be verified with the selected production mail transport.

## 3. Build and upload the Web application

On the trusted build machine, from the repository root:

```powershell
$env:NEXT_PUBLIC_API_URL='https://api.campusgig.net'
pnpm build:hostinger
```

Upload the contents of `out/` to the `campusgig.net` public directory. The
build forces `NEXT_PUBLIC_REALTIME_MODE=polling`; there is no Node.js server or
Socket.IO dependency on Hostinger Premium. Never upload `.env.local`.

Alternatively, after the Web build, run `pnpm package:hostinger`. The generated
`deploy/hostinger/build/campusgig-hostinger.zip` contains separate Web and API
upload trees, excludes secrets, tests, logs, private media, and signing keys,
and includes a SHA-256 manifest.

## 4. Migrate existing data

First rehearse using disposable databases. At cutover, stop all writes to the
NestJS API, create and verify a final PostgreSQL backup, and copy the private
storage tree without exposing it through the web root. On a trusted machine
with both PDO PostgreSQL and PDO MySQL, configure a read-only PostgreSQL source
and the new MySQL target, then run:

```text
php artisan campusgig:migrate-postgres-to-mysql --report=preflight.json
php artisan campusgig:migrate-postgres-to-mysql --execute --report=cutover.json
```

In hPanel, temporarily allow only the trusted migration machine's current IP
under **Remote MySQL** and use the MySQL hostname shown there on port 3306.
Never select **Any Host** for the production database. Remove the temporary
remote-access rule immediately after reconciliation; the deployed API should
then use Hostinger's local database hostname.

Proceed only if all 49 table counts and canonical hashes reconcile and the
private-file count/hash reconciliation also passes. Preserve the final database
and file backups together. The migration never resets or seeds either database.

## 5. Configure PayMongo

Create the live webhook in PayMongo with this exact URL:

```text
https://api.campusgig.net/api/v1/payments/paymongo/webhook
```

Subscribe to the payment and refund event types used by the integration and
place the matching signing secret in `PAYMONGO_WEBHOOK_SECRET`. Verify one
low-value GCash checkout end to end: checkout creation, successful hosted
payment, return to CampusGig rather than localhost, signed webhook receipt,
`PAID` order state, immutable ledger credit, and duplicate-webhook idempotency.
Then exercise a permitted refund and verify the PayMongo result and reversal.

Real-money launch also requires the documented manual payout procedure. The
system records review, processing, and transfer evidence but does not claim to
move provider funds automatically.

## 6. Build the Android application

Release APKs must point to the public HTTPS API and must be signed with the
team's private release keystore:

```powershell
dotnet publish maui/CampusGig.Mobile/CampusGig.Mobile.csproj `
  -f net10.0-android -c Release `
  -p:CampusGigApiBaseUrl=https://api.campusgig.net/api/v1 `
  -p:AndroidKeyStore=true `
  -p:AndroidSigningKeyStore=C:\secure\campusgig-release.keystore `
  -p:AndroidSigningKeyAlias=campusgig `
  -p:AndroidSigningKeyPass=env:CAMPUSGIG_KEY_PASSWORD `
  -p:AndroidSigningStorePass=env:CAMPUSGIG_STORE_PASSWORD
```

The project rejects a Release build without an HTTPS API URL. Keep the release
keystore and passwords outside the repository. It also rejects missing signing
settings and the standard Android debug signing identity. Verify the final APK
certificate before distribution. Installing an APK directly is valid for the
presentation and controlled testers; Android will ask users to allow installs
from that source. Play Store distribution is a separate release process.

## 7. Go-live gates

Before DNS/client cutover, verify all of the following:

- `GET https://api.campusgig.net/api/v1/health` returns `status: ok`.
- `GET https://api.campusgig.net/api/v1/health/ready` returns `status: ready`.
- Browser register, verification email, login, MFA, refresh, and logout work.
- Android login and token refresh work off USB and on mobile data.
- Provider listing create/edit/media, moderation, discovery, and booking work.
- GCash payment returns to CampusGig and webhook reconciliation reaches `PAID`.
- Order acceptance, delivery upload/download, revision, completion, and review work.
- Dispute evidence, administrator resolution, and an eligible refund work.
- Provider earnings and the complete manual payout evidence workflow work.
- Uploaded media is rejected when phpMussel signatures are unavailable or stale and accepted when healthy.
- Scheduled review/dispute reconciliation runs from the Hostinger cron job.
- Web polling reflects messages, orders, notifications, and marketplace changes.
- Database and private-file backups can be restored in a rehearsal.

If any gate fails, keep or restore the existing NestJS API endpoint and database.
DNS changes, the Web API URL, and the signed APK are separate cutover controls;
retain the previous Web build and APK until the observation window passes.
