import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { RefreshSessionDto } from "./dto/session-client.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() input: RegisterDto) {
    return this.auth.register(input);
  }

  @Post("login")
  async login(
    @Body() input: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.deliverSession(
      await this.auth.login({
        ...input,
        trustedDeviceToken: this.trustedDeviceToken(input, request),
      }),
      input.clientType,
      response,
    );
  }

  @Post("social")
  async socialLogin(
    @Body() input: SocialLoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.deliverSession(
      await this.auth.socialLogin({
        ...input,
        trustedDeviceToken: this.trustedDeviceToken(input, request),
      }),
      input.clientType,
      response,
    );
  }

  @Post("mfa/challenge")
  async verifyMfaChallenge(
    @Body() input: MfaChallengeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.deliverSession(
      await this.auth.verifyMfaChallenge(
        input.challengeToken,
        input.code,
        input.recoveryCode,
        input.rememberDevice,
        {
          clientType: input.clientType ?? "WEB",
          deviceName:
            input.deviceName?.trim() ||
            (input.clientType === "MOBILE" ? "Mobile device" : "Web browser"),
        },
      ),
      input.clientType,
      response,
    );
  }

  @Post("verify-email")
  async verifyEmail(
    @Body() input: EmailCodeDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.deliverSession(
      await this.auth.verifyEmail(input),
      input.clientType,
      response,
    );
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Body() input: RefreshSessionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookieToken = this.cookie(request, this.refreshCookieName());
    const refreshToken = input.refreshToken ?? cookieToken;
    if (!refreshToken) return this.auth.refreshSession("");
    return this.deliverSession(
      await this.auth.refreshSession(refreshToken),
      input.refreshToken ? "MOBILE" : "WEB",
      response,
    );
  }

  @Post("logout")
  @HttpCode(200)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Body() input: RefreshSessionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logout(
      input.refreshToken ?? this.cookie(request, this.refreshCookieName()),
    );
    this.clearRefreshCookie(response);
    return result;
  }

  @Get("sessions")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  sessions(@Req() request: AuthenticatedRequest) {
    return this.auth.listSessions(request.auth.sub, request.auth.sid);
  }

  @Delete("sessions/:id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  revokeSession(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.auth.revokeSession(request.auth.sub, id);
  }

  @Post("logout-all")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logoutAll(request.auth.sub);
    this.clearRefreshCookie(response);
    return result;
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
  async changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() input: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.changePassword(
      request.auth.sub,
      input,
      `${request.protocol}://${request.get("host")}`,
    );
    if (result.status === "CONFIRMED") this.clearTrustedDeviceCookie(response);
    return result;
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
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.auth.passwordChangeStatus(request.auth.sub, id);
  }

  @Post("password-change/:id/cancel")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  cancelPasswordChange(
    @Req() request: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
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
  async revokeTrustedDevices(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.revokeTrustedDevices(request.auth.sub);
    this.clearTrustedDeviceCookie(response);
    return result;
  }

  private deliverSession(
    result: Record<string, unknown>,
    clientType: "WEB" | "MOBILE" | undefined,
    response: Response,
  ) {
    if (clientType === "MOBILE") return result;
    if (result.requiresTwoFactor) {
      this.clearTrustedDeviceCookie(response);
      return result;
    }
    if (typeof result.refreshToken !== "string") return result;
    this.setRefreshCookie(
      response,
      result.refreshToken,
      typeof result.refreshExpiresIn === "number"
        ? result.refreshExpiresIn
        : 7 * 24 * 60 * 60,
    );
    if (typeof result.trustedDeviceToken === "string")
      this.setTrustedDeviceCookie(
        response,
        result.trustedDeviceToken,
        typeof result.trustedForDays === "number" ? result.trustedForDays : 30,
      );
    const {
      refreshToken: _refreshToken,
      trustedDeviceToken: _trustedDeviceToken,
      trustedForDays: _trustedForDays,
      ...browserResult
    } = result;
    return browserResult;
  }

  private setRefreshCookie(response: Response, token: string, maxAge: number) {
    response.cookie(this.refreshCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: maxAge * 1000,
    });
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(this.refreshCookieName(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
    });
  }

  private refreshCookieName() {
    return "campusgig_refresh";
  }

  private setTrustedDeviceCookie(
    response: Response,
    token: string,
    maxAgeDays: number,
  ) {
    response.cookie(this.trustedDeviceCookieName(), token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: maxAgeDays * 24 * 60 * 60 * 1000,
    });
  }

  private clearTrustedDeviceCookie(response: Response) {
    response.clearCookie(this.trustedDeviceCookieName(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
    });
  }

  private trustedDeviceCookieName() {
    return "campusgig_trusted_device";
  }

  private trustedDeviceToken(
    input: { clientType?: "WEB" | "MOBILE"; trustedDeviceToken?: string },
    request: AuthenticatedRequest,
  ) {
    return input.clientType === "MOBILE"
      ? input.trustedDeviceToken
      : this.cookie(request, this.trustedDeviceCookieName());
  }

  private cookie(request: AuthenticatedRequest, name: string) {
    const header = request.headers.cookie;
    if (!header) return undefined;
    for (const pair of header.split(";")) {
      const separator = pair.indexOf("=");
      if (separator < 0) continue;
      if (pair.slice(0, separator).trim() !== name) continue;
      try {
        return decodeURIComponent(pair.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
