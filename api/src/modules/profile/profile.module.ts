import { Module } from "@nestjs/common";
import {
  AccountProfileController,
  ProfileController,
} from "./profile.controller";
import { ProfileService } from "./profile.service";
import { VerificationService } from "./verification.service";
import { MessagesModule } from "../messages/messages.module";

@Module({
  imports: [MessagesModule],
  controllers: [AccountProfileController, ProfileController],
  providers: [ProfileService, VerificationService],
  exports: [VerificationService],
})
export class ProfileModule {}
