import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { StorageService } from "../../common/storage/storage.service";
import { sendStoredFile } from "../../common/storage/storage-response";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OpenDisputeDto } from "./dto/open-dispute.dto";
import { DisputesService } from "./disputes.service";
import { disputeEvidenceUploadOptions } from "./dispute-evidence-upload.config";
import { SubmitDisputeResponseDto } from "./dto/submit-dispute-response.dto";

@ApiTags("disputes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders/:orderId/disputes")
export class DisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  forOrder(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    return this.disputes.forOrder(request.auth.sub, orderId);
  }

  @Post()
  @UseInterceptors(FilesInterceptor("files", 5, disputeEvidenceUploadOptions))
  open(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: OpenDisputeDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.disputes.open(
      request.auth.sub,
      orderId,
      input.reason,
      input.details,
      files ?? [],
    );
  }

  @Post(":disputeId/responses")
  @UseInterceptors(FilesInterceptor("files", 5, disputeEvidenceUploadOptions))
  respond(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("disputeId", ParseUUIDPipe) disputeId: string,
    @Body() input: SubmitDisputeResponseDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.disputes.submitResponse(
      request.auth.sub,
      orderId,
      disputeId,
      input.details,
      files ?? [],
    );
  }

  @Post(":disputeId/evidence")
  @UseInterceptors(FilesInterceptor("files", 5, disputeEvidenceUploadOptions))
  evidence(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("disputeId", ParseUUIDPipe) disputeId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.disputes.appendEvidence(
      request.auth.sub,
      orderId,
      disputeId,
      files ?? [],
    );
  }

  @Get(":disputeId/evidence/:evidenceId")
  async downloadEvidence(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Param("disputeId", ParseUUIDPipe) disputeId: string,
    @Param("evidenceId", ParseUUIDPipe) evidenceId: string,
    @Res() response: Response,
  ) {
    const evidence = await this.disputes.getEvidence(
      request.auth.sub,
      orderId,
      disputeId,
      evidenceId,
    );
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
}
