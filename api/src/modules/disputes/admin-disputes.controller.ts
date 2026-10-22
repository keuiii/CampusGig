import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { UserRole } from "@prisma/client";
import { StorageService } from "../../common/storage/storage.service";
import { sendStoredFile } from "../../common/storage/storage-response";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ListDisputesDto } from "./dto/list-disputes.dto";
import { ResolveDisputeDto } from "./dto/resolve-dispute.dto";
import { DisputesService } from "./disputes.service";
import { RequestDisputeResponseDto } from "./dto/request-dispute-response.dto";

@ApiTags("admin-disputes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller("admin/disputes")
export class AdminDisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@Query() query: ListDisputesDto) {
    return this.disputes.list(query.status, query.cursor, query.limit);
  }

  @Get(":id")
  detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.disputes.adminDetail(id);
  }

  @Get(":id/evidence/:evidenceId")
  async evidence(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("evidenceId", ParseUUIDPipe) evidenceId: string,
    @Res() response: Response,
  ) {
    const evidence = await this.disputes.getAdminEvidence(id, evidenceId);
    const delivery = await this.storage.delivery(
      "dispute-evidence",
      evidence.storagePath,
      {
        downloadName: evidence.originalName,
        contentType: evidence.mimeType,
      },
    );
    return sendStoredFile(response, delivery, evidence.originalName);
  }

  @Post(":id/request-response")
  requestResponse(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: RequestDisputeResponseDto,
  ) {
    return this.disputes.requestResponse(
      request.auth.sub,
      id,
      input.requestedFrom,
    );
  }

  @Post(":id/ready")
  ready(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.disputes.markReady(request.auth.sub, id);
  }

  @Post(":id/review")
  beginReview(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.disputes.beginReview(request.auth.sub, id);
  }

  @Post(":id/resolve")
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
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
