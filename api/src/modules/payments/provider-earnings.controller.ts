import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ListProviderEarningsDto } from "./dto/list-provider-earnings.dto";
import { ProviderEarningsService } from "./provider-earnings.service";

@ApiTags("provider-earnings")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PROVIDER)
@Controller("provider/earnings")
export class ProviderEarningsController {
  constructor(private readonly earnings: ProviderEarningsService) {}

  @Get("summary")
  summary(@Req() request: AuthenticatedRequest) {
    return this.earnings.summary(request.auth.sub);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListProviderEarningsDto,
  ) {
    return this.earnings.list(
      request.auth.sub,
      query.cursor,
      query.limit,
    );
  }
}
