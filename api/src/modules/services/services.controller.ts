import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { StorageService } from "../../common/storage/storage.service";
import { sendStoredFile } from "../../common/storage/storage-response";
import { ListServicesDto } from "./dto/list-services.dto";
import { QuoteServiceDto } from "./dto/quote-service.dto";
import { ServicesService } from "./services.service";
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from "../auth/jwt-auth.guard";

@ApiTags("services")
@Controller("services")
export class ServicesController {
  constructor(
    private readonly services: ServicesService,
    private readonly storage: StorageService,
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  findAll(@Query() filters: ListServicesDto) {
    return this.services.findAll(filters);
  }
  @Get("saved/ids")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  savedIds(@Req() request: AuthenticatedRequest) {
    return this.services.savedIds(request.auth.sub);
  }
  @Get("saved")
  @Header("Cache-Control", "no-store")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  saved(
    @Req() request: AuthenticatedRequest,
    @Query() filters: ListServicesDto,
  ) {
    return this.services.findAll(filters, request.auth.sub);
  }
  @Put(":id/save")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  save(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.services.save(request.auth.sub, id);
  }
  @Delete(":id/save")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  unsave(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.services.unsave(request.auth.sub, id);
  }
  @Post(":id/quote")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  quote(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: QuoteServiceDto,
  ) {
    return this.services.quote(request.auth.sub, id, input.deliveryOption);
  }
  @Get(":id") findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.services.findOne(id);
  }
  @Get(":id/media/:mediaId") async media(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("mediaId", ParseUUIDPipe) mediaId: string,
    @Res() response: Response,
  ) {
    const media = await this.services.getPublicMedia(id, mediaId);
    return sendStoredFile(
      response,
      await this.storage.delivery("service-media", media.storagePath, {
        contentType: media.mimeType,
      }),
    );
  }
}
