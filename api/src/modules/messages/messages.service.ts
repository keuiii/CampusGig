import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async inbox(userId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId, hiddenAt: null } } },
      include: {
        participants: { where: { userId }, select: { lastReadAt: true } },
        order: {
          include: {
            client: {
              select: {
                id: true,
                displayName: true,
                avatarPath: true,
                updatedAt: true,
              },
            },
            provider: {
              select: {
                id: true,
                displayName: true,
                avatarPath: true,
                updatedAt: true,
              },
            },
            servicePackage: {
              select: {
                id: true,
                tier: true,
                name: true,
                description: true,
                priceCentavos: true,
                deliveryDays: true,
                revisionLimit: true,
              },
            },
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: this.messageInclude,
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const data = await Promise.all(
      conversations.map(async (conversation) => {
        const lastReadAt = conversation.participants[0]?.lastReadAt;
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: userId },
            deletedAt: null,
            ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
          },
        });
        const other =
          conversation.order.clientId === userId
            ? conversation.order.provider
            : conversation.order.client;
        const latest = conversation.messages[0];
        return {
          id: conversation.id,
          unreadCount,
          updatedAt: latest?.createdAt ?? conversation.createdAt,
          participant: {
            id: other.id,
            displayName: other.displayName,
            hasAvatar: Boolean(other.avatarPath),
            avatarVersion: other.updatedAt.getTime(),
          },
          latestMessage: latest ? this.toResponse(latest, userId) : null,
          order: {
            id: conversation.order.id,
            orderNumber: conversation.order.orderNumber,
            title: conversation.order.titleSnapshot,
            status: conversation.order.status,
            requirements: conversation.order.requirements,
            totalCentavos: conversation.order.totalCentavos,
            currency: conversation.order.currency,
            dueAt: conversation.order.dueAt,
            createdAt: conversation.order.createdAt,
            provider: {
              id: conversation.order.provider.id,
              displayName: conversation.order.provider.displayName,
            },
            package: conversation.order.servicePackage,
          },
        };
      }),
    );
    return {
      data: data.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    };
  }

  async list(userId: string, orderId: string) {
    const conversation = await this.requireParticipant(userId, orderId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      include: this.messageInclude,
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const readAt = new Date();
    await Promise.all([
      this.prisma.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId: conversation.id, userId },
        },
        data: { lastReadAt: readAt, lastReadMessageId: messages.at(-1)?.id, hiddenAt: null },
      }),
      this.prisma.notification.updateMany({
        where: {
          recipientId: userId,
          orderId,
          type: "NEW_MESSAGE",
          readAt: null,
        },
        data: { readAt },
      }),
    ]);
    return {
      data: messages.map((message) => this.toResponse(message, userId)),
    };
  }

  async send(userId: string, orderId: string, body: string) {
    const conversation = await this.requireParticipant(userId, orderId);
    const text = body.trim();
    const recipientId =
      conversation.order.clientId === userId
        ? conversation.order.providerId
        : conversation.order.clientId;
    const message = await this.prisma.$transaction(async (database) => {
      const created = await database.message.create({
        data: { conversationId: conversation.id, senderId: userId, body: text },
        include: this.messageInclude,
      });
      await database.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId: conversation.id, userId },
        },
        data: { lastReadAt: new Date(), lastReadMessageId: created.id },
      });
      await database.conversationParticipant.updateMany({
        where: { conversationId: conversation.id, userId: recipientId },
        data: { hiddenAt: null },
      });
      await database.notification.create({
        data: {
          orderId,
          recipientId,
          type: "NEW_MESSAGE",
          title: "New order message",
          body: `${created.sender.displayName} sent a message about ${conversation.order.titleSnapshot}.`,
        },
      });
      return created;
    });
    return { data: this.toResponse(message, userId) };
  }

  async sendAttachments(
    userId: string,
    orderId: string,
    body: string | undefined,
    files: Express.Multer.File[],
  ) {
    if (!files.length)
      throw new BadRequestException("Choose at least one attachment");
    const conversation = await this.requireParticipant(userId, orderId);
    const recipientId =
      conversation.order.clientId === userId
        ? conversation.order.providerId
        : conversation.order.clientId;
    const text = body?.trim() || null;
    const message = await this.prisma.$transaction(async (database) => {
      const createdFiles = await Promise.all(
        files.map((file) =>
          database.orderFile.create({
            data: {
              orderId,
              uploadedBy: userId,
              purpose: "MESSAGE_ATTACHMENT",
              storagePath: file.filename,
              originalName: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
            },
          }),
        ),
      );
      const created = await database.message.create({
        data: {
          conversationId: conversation.id,
          senderId: userId,
          body: text,
          messageType: "FILE",
          attachments: {
            create: createdFiles.map((file) => ({ orderFileId: file.id })),
          },
        },
        include: this.messageInclude,
      });
      await database.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId: conversation.id, userId },
        },
        data: { lastReadAt: new Date(), lastReadMessageId: created.id },
      });
      await database.conversationParticipant.updateMany({
        where: { conversationId: conversation.id, userId: recipientId },
        data: { hiddenAt: null },
      });
      await database.notification.create({
        data: {
          orderId,
          recipientId,
          type: "NEW_MESSAGE",
          title: "New order attachment",
          body: `${created.sender.displayName} attached ${files.length === 1 ? files[0].originalname : `${files.length} files`} to ${conversation.order.titleSnapshot}.`,
        },
      });
      return created;
    });
    return { data: this.toResponse(message, userId) };
  }

  async hideConversation(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { conversationId: true },
    });
    if (!participant) throw new NotFoundException("Conversation not found");

    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { hiddenAt: new Date() },
    });
    return { message: "Conversation removed from Messages" };
  }

  private async requireParticipant(userId: string, orderId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { orderId, participants: { some: { userId } } },
      include: {
        order: {
          select: { clientId: true, providerId: true, titleSnapshot: true },
        },
      },
    });
    if (!conversation)
      throw new NotFoundException("Order conversation not found");
    return conversation;
  }

  private toResponse(message: any, userId: string) {
    return {
      id: message.id,
      body: message.body,
      messageType: message.messageType,
      createdAt: message.createdAt,
      isMine: message.senderId === userId,
      attachments: (message.attachments ?? []).map(
        (item: any) => item.orderFile,
      ),
      sender: {
        id: message.sender.id,
        displayName: message.sender.displayName,
        hasAvatar: Boolean(message.sender.avatarPath),
        avatarVersion: message.sender.updatedAt.getTime(),
      },
    };
  }

  private readonly messageInclude = {
    sender: {
      select: {
        id: true,
        displayName: true,
        avatarPath: true,
        updatedAt: true,
      },
    },
    attachments: {
      include: {
        orderFile: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    },
  } as const;
}
