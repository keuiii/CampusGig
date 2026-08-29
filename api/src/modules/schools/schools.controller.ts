import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { CreateSchoolDto } from "./dto/create-school.dto";
import { UpdateSchoolStatusDto } from "./dto/update-school-status.dto";
import { SchoolsService } from "./schools.service";

@ApiTags("schools")
@Controller("schools")
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}
  @Get() findAll() { return this.schools.findAll(); }
}

@ApiTags("admin schools")
@ApiBearerAuth()
@Controller("admin/schools")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSchoolsController {
  constructor(private readonly schools: SchoolsService) {}
  @Get() findAll() { return this.schools.findAllForAdmin(); }
  @Post() create(@Body() input: CreateSchoolDto) { return this.schools.create(input); }
  @Patch(":id/status") updateStatus(@Param("id") id: string, @Body() input: UpdateSchoolStatusDto) { return this.schools.updateStatus(id, input); }
}
