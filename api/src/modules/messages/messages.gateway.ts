import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Optional } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { PrismaService } from "../../prisma/prisma.service";
import type { AccessTokenPayload } from "../auth/auth.types";
import { SocketSessionRegistry } from "../auth/socket-session-registry.service";
import { TokenBucketLimiter } from "../../security/token-bucket-limiter";

type AuthenticatedSocket = Socket & { data: { auth?: AccessTokenPayload } };

const realtimeOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((value) => value.trim());
const localOrigin =
  /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):(3000|3001)$/;

@WebSocketGateway({
  namespace: "/realtime",
  cors: {
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const allowed =
        !origin ||
        realtimeOrigins.includes(origin) ||
        (process.env.NODE_ENV !== "production" && localOrigin.test(origin));
      callback(
        allowed
          ? null
          : new Error("Origin is not allowed by CampusGig realtime CORS"),
        allowed,
      );
    },
  },
})
export class MessagesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly revalidationTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly socketSessions: SocketSessionRegistry,
    @Optional() private readonly trafficLimiter?: TokenBucketLimiter,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const connectionLimit = this.trafficLimiter?.consume(
      `socket-connect:${this.clientAddress(client)}`,
      60,
      120,
    );
    if (connectionLimit && !connectionLimit.allowed) {
      client.emit("realtime:error", {
        message: "Too many realtime connections. Please retry shortly.",
      });
      client.disconnect(true);
      return;
    }
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== "string" || !token) throw new Error("Missing token");
      const auth = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_SECRET"),
      });
      const user = await this.prisma.user.findUnique({
        where: { id: auth.sub },
        select: { status: true, sessionVersion: true },
      });
      if (
        !user ||
        user.status !== "ACTIVE" ||
        user.sessionVersion !== auth.sessionVersion
      )
        throw new Error("Session is no longer active");
      if (!auth.sid || !auth.exp)
        throw new Error("Session-bound token required");
      if (auth.sid) {
        const session = await this.prisma.authSession.findFirst({
          where: {
            id: auth.sid,
            userId: auth.sub,
            sessionVersion: auth.sessionVersion,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!session) throw new Error("Session is no longer active");
      }
      client.data.auth = auth;
      this.socketSessions.register(
        client,
        auth.sub,
        auth.sid,
        new Date(auth.exp * 1000),
      );
      const revalidationTimer = setInterval(() => {
        void this.revalidate(client).then((valid) => {
          if (!valid)
            this.socketSessions.disconnectSocket(client.id, "session_invalid");
        });
      }, 60_000);
      revalidationTimer.unref?.();
      this.revalidationTimers.set(client.id, revalidationTimer);
      await client.join(`user:${auth.sub}`);
      await client.join("marketplace");
    } catch {
      client.emit("realtime:error", { message: "Authentication required" });
      client.disconnect(true);
    }
  }

  private clientAddress(client: AuthenticatedSocket) {
    const direct = client.handshake.address || "unknown";
    const normalized = direct.replace(/^::ffff:/, "");
    const trustedProxy =
      normalized === "::1" ||
      normalized.startsWith("127.") ||
      normalized.startsWith("10.") ||
      normalized.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(normalized);
    const forwarded = client.handshake.headers["x-forwarded-for"];
    return trustedProxy && typeof forwarded === "string"
      ? forwarded.split(",", 1)[0].trim()
      : normalized;
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const timer = this.revalidationTimers.get(client.id);
    if (timer) clearInterval(timer);
    this.revalidationTimers.delete(client.id);
    this.socketSessions.unregister(client.id);
  }

  @SubscribeMessage("conversation:subscribe")
  async subscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { conversationId?: string; orderId?: string },
  ) {
    const userId = client.data.auth?.sub;
    if (!userId || (!body.conversationId && !body.orderId))
      return { ok: false };
    if (!(await this.revalidate(client))) return { ok: false };
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        ...(body.conversationId
          ? { id: body.conversationId }
          : { orderId: body.orderId }),
        participants: { some: { userId } },
      },
      select: { id: true, orderId: true },
    });
    if (!conversation) return { ok: false };
    await client.join(`conversation:${conversation.id}`);
    if (conversation.orderId)
      await client.join(`order:${conversation.orderId}`);
    return { ok: true };
  }

  @SubscribeMessage("provider:subscribe")
  async subscribeProvider(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { providerId?: string },
  ) {
    if (!client.data.auth?.sub || !body.providerId) return { ok: false };
    if (!(await this.revalidate(client))) return { ok: false };
    const provider = await this.prisma.user.count({
      where: {
        id: body.providerId,
        status: "ACTIVE",
        roles: { some: { role: "PROVIDER" } },
        providerProfile: { isNot: null },
      },
    });
    if (!provider) return { ok: false };
    await client.join(`provider:${body.providerId}`);
    return { ok: true };
  }

  @SubscribeMessage("provider:unsubscribe")
  async unsubscribeProvider(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { providerId?: string },
  ) {
    if (!client.data.auth?.sub || !body.providerId) return { ok: false };
    await client.leave(`provider:${body.providerId}`);
    return { ok: true };
  }

  publishMessage(
    conversationId: string,
    orderId: string | null,
    message: unknown,
    recipientId: string,
  ) {
    const payload = { conversationId, orderId, message };
    const messageAudience = orderId
      ? this.server.to(`conversation:${conversationId}`).to(`order:${orderId}`)
      : this.server.to(`conversation:${conversationId}`);
    messageAudience.emit("message:created", payload);
    this.server
      .to(`user:${recipientId}`)
      .emit("inbox:changed", { conversationId, orderId });
    this.server
      .to(`user:${recipientId}`)
      .emit("notifications:changed", { conversationId, orderId });
  }

  publishRead(conversationId: string, orderId: string | null, userId: string) {
    const payload = { conversationId, orderId, userId };
    const readAudience = orderId
      ? this.server.to(`conversation:${conversationId}`).to(`order:${orderId}`)
      : this.server.to(`conversation:${conversationId}`);
    readAudience.emit("conversation:read", payload);
  }

  publishProviderStats(providerId: string, reason: "completion" | "review") {
    this.server
      .to(`provider:${providerId}`)
      .emit("provider:stats-changed", { providerId, reason });
  }

  publishOrderChanged(
    orderId: string,
    participantIds: string[],
    reason: string,
  ) {
    const payload = { orderId, reason };
    this.server.to(`order:${orderId}`).emit("order:changed", payload);
    for (const userId of new Set(participantIds))
      this.server.to(`user:${userId}`).emit("order:changed", payload);
    for (const userId of new Set(participantIds))
      this.server
        .to(`user:${userId}`)
        .emit("notifications:changed", { orderId });
  }

  publishPaymentChanged(
    orderId: string,
    participantIds: string[],
    status: string,
  ) {
    const payload = { orderId, status };
    this.server.to(`order:${orderId}`).emit("payment:changed", payload);
    for (const userId of new Set(participantIds))
      this.server.to(`user:${userId}`).emit("payment:changed", payload);
  }

  publishMarketplaceChanged(
    resource: "provider" | "service" | "school",
    resourceId: string,
  ) {
    this.server
      .to("marketplace")
      .emit("marketplace:changed", { resource, resourceId });
  }

  publishAccountChanged(
    userId: string,
    resource: "identity" | "provider-profile" | "services",
  ) {
    this.server
      .to(`user:${userId}`)
      .emit("account:changed", { userId, resource });
    if (resource === "provider-profile")
      this.server
        .to(`provider:${userId}`)
        .emit("provider:profile-changed", { providerId: userId });
    if (resource === "services")
      this.server
        .to(`provider:${userId}`)
        .emit("provider:services-changed", { providerId: userId });
  }

  private async revalidate(client: AuthenticatedSocket) {
    const auth = client.data.auth;
    if (!auth?.sub || !auth.sid || !auth.exp || auth.exp * 1000 <= Date.now())
      return false;
    try {
      const [user, session] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: auth.sub },
          select: { status: true, sessionVersion: true },
        }),
        this.prisma.authSession.findFirst({
          where: {
            id: auth.sid,
            userId: auth.sub,
            sessionVersion: auth.sessionVersion,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        }),
      ]);
      return Boolean(
        user &&
          user.status === "ACTIVE" &&
          user.sessionVersion === auth.sessionVersion &&
          session,
      );
    } catch {
      return false;
    }
  }
}
