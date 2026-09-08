import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { PaymentLedgerService } from "./payment-ledger.service";

@ApiTags("payments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders/:orderId/payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentLedgerService) {}

  @Get()
  forOrder(
    @Req() request: AuthenticatedRequest,
    @Param("orderId") orderId: string,
  ) {
    return this.payments.forOrder(request.auth.sub, orderId);
  }
}
