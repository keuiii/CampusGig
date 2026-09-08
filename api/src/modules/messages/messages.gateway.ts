import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { PrismaService } from "../../prisma/prisma.service";
import type { AccessTokenPayload } from "../auth/auth.types";

type AuthenticatedSocket = Socket & { data: { auth?: AccessTokenPayload } };

const realtimeOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((value) => value.trim());
const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):(3000|3001)$/;

@WebSocketGateway({
  namespace: "/realtime",
  cors: {
    credentials: true,
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      const allowed = !origin || realtimeOrigins.includes(origin) || (process.env.NODE_ENV !== "production" && localOrigin.test(origin));
      callback(allowed ? null : new Error("Origin is not allowed by CampusGig realtime CORS"), allowed);
    },
  },
})
export class MessagesGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly jwt: JwtService, private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== "string" || !token) throw new Error("Missing token");
      const auth = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret: this.config.getOrThrow<string>("JWT_SECRET") });
      client.data.auth = auth;
      await client.join(`user:${auth.sub}`);
    } catch {
      client.emit("realtime:error", { message: "Authentication required" });
      client.disconnect(true);
    }
  }

  @SubscribeMessage("conversation:subscribe")
  async subscribe(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: { orderId?: string }) {
    const userId = client.data.auth?.sub;
    if (!userId || !body.orderId) return { ok: false };
    const participant = await this.prisma.conversation.count({ where: { orderId: body.orderId, participants: { some: { userId } } } });
    if (!participant) return { ok: false };
    await client.join(`order:${body.orderId}`);
    return { ok: true };
  }

  publishMessage(orderId: string, message: unknown, recipientId: string) {
    this.server.to(`order:${orderId}`).emit("message:created", { orderId, message });
    this.server.to(`user:${recipientId}`).emit("inbox:changed", { orderId });
    this.server.to(`user:${recipientId}`).emit("notifications:changed", { orderId });
  }

  publishRead(orderId: string, userId: string) {
    this.server.to(`order:${orderId}`).emit("conversation:read", { orderId, userId });
  }
}
