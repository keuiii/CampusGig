import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MalwareScannerService } from "../common/storage/malware-scanner.service";
import { StorageService } from "../common/storage/storage.service";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService, type DependencyName } from "./metrics.service";

export type ReadinessResult = { status: "ready" | "not_ready" };

@Injectable()
export class SystemHealthService {
  private readonly timeoutMs: number;
  private cached?: { expiresAt: number; result: ReadinessResult };
  private inFlight?: Promise<ReadinessResult>;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly scanner: MalwareScannerService,
    private readonly storage: StorageService,
    private readonly metrics: MetricsService,
  ) {
    const timeout = Number(config.get<string>("READINESS_TIMEOUT_MS") ?? 5_000);
    if (!Number.isInteger(timeout) || timeout < 500 || timeout > 15_000)
      throw new Error("READINESS_TIMEOUT_MS must be between 500 and 15000");
    this.timeoutMs = timeout;
  }

  async readiness(): Promise<ReadinessResult> {
    if (this.cached && this.cached.expiresAt > Date.now())
      return this.cached.result;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runChecks();
    try {
      const result = await this.inFlight;
      this.cached = {
        expiresAt: Date.now() + (result.status === "ready" ? 10_000 : 3_000),
        result,
      };
      return result;
    } finally {
      this.inFlight = undefined;
    }
  }

  private async runChecks(): Promise<ReadinessResult> {
    const checks: Array<[DependencyName, () => Promise<unknown>]> = [
      ["database", () => this.prisma.$queryRaw`SELECT 1`],
      ["malware_scanner", () => this.scanner.healthCheck()],
      ["storage", () => this.storage.healthCheck()],
    ];
    const results = await Promise.all(
      checks.map(async ([name, check]) => {
        try {
          await this.withTimeout(check(), name);
          this.metrics.setDependency(name, true);
          return true;
        } catch {
          this.metrics.setDependency(name, false);
          return false;
        }
      }),
    );
    return { status: results.every(Boolean) ? "ready" : "not_ready" };
  }

  private withTimeout<T>(promise: Promise<T>, name: DependencyName) {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`${name} readiness check timed out`)),
        this.timeoutMs,
      );
      timeout.unref?.();
      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  }
}
