import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { MetricsService } from "./metrics.service";

const IDENTIFIER_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|CG-[A-Z0-9-]+|[a-z0-9_-]{24,})$/i;

export function normalizeMetricRoute(rawUrl: string) {
  const path = rawUrl.split("?", 1)[0] || "/";
  const normalized = path
    .split("/")
    .map((segment) => (IDENTIFIER_SEGMENT.test(segment) ? ":id" : segment))
    .join("/");
  return normalized.length <= 160 ? normalized : "/oversized-route";
}

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction) {
    const started = process.hrtime.bigint();
    response.once("finish", () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      this.metrics.recordHttp(
        request.method,
        normalizeMetricRoute(request.originalUrl || request.path),
        response.statusCode,
        seconds,
      );
    });
    next();
  }
}
