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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { StorageService } from "../../common/storage/storage.service";
import { sendStoredFile } from "../../common/storage/storage-response";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrdersService } from "./orders.service";
import { RejectOrderDto } from "./dto/reject-order.dto";
import { CreateReviewDto } from "./dto/create-review.dto";
import { RequestRevisionDto } from "./dto/request-revision.dto";
import { SubmitDeliveryDto } from "./dto/submit-delivery.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import { orderFileUploadOptions } from "./order-file-upload.config";
import { OrderCreationRateLimitGuard } from "../../security/order-creation-rate-limit.guard";
import { ListOrdersDto } from "./dto/list-orders.dto";
import { ProviderCorrectionDecisionDto } from "./dto/provider-correction-decision.dto";
@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders")
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
  ) {}
  @Get() findAll(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListOrdersDto,
  ) {
    return this.orders.list(
      request.auth.sub,
      query.scope ?? "client",
      query.view ?? "active",
      query.cursor,
      query.limit,
    );
  }
  @Get(":id") findOne(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.orders.findOne(request.auth.sub, id);
  }
  @Post()
  @UseGuards(OrderCreationRateLimitGuard)
  create(@Req() request: AuthenticatedRequest, @Body() input: CreateOrderDto) {
    return this.orders.create(request.auth.sub, input);
  }
  @Post(":id/accept") accept(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.orders.accept(request.auth.sub, id);
  }
  @Post(":id/reject") reject(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: RejectOrderDto,
  ) {
    return this.orders.reject(request.auth.sub, id, input.reason);
  }
  @Post(":id/cancel") cancel(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: CancelOrderDto,
  ) {
    return this.orders.cancel(request.auth.sub, id, input.reason);
  }
  @Post(":id/start") start(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.orders.start(request.auth.sub, id);
  }
  @Post(":id/deliver")
  @UseInterceptors(FilesInterceptor("files", 5, orderFileUploadOptions))
  deliver(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: SubmitDeliveryDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.orders.deliver(
      request.auth.sub,
      id,
      input.note,
      files ?? [],
      input.clientRequestId,
    );
  }
  @Get(":id/files/:fileId") async file(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @Res() response: Response,
  ) {
    const file = await this.orders.getFile(request.auth.sub, id, fileId);
    const delivery = await this.storage.delivery(
      "order-files",
      file.storagePath,
      {
        downloadName: file.originalName,
        contentType: file.mimeType,
      },
    );
    if (file.deliverySubmissionId)
      await this.orders.recordDeliveryFileAccess({
        orderId: id,
        deliverySubmissionId: file.deliverySubmissionId,
        fileId,
        userId: request.auth.sub,
      });
    return sendStoredFile(response, delivery, file.originalName);
  }
  @Post(":id/revision") revision(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: RequestRevisionDto,
  ) {
    return this.orders.requestRevision(
      request.auth.sub,
      id,
      input.instructions,
    );
  }
  @Post(":id/revisions/correction-claim") correctionClaim(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: RequestRevisionDto,
  ) {
    return this.orders.requestProviderCorrection(
      request.auth.sub,
      id,
      input.instructions,
    );
  }
  @Post(":id/revisions/:revisionId/correction-decision") correctionDecision(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("revisionId", ParseUUIDPipe) revisionId: string,
    @Body() input: ProviderCorrectionDecisionDto,
  ) {
    return this.orders.decideProviderCorrection(
      request.auth.sub,
      id,
      revisionId,
      input.accepted,
    );
  }
  @Post(":id/complete") complete(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.orders.complete(request.auth.sub, id);
  }
  @Post(":id/archive") archive(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.orders.updateVisibility(request.auth.sub, id, "archive");
  }
  @Post(":id/restore") restore(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.orders.updateVisibility(request.auth.sub, id, "restore");
  }
  @Post(":id/remove") removeFromList(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.orders.updateVisibility(request.auth.sub, id, "remove");
  }
  @Post(":id/review") review(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: CreateReviewDto,
  ) {
    return this.orders.review(request.auth.sub, id, input);
  }
}
