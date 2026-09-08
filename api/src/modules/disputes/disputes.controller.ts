import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OpenDisputeDto } from "./dto/open-dispute.dto";
import { DisputesService } from "./disputes.service";

@ApiTags("disputes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders/:orderId/disputes")
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  forOrder(
    @Req() request: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    return this.disputes.forOrder(request.auth.sub, orderId);
  }

  @Post()
  open(
    @Req() request: AuthenticatedRequest,
    @Param("orderId") orderId: string,
    @Body() input: OpenDisputeDto,
  ) {
    return this.disputes.open(
      request.auth.sub,
      orderId,
      input.reason,
      input.details,
    );
  }
}
