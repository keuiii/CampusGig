import { Body, Controller, Get, Param, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { basename, resolve } from "node:path";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrdersService } from "./orders.service";
import { RejectOrderDto } from "./dto/reject-order.dto";
import { CreateReviewDto } from "./dto/create-review.dto";
import { RequestRevisionDto } from "./dto/request-revision.dto";
import { SubmitDeliveryDto } from "./dto/submit-delivery.dto";
import { orderFileStorageRoot, orderFileUploadOptions } from "./order-file-upload.config";
@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get() findAll(@Req() request: AuthenticatedRequest, @Query("scope") scope?: string) { return this.orders.list(request.auth.sub, scope === "provider" ? "provider" : "client"); }
  @Get(":id") findOne(@Req() request: AuthenticatedRequest, @Param("id") id: string) { return this.orders.findOne(request.auth.sub, id); }
  @Post() create(@Req() request: AuthenticatedRequest, @Body() input: CreateOrderDto) { return this.orders.create(request.auth.sub, input); }
  @Post(":id/accept") accept(@Req() request: AuthenticatedRequest, @Param("id") id: string) { return this.orders.accept(request.auth.sub, id); }
  @Post(":id/reject") reject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() input: RejectOrderDto) { return this.orders.reject(request.auth.sub, id, input.reason); }
  @Post(":id/start") start(@Req() request: AuthenticatedRequest, @Param("id") id: string) { return this.orders.start(request.auth.sub, id); }
  @Post(":id/deliver") @UseInterceptors(FilesInterceptor("files", 5, orderFileUploadOptions))
  deliver(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() input: SubmitDeliveryDto, @UploadedFiles() files: Express.Multer.File[]) { return this.orders.deliver(request.auth.sub, id, input.note, files ?? []); }
  @Get(":id/files/:fileId") async file(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Param("fileId") fileId: string, @Res() response: Response) { const file = await this.orders.getFile(request.auth.sub, id, fileId); return response.download(resolve(orderFileStorageRoot, basename(file.storagePath)), file.originalName); }
  @Post(":id/revision") revision(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() input: RequestRevisionDto) { return this.orders.requestRevision(request.auth.sub, id, input.instructions); }
  @Post(":id/complete") complete(@Req() request: AuthenticatedRequest, @Param("id") id: string) { return this.orders.complete(request.auth.sub, id); }
  @Post(":id/review") review(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() input: CreateReviewDto) { return this.orders.review(request.auth.sub, id, input); }
}
