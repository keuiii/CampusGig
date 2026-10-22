import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CreateSupportTicketDto } from "./dto/create-support-ticket.dto";
import { SupportService } from "./support.service";

@ApiTags("support")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("support/tickets")
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateSupportTicketDto,
  ) {
    return this.support.create(
      request.auth.sub,
      input.category,
      input.subject,
      input.message,
      input.source,
    );
  }

  @Get("mine")
  mine(@Req() request: AuthenticatedRequest) {
    return this.support.mine(request.auth.sub);
  }
}
