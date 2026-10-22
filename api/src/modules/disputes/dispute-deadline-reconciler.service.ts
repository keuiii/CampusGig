import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DisputesService } from "./disputes.service";

@Injectable()
export class DisputeDeadlineReconciler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DisputeDeadlineReconciler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly disputes: DisputesService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (!this.enabled()) return;
    const interval = this.integer("DISPUTE_DEADLINE_POLL_INTERVAL_MS", 60_000);
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), interval);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(now = new Date()) {
    if (this.running) return { examined: 0, readied: 0, failed: 0 };
    this.running = true;
    let readied = 0;
    let failed = 0;
    try {
      const batchSize = this.integer("DISPUTE_DEADLINE_BATCH_SIZE", 25);
      const ids = await this.disputes.expiredResponseDisputeIds(now, batchSize);
      for (const id of ids) {
        try {
          const result = await this.disputes.reconcileExpiredResponse(id, now);
          if (result.transitioned) readied += 1;
        } catch (error) {
          failed += 1;
          this.logger.error(
            `Dispute deadline reconciliation failed for ${id}: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
      }
      return { examined: ids.length, readied, failed };
    } finally {
      this.running = false;
    }
  }

  private enabled() {
    const configured = this.config.get<string>(
      "DISPUTE_DEADLINE_RECONCILER_ENABLED",
    );
    if (configured) return configured === "true";
    return this.config.get<string>("NODE_ENV") !== "test";
  }

  private integer(key: string, fallback: number) {
    const parsed = Number(this.config.get<string>(key) ?? fallback);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
