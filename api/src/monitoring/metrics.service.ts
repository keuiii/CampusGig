import { Injectable } from "@nestjs/common";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "@prometheus-io/client";

export type DependencyName = "database" | "malware_scanner" | "storage";
export type WebhookFailureStage = "payload" | "signature" | "processing";

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly requests = new Counter({
    name: "campusgig_http_requests_total",
    help: "Total HTTP requests handled by the CampusGig API.",
    labelNames: ["method", "route", "status"] as const,
    registers: [this.registry],
  });
  private readonly requestDuration = new Histogram({
    name: "campusgig_http_request_duration_seconds",
    help: "CampusGig API request duration in seconds.",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });
  private readonly dependencyUp = new Gauge({
    name: "campusgig_dependency_up",
    help: "Whether a required CampusGig dependency passed its latest readiness check.",
    labelNames: ["dependency"] as const,
    registers: [this.registry],
  });
  private readonly webhookFailures = new Counter({
    name: "campusgig_paymongo_webhook_failures_total",
    help: "PayMongo webhook failures grouped by bounded processing stage.",
    labelNames: ["stage"] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({
      prefix: "campusgig_node_",
      register: this.registry,
    });
    for (const dependency of [
      "database",
      "malware_scanner",
      "storage",
    ] as const)
      this.dependencyUp.set({ dependency }, 0);
  }

  recordHttp(method: string, route: string, status: number, seconds: number) {
    const labels = { method, route, status: String(status) };
    this.requests.inc(labels);
    this.requestDuration.observe(labels, seconds);
  }

  setDependency(dependency: DependencyName, ready: boolean) {
    this.dependencyUp.set({ dependency }, ready ? 1 : 0);
  }

  recordWebhookFailure(stage: WebhookFailureStage) {
    this.webhookFailures.inc({ stage });
  }

  contentType() {
    return this.registry.contentType;
  }

  render() {
    return this.registry.metrics();
  }
}
