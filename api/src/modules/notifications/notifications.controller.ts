import { Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}
  @Get() list(@Req() request: AuthenticatedRequest) {
    return this.notifications.list(request.auth.sub);
  }
  @Patch(":id/read") markRead(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.notifications.markRead(request.auth.sub, id);
  }
}
