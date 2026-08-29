import { Module } from "@nestjs/common";
import { AdminSchoolsController, SchoolsController } from "./schools.controller";
import { SchoolsService } from "./schools.service";

@Module({ controllers: [SchoolsController, AdminSchoolsController], providers: [SchoolsService] })
export class SchoolsModule {}
