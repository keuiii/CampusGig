import { Controller, Get, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { SystemHealthService } from "./monitoring/system-health.service";

@ApiTags("system")
@Controller()
export class AppController {
  constructor(private readonly systemHealth: SystemHealthService) {}

  @Get("health")
  health() {
    return {
      status: "ok",
      service: "campusgig-api",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("health/ready")
  async readiness(@Res({ passthrough: true }) response: Response) {
    const result = await this.systemHealth.readiness();
    if (result.status !== "ready") response.status(503);
    return result;
  }
}
