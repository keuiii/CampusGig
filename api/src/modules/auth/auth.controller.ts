import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { JwtAuthGuard, type AuthenticatedRequest } from "./jwt-auth.guard";
import { SocialLoginDto } from "./dto/social-login.dto";
import { EmailCodeDto } from "./dto/email-code.dto";
import { EmailOnlyDto } from "./dto/email-only.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { MfaChallengeDto, MfaCodeDto } from "./dto/mfa-code.dto";
import {
  DisableMfaDto,
  RegenerateRecoveryCodesDto,
} from "./dto/disable-mfa.dto";
import { PasswordChangeDecisionDto } from "./dto/password-change-decision.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() input: RegisterDto) {
    return this.auth.register(input);
  }

  @Post("login")
  login(@Body() input: LoginDto) {
    return this.auth.login(input);
  }

  @Post("social")
  socialLogin(@Body() input: SocialLoginDto) {
    return this.auth.socialLogin(input);
  }

  @Post("mfa/challenge")
  verifyMfaChallenge(@Body() input: MfaChallengeDto) {
    return this.auth.verifyMfaChallenge(
      input.challengeToken,
      input.code,
      input.recoveryCode,
      input.rememberDevice,
    );
  }

  @Post("verify-email")
  verifyEmail(@Body() input: EmailCodeDto) {
    return this.auth.verifyEmail(input);
  }

  @Post("resend-verification")
  resendVerification(@Body() input: EmailOnlyDto) {
    return this.auth.resendVerification(input);
  }

  @Post("forgot-password")
  forgotPassword(@Body() input: EmailOnlyDto) {
    return this.auth.forgotPassword(input);
  }

  @Post("reset-password")
  resetPassword(@Body() input: ResetPasswordDto) {
    return this.auth.resetPassword(input);
  }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.auth.findAuthenticatedUser(request.auth.sub);
  }

  @Post("change-password")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() input: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      request.auth.sub,
      input,
      `${request.protocol}://${request.get("host")}`,
    );
  }

  @Get("password-change/pending")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  pendingPasswordChange(@Req() request: AuthenticatedRequest) {
    return this.auth.pendingPasswordChange(request.auth.sub);
  }

  @Get("password-change/:id/status")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  passwordChangeStatus(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.auth.passwordChangeStatus(request.auth.sub, id);
  }

  @Post("password-change/:id/cancel")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  cancelPasswordChange(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.auth.cancelPasswordChange(request.auth.sub, id);
  }

  @Get("password-change/review")
  async passwordChangeReview(
    @Req() request: AuthenticatedRequest,
    @Query("token") token: string,
    @Res() response: Response,
  ) {
    return response
      .type("html")
      .send(
        await this.auth.passwordChangeReview(
          token,
          `${request.protocol}://${request.get("host")}`,
        ),
      );
  }

  @Post("password-change/decision")
  async decidePasswordChange(
    @Body() input: PasswordChangeDecisionDto,
    @Res() response: Response,
  ) {
    return response
      .type("html")
      .send(await this.auth.decidePasswordChange(input.token, input.decision));
  }

  @Get("mfa/status")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  mfaStatus(@Req() request: AuthenticatedRequest) {
    return this.auth.mfaStatus(request.auth.sub);
  }

  @Post("mfa/setup")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  beginMfaSetup(@Req() request: AuthenticatedRequest) {
    return this.auth.beginMfaSetup(request.auth.sub);
  }

  @Post("mfa/setup/confirm")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  confirmMfaSetup(
    @Req() request: AuthenticatedRequest,
    @Body() input: MfaCodeDto,
  ) {
    return this.auth.confirmMfaSetup(request.auth.sub, input.code);
  }

  @Post("mfa/disable")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  disableMfa(
    @Req() request: AuthenticatedRequest,
    @Body() input: DisableMfaDto,
  ) {
    return this.auth.disableMfa(
      request.auth.sub,
      input.currentPassword,
      input.code,
    );
  }

  @Post("mfa/recovery-codes")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  regenerateRecoveryCodes(
    @Req() request: AuthenticatedRequest,
    @Body() input: RegenerateRecoveryCodesDto,
  ) {
    return this.auth.regenerateRecoveryCodes(request.auth.sub, input.code);
  }

  @Post("mfa/trusted-devices/revoke")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  revokeTrustedDevices(@Req() request: AuthenticatedRequest) {
    return this.auth.revokeTrustedDevices(request.auth.sub);
  }
}
