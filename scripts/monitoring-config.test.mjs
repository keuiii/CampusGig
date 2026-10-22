import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("staging monitoring stays private and uses pinned releases", () => {
  const compose = read("deploy/staging/compose.yml");
  for (const [service, nextService] of [
    ["prometheus", "alertmanager"],
    ["alertmanager", "node-exporter"],
    ["node-exporter", "volumes"],
  ]) {
    const startMarker = `\n  ${service}:\n`;
    const endMarker =
      nextService === "volumes" ? "\nvolumes:\n" : `\n  ${nextService}:\n`;
    const section = compose.slice(
      compose.indexOf(startMarker),
      compose.indexOf(endMarker, compose.indexOf(startMarker) + 1),
    );
    assert.ok(section.length > 0, `${service} service is missing`);
    assert.doesNotMatch(section, /^\s+ports:/m);
    assert.match(section, /networks:\s*\n\s*- backend/);
  }
  assert.match(compose, /prom\/prometheus:v3\.15\.0/);
  assert.match(compose, /prom\/alertmanager:v0\.34\.1/);
  assert.match(compose, /prom\/node-exporter:v1\.12\.1/);
  assert.match(compose, /METRICS_TOKEN_FILE: \/run\/secrets\/metrics_token/);
  assert.match(compose, /health\/ready/);
});

test("edge routing blocks metrics before the general API proxy", () => {
  const caddy = read("deploy/staging/Caddyfile");
  const blocked = caddy.indexOf("respond @internalObservability 404");
  const proxied = caddy.indexOf("reverse_proxy @api");
  assert.ok(blocked >= 0 && proxied > blocked);
  assert.match(
    caddy,
    /@internalObservability path \/api\/v1\/metrics \/api\/v1\/health\/ready/,
  );
});

test("Prometheus watches every baseline failure mode", () => {
  const prometheus = read("deploy/staging/monitoring/prometheus.yml");
  const alerts = read("deploy/staging/monitoring/alerts.yml");
  assert.match(prometheus, /credentials_file: \/run\/secrets\/metrics_token/);
  assert.match(prometheus, /api:4000/);
  assert.match(prometheus, /node-exporter:9100/);
  for (const alert of [
    "CampusGigApiDown",
    "CampusGigDependencyUnavailable",
    "CampusGigHighServerErrorRate",
    "CampusGigHighApiLatency",
    "CampusGigPayMongoWebhookProcessingFailure",
    "CampusGigPayMongoWebhookIngressRejected",
    "CampusGigLowDiskSpace",
    "CampusGigBackupVerificationMissing",
    "CampusGigBackupVerificationStale",
  ])
    assert.match(alerts, new RegExp(`alert: ${alert}`));
});
