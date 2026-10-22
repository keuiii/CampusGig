import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { EmailService } from "./email.service";
import { MfaService } from "./mfa.service";
import { PasswordChangeService } from "./password-change.service";
import { AuthSessionService } from "./auth-session.service";
import { SocketSessionRegistry } from "./socket-session-registry.service";

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailService,
    MfaService,
    PasswordChangeService,
    AuthSessionService,
    SocketSessionRegistry,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    AuthService,
    AuthSessionService,
    SocketSessionRegistry,
    JwtAuthGuard,
    RolesGuard,
    JwtModule,
  ],
})
export class AuthModule {}
