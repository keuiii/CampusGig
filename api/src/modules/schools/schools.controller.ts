import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SchoolsService } from "./schools.service";

@ApiTags("schools")
@Controller("schools")
export class SchoolsController {
  constructor(private readonly schools: SchoolsService) {}
  @Get() findAll() { return this.schools.findAll(); }
}
