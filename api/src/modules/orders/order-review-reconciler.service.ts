import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OrdersService } from "./orders.service";

@Injectable()
export class OrderReviewReconciler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(OrderReviewReconciler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (!this.enabled()) return;
    const interval = this.integer("ORDER_REVIEW_POLL_INTERVAL_MS", 60_000);
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), interval);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(now = new Date()) {
    if (this.running) return { examined: 0, completed: 0, failed: 0 };
    this.running = true;
    let completed = 0;
    let failed = 0;
    try {
      const batchSize = this.integer("ORDER_REVIEW_BATCH_SIZE", 25);
      const orderIds = await this.orders.expiredReviewOrderIds(now, batchSize);
      for (const orderId of orderIds) {
        try {
          const result = await this.orders.reconcileExpiredReview(orderId, now);
          if (result.transitioned) {
            completed += 1;
            this.logger.log(`Auto-completed expired order review ${orderId}`);
          }
        } catch (error) {
          failed += 1;
          this.logger.error(
            `Review reconciliation failed for order ${orderId}: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
      }
      return { examined: orderIds.length, completed, failed };
    } finally {
      this.running = false;
    }
  }

  private enabled() {
    const configured = this.config.get<string>(
      "ORDER_REVIEW_RECONCILER_ENABLED",
    );
    if (configured) return configured === "true";
    return this.config.get<string>("NODE_ENV") !== "test";
  }

  private integer(key: string, fallback: number) {
    const parsed = Number(this.config.get<string>(key) ?? fallback);
    return Number.isSafeInteger(parsed) ? parsed : fallback;
  }
}
