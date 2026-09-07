import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(userId: string) {
    const [data, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { recipientId: userId },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      this.prisma.notification.count({
        where: { recipientId: userId, readAt: null },
      }),
    ]);
    return { data, unreadCount };
  }
  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, recipientId: userId },
    });
    if (!notification) throw new NotFoundException("Notification not found");
    return {
      data: await this.prisma.notification.update({
        where: { id },
        data: { readAt: notification.readAt ?? new Date() },
      }),
    };
  }
  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return {
      updated: result.count,
      message:
        result.count === 0
          ? "All notifications were already read."
          : `${result.count} notification${result.count === 1 ? "" : "s"} marked as read.`,
    };
  }
}
