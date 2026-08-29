import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import type { AccessTokenPayload, AuthenticatedUser } from "./auth.types";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(input: RegisterDto) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException("An account with this email already exists");

    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: input.displayName.trim(),
        passwordHash: await hash(input.password, 12),
        roles: { create: { role: UserRole.STUDENT } },
      },
      include: { roles: true },
    });

    return this.createSession(this.toAuthenticatedUser(user));
  }

  async login(input: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() },
      include: { roles: true },
    });
    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    if (user.status === "SUSPENDED" || user.status === "DEACTIVATED") {
      throw new UnauthorizedException("This account is not active");
    }
    return this.createSession(this.toAuthenticatedUser(user));
  }

  async findAuthenticatedUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });
    if (!user) throw new UnauthorizedException("Account no longer exists");
    return this.toAuthenticatedUser(user);
  }

  private async createSession(user: AuthenticatedUser) {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, roles: user.roles };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>("JWT_SECRET"),
      expiresIn: "7d",
    });
    return { accessToken, tokenType: "Bearer", expiresIn: 604800, user };
  }

  private toAuthenticatedUser(user: { id: string; email: string; displayName: string; status: any; roles: { role: UserRole }[] }): AuthenticatedUser {
    return { id: user.id, email: user.email, displayName: user.displayName, status: user.status, roles: user.roles.map(({ role }) => role) };
  }
}
