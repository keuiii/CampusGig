import { Module } from "@nestjs/common";
import {
  AdminSchoolsController,
  SchoolsController,
} from "./schools.controller";
import { SchoolsService } from "./schools.service";
import { MessagesModule } from "../messages/messages.module";

@Module({
  imports: [MessagesModule],
  controllers: [SchoolsController, AdminSchoolsController],
  providers: [SchoolsService],
})
export class SchoolsModule {}
