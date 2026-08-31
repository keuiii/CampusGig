import { Module } from "@nestjs/common";
import {
  AccountProfileController,
  ProfileController,
} from "./profile.controller";
import { ProfileService } from "./profile.service";
import { VerificationService } from "./verification.service";

@Module({
  controllers: [AccountProfileController, ProfileController],
  providers: [ProfileService, VerificationService],
  exports: [VerificationService],
})
export class ProfileModule {}
