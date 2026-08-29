import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { basename, resolve } from "node:path";
import { serviceMediaStorageRoot } from "../provider/service-media-upload.config";
import { ServicesService } from "./services.service";

@ApiTags("services")
@Controller("services")
export class ServicesController {
  constructor(private readonly services: ServicesService) {}
  @Get() findAll(@Query("query") query?: string, @Query("categoryId") categoryId?: string, @Query("schoolId") schoolId?: string) { return this.services.findAll(query, categoryId, schoolId); }
  @Get(":id") findOne(@Param("id") id: string) { return this.services.findOne(id); }
  @Get(":id/media/:mediaId") async media(@Param("id") id: string, @Param("mediaId") mediaId: string, @Res() response: Response) { const media = await this.services.getPublicMedia(id, mediaId); return response.sendFile(resolve(serviceMediaStorageRoot, basename(media.storagePath))); }
}
