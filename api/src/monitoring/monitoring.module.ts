import { Global, Module } from "@nestjs/common";
import { MetricsAccessGuard } from "./metrics-access.guard";
import { MetricsController } from "./metrics.controller";
import { HttpMetricsMiddleware } from "./http-metrics.middleware";
import { MetricsService } from "./metrics.service";
import { SystemHealthService } from "./system-health.service";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    MetricsAccessGuard,
    HttpMetricsMiddleware,
    SystemHealthService,
  ],
  exports: [MetricsService, HttpMetricsMiddleware, SystemHealthService],
})
export class MonitoringModule {}
