import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import {
  BeginManualPayoutDto,
  ListPayoutsDto,
  PayoutDecisionDto,
  ReviewPayoutDestinationDto,
  SettleManualPayoutDto,
} from "./dto/admin-payout.dto";
import { ProviderPayoutsService } from "./provider-payouts.service";

@ApiTags("admin-payouts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/payouts")
export class AdminPayoutsController {
  constructor(private readonly payouts: ProviderPayoutsService) {}

  @Get()
  list(@Query() query: ListPayoutsDto) {
    return this.payouts.adminList(query.limit);
  }

  @Get("destinations")
  destinations() {
    return this.payouts.adminDestinations();
  }

  @Post("destinations/:destinationId/review")
  reviewDestination(
    @Req() request: AuthenticatedRequest,
    @Param("destinationId", ParseUUIDPipe) destinationId: string,
    @Body() input: ReviewPayoutDestinationDto,
  ) {
    return this.payouts.reviewDestination(
      request.auth.sub,
      destinationId,
      input.note,
    );
  }

  @Get("destinations/:destinationId/sensitive-details")
  @Header("Cache-Control", "private, no-store")
  sensitiveDestinationDetails(
    @Req() request: AuthenticatedRequest,
    @Param("destinationId", ParseUUIDPipe) destinationId: string,
  ) {
    return this.payouts.sensitiveDestinationDetails(
      request.auth.sub,
      destinationId,
    );
  }

  @Get(":payoutId")
  detail(@Param("payoutId", ParseUUIDPipe) payoutId: string) {
    return this.payouts.adminDetail(payoutId);
  }

  @Post(":payoutId/approve")
  approve(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Body() input: PayoutDecisionDto,
  ) {
    return this.payouts.approve(request.auth.sub, payoutId, input.note);
  }

  @Post(":payoutId/reject")
  reject(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Body() input: PayoutDecisionDto,
  ) {
    return this.payouts.reject(request.auth.sub, payoutId, input.note);
  }

  @Post(":payoutId/manual-processing")
  beginManual(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Body() input: BeginManualPayoutDto,
  ) {
    return this.payouts.beginManual(request.auth.sub, payoutId, input.note);
  }

  @Post(":payoutId/manual-settle")
  settleManual(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Body() input: SettleManualPayoutDto,
  ) {
    return this.payouts.settleManual(request.auth.sub, payoutId, input);
  }
}
