import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ListDisputesDto } from "./dto/list-disputes.dto";
import { ResolveDisputeDto } from "./dto/resolve-dispute.dto";
import { DisputesService } from "./disputes.service";

@ApiTags("admin-disputes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/disputes")
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Get()
  list(@Query() query: ListDisputesDto) {
    return this.disputes.list(query.status);
  }

  @Post(":id/review")
  beginReview(@Param("id") id: string) {
    return this.disputes.beginReview(id);
  }

  @Post(":id/resolve")
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() input: ResolveDisputeDto,
  ) {
    return this.disputes.resolve(
      request.auth.sub,
      id,
      input.status,
      input.resolutionNote,
    );
  }
}
