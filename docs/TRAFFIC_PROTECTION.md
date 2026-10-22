# CampusGig traffic and DDoS protection

CampusGig now applies token-bucket limits before controller work begins. General
API traffic is allowed a campus-NAT-friendly burst, authentication endpoints have
a stricter IP policy, and order creation also has a five-request-per-minute limit
for each authenticated account. Internal health checks bypass throttling while
public health traffic remains limited. Socket.IO connection bursts are rejected
before JWT verification and database session checks.

Order creation accepts `clientRequestId`. Updated web and mobile clients retain
that UUID while retrying the same form. PostgreSQL uniquely binds it to the client,
so simultaneous requests and uncertain network retries return one persisted order
instead of creating duplicate conversations, notifications, or future payments.
Older installed clients remain compatible but do not gain retry deduplication until
they update.

## Important boundary

The in-process limiter reduces abusive application traffic and bounds its memory,
but it is not full DDoS protection. A sufficiently large attack can saturate the
server's network before NestJS or Caddy receives the request. Before production:

1. Proxy the domain through a managed edge network with DDoS protection and WAF.
2. Firewall ports 80 and 443 so the origin accepts traffic only from that edge.
3. Keep the origin IP private and rotate it if it has ever been exposed publicly.
4. Apply managed bot, login, registration, and API rate-limit rules at the edge.
5. Alert on 429 rate, 5xx rate, latency, database connections, CPU, memory, and
   bandwidth; retain edge and origin request logs with privacy-safe retention.
6. Before adding multiple API replicas, replace the in-memory limiter with a shared
   Redis-backed limiter and add the Socket.IO Redis adapter.

Application limits are deliberately not a substitute for account authorization,
database constraints, payment idempotency, or an edge WAF.

## Local read-only load check

Start PostgreSQL and the API, then run:

```powershell
npm run test:load
```

Defaults are 25 virtual users for 15 seconds against the public service list on
`127.0.0.1:4000`. Override with `LOAD_TEST_USERS`,
`LOAD_TEST_DURATION_SECONDS`, or `LOAD_TEST_API_URL`. The script refuses remote
targets unless `LOAD_TEST_ALLOW_REMOTE=true` is explicitly set. Run remote load
tests only against an authorized staging environment, never production or a
third-party host.
