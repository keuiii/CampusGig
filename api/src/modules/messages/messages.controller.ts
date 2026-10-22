import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SendMessageDto } from "./dto/send-message.dto";
import { MessagesService } from "./messages.service";
import { SendAttachmentDto } from "./dto/send-attachment.dto";
import { orderFileUploadOptions } from "../orders/order-file-upload.config";
import { ListMessagesDto } from "./dto/list-messages.dto";

@ApiTags("messages")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders/:orderId/messages")
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}
  @Get() list(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messages.list(request.auth.sub, orderId, query);
  }
  @Post("attachments")
  @UseInterceptors(FilesInterceptor("files", 3, orderFileUploadOptions))
  attach(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: SendAttachmentDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.messages.sendAttachments(
      request.auth.sub,
      orderId,
      input.body,
      files ?? [],
    );
  }
  @Post() send(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: SendMessageDto,
  ) {
    return this.messages.send(request.auth.sub, orderId, input.body);
  }
}
