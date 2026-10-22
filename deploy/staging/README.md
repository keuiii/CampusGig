# CampusGig staging

This stack runs PostgreSQL, database migrations, the NestJS API, Next.js web app,
ClamAV, and automatic HTTPS through Caddy. File objects stay in a private managed
S3-compatible bucket; only short-lived signed downloads leave the bucket. Only
ports 80 and 443 are published by the host.

Prometheus, Alertmanager, and node-exporter run only on the private backend
network. Follow `docs/MONITORING.md` to create the metrics secret, validate the
rules, schedule restore verification, and connect a real staging alert receiver.

## Required infrastructure

- A Linux server with Docker Engine and the Compose plugin.
- A DNS `A`/`AAAA` record for the staging domain pointing to that server.
- A private S3-compatible bucket with public access blocked and staging-only
  credentials. Include bucket-level list/head permission limited to the staging
  bucket and object read/write/delete permission limited to its staging prefix.
  AWS S3, Cloudflare R2, or another provider that accepts the configured
  server-side-encryption request can be used.
- A verified Resend sender (preferred) or Gmail app password.
- Google OAuth web and Android clients configured for the staging app.
- PayMongo sandbox keys and a sandbox webhook.

Pin container image digests before treating staging as a production release
candidate. Never reuse production database, storage, OAuth, email, or payment
credentials in this environment.

For public production traffic, place a managed DDoS-protected WAF in front of
Caddy and firewall the origin so it accepts only that provider's traffic. The
application limiter is a defense-in-depth control, not a replacement for edge
capacity. See `docs/TRAFFIC_PROTECTION.md` before exposing the service.

## First deployment

From the repository root on the server:

```bash
cp deploy/staging/.env.staging.example deploy/staging/.env
# Edit deploy/staging/.env and replace every example value.
mkdir -p deploy/staging/secrets backups/metrics
openssl rand -hex 32 > deploy/staging/secrets/metrics_token
chmod 600 deploy/staging/secrets/metrics_token
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml config
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml build
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml up -d
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml ps
```

Caddy obtains and renews the TLS certificate after DNS resolves and ports 80/443
are reachable. The API waits for PostgreSQL migrations and a healthy ClamAV
daemon before it starts accepting traffic.

## External service setup

1. Keep the S3 bucket private. Grant the staging key only object read/write/delete
   access for the staging bucket/prefix. Confirm uploads and signed downloads work.
2. Configure the PayMongo sandbox webhook as:
   `https://YOUR_DOMAIN/api/v1/payments/paymongo/webhook`
3. Store the webhook signing secret in `PAYMONGO_WEBHOOK_SECRET` and restart the
   API after changing it.
4. Add `https://YOUR_DOMAIN` to the Google web client's authorized JavaScript
   origins. Keep Android package/signing certificate settings on the Android OAuth
   client.
5. Send a real verification email and test its password-change review link.

## Staging mobile build

Release builds intentionally fail when no HTTPS API endpoint is supplied:

```powershell
dotnet publish maui/CampusGig.Mobile/CampusGig.Mobile.csproj `
  -f net10.0-android -c Release `
  -p:CampusGigApiBaseUrl=https://YOUR_DOMAIN/api/v1
```

The resulting app talks directly to staging; it does not require localhost, ADB
reverse, or ngrok. Continue using Debug builds for emulator/local API work.

## Smoke test

1. Open `https://YOUR_DOMAIN` and confirm the browser reports a valid certificate.
2. Open `https://YOUR_DOMAIN/api/v1/health` and confirm `status` is `ok`. Confirm
   `/api/v1/health/ready` and `/api/v1/metrics` both return 404 through Caddy,
   then run the internal readiness check from the host:
   `docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml exec api node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(async r=>{console.log(r.status,await r.text());if(!r.ok)process.exit(1)})"`.
3. Register, verify email, sign in, and restore the session after reopening.
4. Complete one sandbox order from request through PayMongo return, webhook
   confirmation, delivery, completion, and review.
5. Confirm the provider dashboard updates live and the private file downloads via
   a signed URL.
6. Confirm direct anonymous S3 object access is denied.

Useful diagnostics:

```bash
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml ps
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml logs --tail=200 api web caddy clamav
```
