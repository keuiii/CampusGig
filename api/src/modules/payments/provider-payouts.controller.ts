import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
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
  ConfirmPayoutActionDto,
  CreatePayoutDestinationDto,
  RequestProviderPayoutDto,
} from "./dto/provider-payout.dto";
import { ProviderPayoutsService } from "./provider-payouts.service";

@ApiTags("provider-payouts")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PROVIDER)
@Controller("provider/payouts")
export class ProviderPayoutsController {
  constructor(private readonly payouts: ProviderPayoutsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.payouts.providerList(request.auth.sub);
  }

  @Get("destinations")
  destinations(@Req() request: AuthenticatedRequest) {
    return this.payouts.destinations(request.auth.sub);
  }

  @Post("destinations")
  createDestination(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreatePayoutDestinationDto,
  ) {
    return this.payouts.createDestination(request.auth.sub, input);
  }

  @Post("destinations/:destinationId/deactivate")
  deactivateDestination(
    @Req() request: AuthenticatedRequest,
    @Param("destinationId", ParseUUIDPipe) destinationId: string,
    @Body() _input: ConfirmPayoutActionDto,
  ) {
    return this.payouts.deactivateDestination(request.auth.sub, destinationId);
  }

  @Post()
  request(
    @Req() request: AuthenticatedRequest,
    @Body() input: RequestProviderPayoutDto,
  ) {
    return this.payouts.request(request.auth.sub, input);
  }

  @Post(":payoutId/cancel")
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param("payoutId", ParseUUIDPipe) payoutId: string,
    @Body() _input: ConfirmPayoutActionDto,
  ) {
    return this.payouts.cancel(request.auth.sub, payoutId);
  }
}
