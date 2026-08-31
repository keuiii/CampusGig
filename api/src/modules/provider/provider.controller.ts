import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { basename, resolve } from "node:path";
import { UserRole } from "@prisma/client";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { CreateServiceDto } from "./dto/create-service.dto";
import { UpdateProviderProfileDto } from "./dto/update-provider-profile.dto";
import { ProviderService } from "./provider.service";
import {
  serviceMediaStorageRoot,
  serviceMediaUploadOptions,
} from "./service-media-upload.config";
@ApiTags("provider")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PROVIDER)
@Controller("provider")
export class ProviderController {
  constructor(private readonly providers: ProviderService) {}
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
    @Param("id") id: string,
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
    @Param("id") id: string,
    @UploadedFiles()
    files: { cover?: Express.Multer.File[]; portfolio?: Express.Multer.File[] },
  ) {
    return this.providers.uploadServiceMedia(request.auth.sub, id, files ?? {});
  }
  @Get("services/:id/media/:mediaId") async ownedMedia(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("mediaId") mediaId: string,
    @Res() response: Response,
  ) {
    const media = await this.providers.getOwnedMedia(
      request.auth.sub,
      id,
      mediaId,
    );
    return response.sendFile(
      resolve(serviceMediaStorageRoot, basename(media.storagePath)),
    );
  }
  @Delete("services/:id/media/:mediaId") removeMedia(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Param("mediaId") mediaId: string,
  ) {
    return this.providers.removeServiceMedia(request.auth.sub, id, mediaId);
  }
  @Post("services/:id/submit") submitService(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.providers.submitService(request.auth.sub, id);
  }
}
