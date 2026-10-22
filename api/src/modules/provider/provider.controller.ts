import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { UserRole } from "@prisma/client";
import { StorageService } from "../../common/storage/storage.service";
import { sendStoredFile } from "../../common/storage/storage-response";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { CreateServiceDto } from "./dto/create-service.dto";
import { UpdateProviderProfileDto } from "./dto/update-provider-profile.dto";
import { UpdateProviderAvailabilityDto } from "./dto/update-provider-availability.dto";
import { ProviderService } from "./provider.service";
import { serviceMediaUploadOptions } from "./service-media-upload.config";
@ApiTags("provider")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PROVIDER)
@Controller("provider")
export class ProviderController {
  constructor(
    private readonly providers: ProviderService,
    private readonly storage: StorageService,
  ) {}
  @Get("dashboard") dashboard(@Req() request: AuthenticatedRequest) {
    return this.providers.dashboard(request.auth.sub);
  }
  @Get("profile") profile(@Req() request: AuthenticatedRequest) {
    return this.providers.getProfile(request.auth.sub);
  }
  @Put("profile") updateProfile(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateProviderProfileDto,
  ) {
    return this.providers.updateProfile(request.auth.sub, input);
  }
  @Put("availability") updateAvailability(
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateProviderAvailabilityDto,
  ) {
    return this.providers.updateAvailability(
      request.auth.sub,
      input.isAvailable,
    );
  }
  @Get("services") services(@Req() request: AuthenticatedRequest) {
    return this.providers.listServices(request.auth.sub);
  }
  @Post("services") createService(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateServiceDto,
  ) {
    return this.providers.createService(request.auth.sub, input);
  }
  @Put("services/:id") updateService(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: CreateServiceDto,
  ) {
    return this.providers.updateService(request.auth.sub, id, input);
  }
  @Post("services/:id/media")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "cover", maxCount: 1 },
        { name: "portfolio", maxCount: 5 },
      ],
      serviceMediaUploadOptions,
    ),
  )
  uploadMedia(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFiles()
    files: { cover?: Express.Multer.File[]; portfolio?: Express.Multer.File[] },
  ) {
    return this.providers.uploadServiceMedia(request.auth.sub, id, files ?? {});
  }
  @Get("services/:id/media/:mediaId") async ownedMedia(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("mediaId", ParseUUIDPipe) mediaId: string,
    @Res() response: Response,
  ) {
    const media = await this.providers.getOwnedMedia(
      request.auth.sub,
      id,
      mediaId,
    );
    return sendStoredFile(
      response,
      await this.storage.delivery("service-media", media.storagePath, {
        contentType: media.mimeType,
      }),
    );
  }
  @Delete("services/:id/media/:mediaId") removeMedia(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("mediaId", ParseUUIDPipe) mediaId: string,
  ) {
    return this.providers.removeServiceMedia(request.auth.sub, id, mediaId);
  }
  @Post("services/:id/submit") submitService(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.providers.submitService(request.auth.sub, id);
  }
  @Post("services/:id/revise") reviseService(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.providers.reviseService(request.auth.sub, id);
  }
  @Post("services/:id/pause") pauseService(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.providers.pauseService(request.auth.sub, id);
  }
  @Post("services/:id/resume") resumeService(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.providers.resumeService(request.auth.sub, id);
  }
  @Post("services/:id/archive") archiveService(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.providers.archiveService(request.auth.sub, id);
  }
  @Post("services/:id/restore") restoreService(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.providers.restoreService(request.auth.sub, id);
  }
}
