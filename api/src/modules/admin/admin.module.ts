import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { ProfileModule } from "../profile/profile.module";
import { AdminService } from "./admin.service";
import { MessagesModule } from "../messages/messages.module";
@Module({
  imports: [ProfileModule, MessagesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
