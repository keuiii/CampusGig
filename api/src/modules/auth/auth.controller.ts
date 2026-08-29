import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { JwtAuthGuard, type AuthenticatedRequest } from "./jwt-auth.guard";
import { EmailCodeDto } from "./dto/email-code.dto";
import { EmailOnlyDto } from "./dto/email-only.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() input: RegisterDto) { return this.auth.register(input); }

  @Post("login")
  login(@Body() input: LoginDto) { return this.auth.login(input); }

  @Post("verify-email")
  verifyEmail(@Body() input: EmailCodeDto) { return this.auth.verifyEmail(input); }

  @Post("resend-verification")
  resendVerification(@Body() input: EmailOnlyDto) { return this.auth.resendVerification(input); }

  @Post("forgot-password")
  forgotPassword(@Body() input: EmailOnlyDto) { return this.auth.forgotPassword(input); }

  @Post("reset-password")
  resetPassword(@Body() input: ResetPasswordDto) { return this.auth.resetPassword(input); }

  @Get("me")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) { return this.auth.findAuthenticatedUser(request.auth.sub); }

  @Post("change-password")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  changePassword(@Req() request: AuthenticatedRequest, @Body() input: ChangePasswordDto) { return this.auth.changePassword(request.auth.sub, input); }
}
