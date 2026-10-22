import { Controller, Get, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { MetricsAccessGuard } from "./metrics-access.guard";
import { MetricsService } from "./metrics.service";

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get("metrics")
  @UseGuards(MetricsAccessGuard)
  async metricsEndpoint(@Res() response: Response) {
    response.setHeader("Content-Type", this.metrics.contentType());
    response.setHeader("Cache-Control", "no-store");
    response.send(await this.metrics.render());
  }
}
