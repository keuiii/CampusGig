import { Body, Controller, Get, Param, Post, Put, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { basename, resolve } from "node:path";
import { UserRole } from "@prisma/client";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { UpdateStudentProfileDto } from "./dto/update-student-profile.dto";
import { ProfileService } from "./profile.service";
import { VerificationService } from "./verification.service";
import { verificationUploadOptions } from "./verification-upload.config";
import { avatarStorageRoot, avatarUploadOptions } from "./avatar-upload.config";

@ApiTags("profile")
@Controller("profile")
export class AccountProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Post("avatar")
  @ApiBearerAuth()
  @ApiConsumes("multipart/form-data")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("avatar", avatarUploadOptions))
  uploadAvatar(@Req() request: AuthenticatedRequest, @UploadedFile() file?: Express.Multer.File) { return this.profiles.updateAvatar(request.auth.sub, file); }

  @Get("avatar/:userId")
  async avatar(@Param("userId") userId: string, @Res() response: Response) {
    const avatarPath = await this.profiles.getAvatarPath(userId);
    return response.sendFile(resolve(avatarStorageRoot, basename(avatarPath)), { maxAge: "1h" });
  }
}

@ApiTags("profile")
@ApiBearerAuth()
@Controller("profile/student")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.STUDENT)
export class ProfileController {
  constructor(private readonly profiles: ProfileService, private readonly verifications: VerificationService) {}
  @Get() get(@Req() request: AuthenticatedRequest) { return this.profiles.getStudentProfile(request.auth.sub); }
  @Put() update(@Req() request: AuthenticatedRequest, @Body() input: UpdateStudentProfileDto) { return this.profiles.updateStudentProfile(request.auth.sub, input); }
  @Get("verification") verification(@Req() request: AuthenticatedRequest) { return this.verifications.latest(request.auth.sub); }
  @Post("verification")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("studentId", verificationUploadOptions))
  submitVerification(@Req() request: AuthenticatedRequest, @UploadedFile() file?: Express.Multer.File) { return this.verifications.submit(request.auth.sub, file); }
}
