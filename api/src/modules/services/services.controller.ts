import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ServicesService } from "./services.service";

@ApiTags("services")
@Controller("services")
export class ServicesController {
  constructor(private readonly services: ServicesService) {}
  @Get() findAll(@Query("query") query?: string, @Query("categoryId") categoryId?: string, @Query("schoolId") schoolId?: string) { return this.services.findAll(query, categoryId, schoolId); }
  @Get(":id") findOne(@Param("id") id: string) { return this.services.findOne(id); }
}
