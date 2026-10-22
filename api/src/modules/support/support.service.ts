import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type {
  SupportTicketCategory,
  SupportTicketSource,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    category: SupportTicketCategory,
    subjectInput: string,
    messageInput: string,
    source: SupportTicketSource,
  ) {
    const recentCount = await this.prisma.supportTicket.count({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recentCount >= 5)
      throw new HttpException(
        "Too many support requests. Please wait before submitting another.",
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        category,
        subject: subjectInput.trim(),
        message: messageInput.trim(),
        source,
      },
      select: {
        id: true,
        category: true,
        status: true,
        subject: true,
        createdAt: true,
      },
    });
    return {
      data: ticket,
      reference: `CG-SUPPORT-${ticket.id.slice(0, 8).toUpperCase()}`,
      message: "Your support request has been submitted.",
    };
  }

  async mine(userId: string) {
    return {
      data: await this.prisma.supportTicket.findMany({
        where: { userId },
        select: {
          id: true,
          category: true,
          status: true,
          subject: true,
          createdAt: true,
          resolvedAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    };
  }
}
