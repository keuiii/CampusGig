import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { ProfileModule } from "../profile/profile.module";
import { AdminService } from "./admin.service";
@Module({
  imports: [ProfileModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
