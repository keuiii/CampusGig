# CampusGig monitoring and alert response

CampusGig staging uses Prometheus, Alertmanager, and node-exporter on the private
Compose `backend` network. Their ports are not published and Caddy returns 404
for the API metrics path. The API metrics endpoint additionally requires a
bearer secret loaded from a Docker secret file.

## Deploy safely

Create the metrics secret before validating or starting Compose. Use at least
32 cryptographically random characters and do not commit it:

```bash
mkdir -p deploy/staging/secrets backups/metrics
openssl rand -hex 32 > deploy/staging/secrets/metrics_token
chmod 600 deploy/staging/secrets/metrics_token
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml config --quiet
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml up -d
```

Run the verified backup drill from the repository root at least daily. A
successful isolated restore atomically updates
`backups/metrics/campusgig-backup.prom`, which node-exporter exposes to
Prometheus:

```bash
npm run db:backup:verify -- --compose-file deploy/staging/compose.yml --env-file deploy/staging/.env
```

Use a host scheduler to run the command. Alerting intentionally checks the age
of the latest successful restore verification, not merely the age of a dump.

## Private operator access

Do not add public Compose ports or Caddy routes for Prometheus or Alertmanager.
For browser access, use a temporary Compose override that binds each UI only to
`127.0.0.1`, then forward those loopback ports over SSH. Remove the override and
recreate the services after the operator session. For routine checks, prefer
the `docker compose exec` commands below so no listening host port is needed.

Useful checks:

```bash
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml ps
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml exec prometheus promtool check config /etc/prometheus/prometheus.yml
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml exec prometheus promtool check rules /etc/prometheus/alerts.yml
docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yml exec alertmanager amtool check-config /etc/alertmanager/alertmanager.yml
```

## Alerts and first response

| Alert                                       | Meaning                                           | First response                                                                                   |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `CampusGigApiDown`                          | Prometheus cannot scrape the API for two minutes. | Check API health, container logs, secret mounts, and network state.                              |
| `CampusGigDependencyUnavailable`            | Database, ClamAV, or S3 failed readiness.         | Inspect the named dependency before restarting the API.                                          |
| `CampusGigHighServerErrorRate`              | More than 5% of active traffic is returning 5xx.  | Correlate API logs with route and deployment timing; do not log user data.                       |
| `CampusGigHighApiLatency`                   | API p95 exceeded two seconds for ten minutes.     | Check PostgreSQL load, external service latency, CPU, and memory.                                |
| `CampusGigPayMongoWebhookProcessingFailure` | A verified webhook failed during processing.      | Check PayMongo delivery and application logs; never bypass signature or idempotency checks.      |
| `CampusGigPayMongoWebhookIngressRejected`   | Invalid webhook traffic exceeded the threshold.   | Compare traffic with PayMongo delivery logs and investigate abuse without relaxing verification. |
| `CampusGigLowDiskSpace`                     | A host filesystem has under 15% free.             | Identify growth, preserve evidence, and expand or safely clean the exact target.                 |
| `CampusGigBackupVerificationMissing`        | No successful restore-verification metric exists. | Run the drill and verify the temporary database is removed.                                      |
| `CampusGigBackupVerificationStale`          | The last successful drill is older than 26 hours. | Repair the scheduled drill and immediately produce a verified backup.                            |

The checked-in Alertmanager receiver keeps alerts visible without sending data
to an external service. Before staging certification, configure an approved
email or incident receiver using secret-backed credentials, validate it with
`amtool`, and send a controlled test alert.

## Privacy and cardinality controls

HTTP metrics include only method, normalized route, and status. Order numbers,
UUIDs, long identifiers, and query strings are removed before recording. Do not
add email addresses, names, raw URLs, payment identifiers, or exception text as
metric labels.
