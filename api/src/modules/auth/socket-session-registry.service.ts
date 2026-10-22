import { Injectable } from "@nestjs/common";
import type { Socket } from "socket.io";

type RegisteredSocket = {
  socket: Socket;
  userId: string;
  sessionId: string;
  expiryTimer: NodeJS.Timeout;
};

@Injectable()
export class SocketSessionRegistry {
  private readonly sockets = new Map<string, RegisteredSocket>();
  private readonly sessions = new Map<string, Set<string>>();
  private readonly users = new Map<string, Set<string>>();

  register(socket: Socket, userId: string, sessionId: string, expiresAt: Date) {
    this.unregister(socket.id);
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    const expiryTimer = setTimeout(
      () => this.disconnectSocket(socket.id, "token_expired"),
      Math.min(delay, 2_147_483_647),
    );
    expiryTimer.unref?.();
    this.sockets.set(socket.id, { socket, userId, sessionId, expiryTimer });
    this.add(this.sessions, sessionId, socket.id);
    this.add(this.users, userId, socket.id);
  }

  unregister(socketId: string) {
    const registered = this.sockets.get(socketId);
    if (!registered) return;
    clearTimeout(registered.expiryTimer);
    this.sockets.delete(socketId);
    this.remove(this.sessions, registered.sessionId, socketId);
    this.remove(this.users, registered.userId, socketId);
  }

  disconnectSession(sessionId: string, reason = "session_revoked") {
    this.disconnectMany(this.sessions.get(sessionId), reason);
  }

  disconnectUser(userId: string, reason = "account_invalidated") {
    this.disconnectMany(this.users.get(userId), reason);
  }

  counts() {
    return {
      sockets: this.sockets.size,
      sessions: this.sessions.size,
      users: this.users.size,
    };
  }

  private disconnectMany(socketIds: Set<string> | undefined, reason: string) {
    for (const socketId of [...(socketIds ?? [])])
      this.disconnectSocket(socketId, reason);
  }

  disconnectSocket(socketId: string, reason: string) {
    const registered = this.sockets.get(socketId);
    if (!registered) return;
    this.unregister(socketId);
    registered.socket.emit("auth:invalidated", { reason });
    registered.socket.disconnect(true);
  }

  private add(index: Map<string, Set<string>>, key: string, socketId: string) {
    const entries = index.get(key) ?? new Set<string>();
    entries.add(socketId);
    index.set(key, entries);
  }

  private remove(
    index: Map<string, Set<string>>,
    key: string,
    socketId: string,
  ) {
    const entries = index.get(key);
    if (!entries) return;
    entries.delete(socketId);
    if (!entries.size) index.delete(key);
  }
}
