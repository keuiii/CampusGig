import {
  Body,
  Controller,
  Get,
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
import { AdminRefundExceptionDto } from "./dto/admin-refund.dto";
import { ListRefundsDto } from "./dto/list-refunds.dto";
import { RefundsService } from "./refunds.service";

@ApiTags("admin-refunds")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/refunds")
export class AdminRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  list(@Query() query: ListRefundsDto) {
    return this.refunds.adminList(query.status, query.limit);
  }

  @Get("stale-revisions")
  staleRevisions() {
    return this.refunds.staleRevisionList();
  }

  @Get(":id")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.refunds.detail(id);
  }

  @Post("disputes/:disputeId")
  fromDispute(
    @Req() request: AuthenticatedRequest,
    @Param("disputeId", ParseUUIDPipe) disputeId: string,
  ) {
    return this.refunds.requestFromDispute(request.auth.sub, disputeId);
  }

  @Post("stale-revisions/:revisionPurchaseId")
  staleRevision(
    @Req() request: AuthenticatedRequest,
    @Param("revisionPurchaseId", ParseUUIDPipe) revisionPurchaseId: string,
  ) {
    return this.refunds.remediateStaleRevision(
      request.auth.sub,
      revisionPurchaseId,
    );
  }

  @Post("exceptions")
  exception(
    @Req() request: AuthenticatedRequest,
    @Body() input: AdminRefundExceptionDto,
  ) {
    return this.refunds.requestAdminException({
      adminId: request.auth.sub,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      policyNote: input.policyNote,
    });
  }

  @Post(":id/reconcile")
  reconcile(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.refunds.reconcile(request.auth.sub, id);
  }
}
