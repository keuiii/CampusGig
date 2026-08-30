import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, orderId: string) {
    const conversation = await this.requireParticipant(userId, orderId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      include: this.messageInclude,
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: conversation.id, userId } },
      data: { lastReadAt: new Date(), lastReadMessageId: messages.at(-1)?.id },
    });
    return { data: messages.map((message) => this.toResponse(message, userId)) };
  }

  async send(userId: string, orderId: string, body: string) {
    const conversation = await this.requireParticipant(userId, orderId);
    const text = body.trim();
    const recipientId = conversation.order.clientId === userId ? conversation.order.providerId : conversation.order.clientId;
    const message = await this.prisma.$transaction(async (database) => {
      const created = await database.message.create({
        data: { conversationId: conversation.id, senderId: userId, body: text },
        include: this.messageInclude,
      });
      await database.conversationParticipant.update({ where: { conversationId_userId: { conversationId: conversation.id, userId } }, data: { lastReadAt: new Date(), lastReadMessageId: created.id } });
      await database.notification.create({ data: { orderId, recipientId, type: "NEW_MESSAGE", title: "New order message", body: `${created.sender.displayName} sent a message about ${conversation.order.titleSnapshot}.` } });
      return created;
    });
    return { data: this.toResponse(message, userId) };
  }

  async sendAttachments(userId: string, orderId: string, body: string | undefined, files: Express.Multer.File[]) {
    if (!files.length) throw new BadRequestException("Choose at least one attachment");
    const conversation = await this.requireParticipant(userId, orderId);
    const recipientId = conversation.order.clientId === userId ? conversation.order.providerId : conversation.order.clientId;
    const text = body?.trim() || null;
    const message = await this.prisma.$transaction(async (database) => {
      const createdFiles = await Promise.all(files.map((file) => database.orderFile.create({ data: { orderId, uploadedBy: userId, purpose: "MESSAGE_ATTACHMENT", storagePath: file.filename, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size } })));
      const created = await database.message.create({
        data: { conversationId: conversation.id, senderId: userId, body: text, messageType: "FILE", attachments: { create: createdFiles.map((file) => ({ orderFileId: file.id })) } },
        include: this.messageInclude,
      });
      await database.conversationParticipant.update({ where: { conversationId_userId: { conversationId: conversation.id, userId } }, data: { lastReadAt: new Date(), lastReadMessageId: created.id } });
      await database.notification.create({ data: { orderId, recipientId, type: "NEW_MESSAGE", title: "New order attachment", body: `${created.sender.displayName} attached ${files.length === 1 ? files[0].originalname : `${files.length} files`} to ${conversation.order.titleSnapshot}.` } });
      return created;
    });
    return { data: this.toResponse(message, userId) };
  }

  private async requireParticipant(userId: string, orderId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { orderId, participants: { some: { userId } } },
      include: { order: { select: { clientId: true, providerId: true, titleSnapshot: true } } },
    });
    if (!conversation) throw new NotFoundException("Order conversation not found");
    return conversation;
  }

  private toResponse(message: any, userId: string) {
    return { id: message.id, body: message.body, messageType: message.messageType, createdAt: message.createdAt, isMine: message.senderId === userId, attachments: (message.attachments ?? []).map((item: any) => item.orderFile), sender: { id: message.sender.id, displayName: message.sender.displayName, hasAvatar: Boolean(message.sender.avatarPath), avatarVersion: message.sender.updatedAt.getTime() } };
  }

  private readonly messageInclude = { sender: { select: { id: true, displayName: true, avatarPath: true, updatedAt: true } }, attachments: { include: { orderFile: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } } } } as const;
}
