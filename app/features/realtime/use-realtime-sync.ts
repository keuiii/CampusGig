import { useEffect } from "react";
import { io } from "socket.io-client";
import { apiUrl } from "../../lib/http-client";
import { realtimeSocketEnabled } from "./realtime-config";

export interface RealtimeSocket {
  on(event: string, listener: () => void): RealtimeSocket;
  disconnect(): void;
}

interface RealtimeCallbacks {
  refreshOrders: () => void;
  refreshMarketplace: () => void;
  refreshNotifications: () => void;
}

interface RealtimeTimers {
  setInterval(callback: () => void, milliseconds: number): number;
  clearInterval(handle: number): void;
}

export function attachRealtimeSync(socket: RealtimeSocket | null, callbacks: RealtimeCallbacks, timers: RealtimeTimers) {
  socket?.on("connect", () => {
    callbacks.refreshOrders();
    callbacks.refreshMarketplace();
    callbacks.refreshNotifications();
  });
  socket?.on("order:changed", callbacks.refreshOrders);
  socket?.on("payment:changed", callbacks.refreshOrders);
  socket?.on("marketplace:changed", callbacks.refreshMarketplace);
  socket?.on("notifications:changed", callbacks.refreshNotifications);
  const fallback = timers.setInterval(() => {
    callbacks.refreshOrders();
    callbacks.refreshMarketplace();
    callbacks.refreshNotifications();
  }, 10000);
  return () => {
    timers.clearInterval(fallback);
    socket?.disconnect();
  };
}

export function useRealtimeSync(token: string, refreshOrders: () => void, refreshMarketplace: () => void) {
  useEffect(() => {
    if (!token) return;
    const endpoint = apiUrl();
    if (!endpoint) return;
    const socket = realtimeSocketEnabled()
      ? io(`${new URL(endpoint).origin}/realtime`, {
          auth: { token },
          transports: ["websocket", "polling"],
          reconnection: true,
        })
      : null;
    return attachRealtimeSync(socket, {
      refreshOrders: () => void refreshOrders(),
      refreshMarketplace: () => void refreshMarketplace(),
      refreshNotifications: () => window.dispatchEvent(new Event("campusgig:notifications-changed")),
    }, window);
  }, [token, refreshOrders, refreshMarketplace]);
}
