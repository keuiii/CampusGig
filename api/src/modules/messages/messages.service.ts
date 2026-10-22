import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../../common/storage/storage.service";
import { MessagesGateway } from "./messages.gateway";
import type { ListMessagesDto } from "./dto/list-messages.dto";
import type { UpdateConversationPreferencesDto } from "./dto/update-conversation-preferences.dto";
import { Prisma } from "@prisma/client";
import {
  decodeConversationCursor,
  encodeConversationCursor,
} from "./conversation-cursor";

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime?: MessagesGateway,
  ) {}

  async inbox(userId: string, archived = false, cursor?: string, limit = 20) {
    const decodedCursor = cursor ? decodeConversationCursor(cursor) : null;
    const snapshotAt = decodedCursor?.snapshotAt ?? new Date();
    const cursorFilter = !decodedCursor
      ? Prisma.empty
      : decodedCursor.pinned
        ? Prisma.sql`AND (
            ranked."isPinned" = false OR
            (ranked."isPinned" = true AND (
              ranked."updatedAt" < ${decodedCursor.updatedAt} OR
              (ranked."updatedAt" = ${decodedCursor.updatedAt} AND ranked."id" < ${decodedCursor.id}::uuid)
            ))
          )`
        : Prisma.sql`AND ranked."isPinned" = false AND (
            ranked."updatedAt" < ${decodedCursor.updatedAt} OR
            (ranked."updatedAt" = ${decodedCursor.updatedAt} AND ranked."id" < ${decodedCursor.id}::uuid)
          )`;
    const ranked = await this.prisma.$queryRaw<
      {
        id: string;
        isPinned: boolean;
        updatedAt: Date;
        unreadCount: bigint;
        totalUnreadCount: bigint;
      }[]
    >(Prisma.sql`
      WITH ranked AS (
        SELECT
          c."id",
          (cp."pinnedAt" IS NOT NULL AND cp."pinnedAt" <= ${snapshotAt}) AS "isPinned",
          COALESCE(MAX(m."createdAt"), c."createdAt") AS "updatedAt",
          COUNT(m."id") FILTER (
            WHERE m."senderId" <> ${userId}::uuid
              AND m."createdAt" <= ${snapshotAt}
              AND (cp."lastReadAt" IS NULL OR m."createdAt" > cp."lastReadAt")
          )::bigint AS "unreadCount"
        FROM "ConversationParticipant" cp
        INNER JOIN "Conversation" c ON c."id" = cp."conversationId"
        LEFT JOIN "Message" m
          ON m."conversationId" = c."id"
          AND m."deletedAt" IS NULL
          AND m."createdAt" <= ${snapshotAt}
        WHERE cp."userId" = ${userId}::uuid
          AND c."createdAt" <= ${snapshotAt}
          AND cp."hiddenAt" IS NULL
          AND ${archived ? Prisma.sql`cp."archivedAt" IS NOT NULL` : Prisma.sql`cp."archivedAt" IS NULL`}
          AND (
            c."kind" = 'ORDER'::"ConversationKind" OR
            (c."kind" = 'INQUIRY'::"ConversationKind" AND m."id" IS NOT NULL)
          )
        GROUP BY c."id", c."createdAt", cp."pinnedAt", cp."lastReadAt"
      )
      SELECT
        ranked."id",
        ranked."isPinned",
        ranked."updatedAt",
        ranked."unreadCount",
        SUM(ranked."unreadCount") OVER ()::bigint AS "totalUnreadCount"
      FROM ranked
      WHERE true ${cursorFilter}
      ORDER BY ranked."isPinned" DESC, ranked."updatedAt" DESC, ranked."id" DESC
      LIMIT ${limit + 1}
    `);
    const hasMore = ranked.length > limit;
    const pageRanks = hasMore ? ranked.slice(0, limit) : ranked;
    const ids = pageRanks.map((item) => item.id);
    if (ids.length === 0)
      return {
        data: [],
        unreadCount: 0,
        pagination: { hasMore: false, nextCursor: null },
      };
    const conversations = await this.prisma.conversation.findMany({
      where: {
        id: { in: ids },
      },
      include: {
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
        messages: {
          where: { deletedAt: null, createdAt: { lte: snapshotAt } },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: this.messageInclude,
        },
      },
    });
    const conversationsById = new Map(
      conversations.map((conversation) => [conversation.id, conversation]),
    );
    const data = pageRanks.map((rank) => {
      const conversation = conversationsById.get(rank.id);
      if (!conversation) throw new NotFoundException("Conversation not found");
      const unreadCount = Number(rank.unreadCount);
      const other = conversation.order
        ? conversation.order.clientId === userId
          ? conversation.order.provider
          : conversation.order.client
        : conversation.clientId === userId
          ? conversation.provider
          : conversation.client;
      if (!other)
        throw new NotFoundException("Conversation participant not found");
      const latest = conversation.messages[0];
      return {
        id: conversation.id,
        kind: conversation.kind,
        subject: conversation.order?.titleSnapshot ?? "Provider inquiry",
        contextLabel: conversation.order?.orderNumber ?? "PRE-ORDER INQUIRY",
        unreadCount,
        updatedAt: rank.updatedAt,
        isPinned: rank.isPinned,
        isArchived: archived,
        participant: {
          id: other.id,
          displayName: other.displayName,
          hasAvatar: Boolean(other.avatarPath),
          avatarVersion: other.updatedAt.getTime(),
        },
        latestMessage: latest ? this.toResponse(latest, userId) : null,
        order: conversation.order
          ? {
              id: conversation.order.id,
              orderNumber: conversation.order.orderNumber,
              title: conversation.order.titleSnapshot,
              status: conversation.order.status,
              pricingModel: conversation.order.pricingModel,
              requirements: conversation.order.requirements,
              totalCentavos: conversation.order.totalCentavos,
              currency: conversation.order.currency,
              dueAt: conversation.order.dueAt,
              deliveryOption: conversation.order.deliveryOption,
              deliveryDurationMinutes:
                conversation.order.deliveryDurationMinutes,
              createdAt: conversation.order.createdAt,
              provider: {
                id: conversation.order.provider.id,
                displayName: conversation.order.provider.displayName,
              },
              package: conversation.order.servicePackage,
            }
          : null,
      };
    });
    const last = pageRanks.at(-1);
    return {
      data,
      unreadCount: Number(pageRanks[0]?.totalUnreadCount ?? 0),
      pagination: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeConversationCursor({
                pinned: last.isPinned,
                updatedAt: last.updatedAt,
                id: last.id,
                snapshotAt,
              })
            : null,
      },
    };
  }

  async startProviderInquiry(clientId: string, providerId: string) {
    if (clientId === providerId)
      throw new BadRequestException(
        "You cannot message your own provider profile",
      );

    const provider = await this.prisma.user.findFirst({
      where: {
        id: providerId,
        status: "ACTIVE",
        roles: { some: { role: "PROVIDER" } },
        providerProfile: { isNot: null },
        studentProfile: { school: { status: "ACTIVE" } },
      },
      select: {
        id: true,
        displayName: true,
        avatarPath: true,
        updatedAt: true,
      },
    });
    if (!provider) throw new NotFoundException("Provider profile not found");

    const conversation = await this.prisma.conversation.upsert({
      where: { clientId_providerId: { clientId, providerId } },
      create: {
        kind: "INQUIRY",
        clientId,
        providerId,
        participants: {
          create: [{ userId: clientId }, { userId: providerId }],
        },
      },
      update: {},
      select: { id: true, createdAt: true },
    });
    await this.prisma.conversationParticipant.update({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: clientId,
        },
      },
      data: { hiddenAt: null, archivedAt: null },
    });
    return {
      data: {
        id: conversation.id,
        kind: "INQUIRY",
        subject: "Provider inquiry",
        contextLabel: "PRE-ORDER INQUIRY",
        unreadCount: 0,
        updatedAt: conversation.createdAt,
        isPinned: false,
        isArchived: false,
        participant: {
          id: provider.id,
          displayName: provider.displayName,
          hasAvatar: Boolean(provider.avatarPath),
          avatarVersion: provider.updatedAt.getTime(),
        },
        latestMessage: null,
        order: null,
      },
      message: "Provider conversation ready",
    };
  }

  async list(
    userId: string,
    orderId: string,
    query: ListMessagesDto = { limit: 50 },
  ) {
    const conversation = await this.requireParticipant(userId, orderId);
    return this.listMessages(userId, conversation, query);
  }

  async listConversation(
    userId: string,
    conversationId: string,
    query: ListMessagesDto = { limit: 50 },
  ) {
    const conversation = await this.requireConversationParticipant(
      userId,
      conversationId,
    );
    return this.listMessages(userId, conversation, query);
  }

  private async listMessages(
    userId: string,
    conversation: Awaited<
      ReturnType<MessagesService["requireConversationParticipant"]>
    >,
    query: ListMessagesDto,
  ) {
    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      include: this.messageInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
      ...(query.before ? { cursor: { id: query.before }, skip: 1 } : {}),
    });
    const chronologicalMessages = [...messages].reverse();
    const readAt = new Date();
    await Promise.all([
      this.prisma.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId: conversation.id, userId },
        },
        data: {
          lastReadAt: readAt,
          lastReadMessageId: messages[0]?.id,
          hiddenAt: null,
        },
      }),
      this.prisma.notification.updateMany({
        where: {
          recipientId: userId,
          type: "NEW_MESSAGE",
          readAt: null,
          OR: [
            { conversationId: conversation.id },
            ...(conversation.orderId
              ? [{ orderId: conversation.orderId }]
              : []),
          ],
        },
        data: { readAt },
      }),
    ]);
    this.realtime?.publishRead(conversation.id, conversation.orderId, userId);
    return {
      data: chronologicalMessages.map((message) =>
        this.toResponse(message, userId),
      ),
      page: {
        nextCursor:
          messages.length === query.limit
            ? (messages.at(-1)?.id ?? null)
            : null,
        limit: query.limit,
      },
    };
  }

  async send(userId: string, orderId: string, body: string) {
    const conversation = await this.requireParticipant(userId, orderId);
    return this.sendMessage(userId, conversation, body);
  }

  async sendConversation(userId: string, conversationId: string, body: string) {
    const conversation = await this.requireConversationParticipant(
      userId,
      conversationId,
    );
    return this.sendMessage(userId, conversation, body);
  }

  private async sendMessage(
    userId: string,
    conversation: Awaited<
      ReturnType<MessagesService["requireConversationParticipant"]>
    >,
    body: string,
  ) {
    const text = body.trim();
    const recipientId = this.recipientId(conversation, userId);
    const message = await this.prisma.$transaction(async (database) => {
      const created = await database.message.create({
        data: { conversationId: conversation.id, senderId: userId, body: text },
        include: this.messageInclude,
      });
      await database.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId: conversation.id, userId },
        },
        data: {
          lastReadAt: new Date(),
          lastReadMessageId: created.id,
          hiddenAt: null,
          archivedAt: null,
        },
      });
      await database.conversationParticipant.updateMany({
        where: { conversationId: conversation.id, userId: recipientId },
        data: { hiddenAt: null, archivedAt: null },
      });
      await database.notification.create({
        data: {
          orderId: conversation.orderId,
          conversationId: conversation.id,
          recipientId,
          type: "NEW_MESSAGE",
          title: conversation.order
            ? "New order message"
            : "New provider inquiry",
          body: conversation.order
            ? `${created.sender.displayName} sent a message about ${conversation.order.titleSnapshot}.`
            : `${created.sender.displayName} sent a pre-order message.`,
        },
      });
      return created;
    });
    const response = this.toResponse(message, userId);
    this.realtime?.publishMessage(
      conversation.id,
      conversation.orderId,
      response,
      recipientId,
    );
    return { data: response };
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
    if (!conversation.order)
      throw new NotFoundException("Order conversation not found");
    const order = conversation.order;
    const recipientId =
      order.clientId === userId ? order.providerId : order.clientId;
    const text = body?.trim() || null;
    const stored = await this.storage.persistUploads("order-files", files);
    let message;
    try {
      message = await this.prisma.$transaction(async (database) => {
        const createdFiles = await Promise.all(
          files.map((file, index) =>
            database.orderFile.create({
              data: {
                orderId,
                uploadedBy: userId,
                purpose: "MESSAGE_ATTACHMENT",
                storagePath: stored[index],
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
          data: {
            lastReadAt: new Date(),
            lastReadMessageId: created.id,
            hiddenAt: null,
            archivedAt: null,
          },
        });
        await database.conversationParticipant.updateMany({
          where: { conversationId: conversation.id, userId: recipientId },
          data: { hiddenAt: null, archivedAt: null },
        });
        await database.notification.create({
          data: {
            orderId,
            conversationId: conversation.id,
            recipientId,
            type: "NEW_MESSAGE",
            title: "New order attachment",
            body: `${created.sender.displayName} attached ${files.length === 1 ? files[0].originalname : `${files.length} files`} to ${order.titleSnapshot}.`,
          },
        });
        return created;
      });
    } catch (error) {
      await Promise.all(
        stored.map((key) => this.storage.delete("order-files", key)),
      );
      throw error;
    }
    const response = this.toResponse(message, userId);
    this.realtime?.publishMessage(
      conversation.id,
      orderId,
      response,
      recipientId,
    );
    return { data: response };
  }

  async hideConversation(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { conversationId: true },
    });
    if (!participant) throw new NotFoundException("Conversation not found");

    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { hiddenAt: new Date(), pinnedAt: null, archivedAt: null },
    });
    return { message: "Conversation removed from Messages" };
  }

  async updateConversationPreferences(
    userId: string,
    conversationId: string,
    preferences: UpdateConversationPreferencesDto,
  ) {
    if (preferences.pinned === undefined && preferences.archived === undefined)
      throw new BadRequestException(
        "Choose a conversation preference to update",
      );

    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { conversationId: true },
    });
    if (!participant) throw new NotFoundException("Conversation not found");

    const archivedAt =
      preferences.archived === undefined
        ? undefined
        : preferences.archived
          ? new Date()
          : null;
    const pinnedAt = preferences.archived
      ? null
      : preferences.pinned === undefined
        ? undefined
        : preferences.pinned
          ? new Date()
          : null;
    const updated = await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { archivedAt, pinnedAt, hiddenAt: null },
      select: { pinnedAt: true, archivedAt: true },
    });
    return {
      data: {
        isPinned: Boolean(updated.pinnedAt),
        isArchived: Boolean(updated.archivedAt),
      },
    };
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

  private async requireConversationParticipant(
    userId: string,
    conversationId: string,
  ) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, participants: { some: { userId } } },
      include: {
        order: {
          select: { clientId: true, providerId: true, titleSnapshot: true },
        },
      },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return conversation;
  }

  private recipientId(
    conversation: Awaited<
      ReturnType<MessagesService["requireConversationParticipant"]>
    >,
    userId: string,
  ) {
    if (conversation.order)
      return conversation.order.clientId === userId
        ? conversation.order.providerId
        : conversation.order.clientId;
    const recipientId =
      conversation.clientId === userId
        ? conversation.providerId
        : conversation.clientId;
    if (!recipientId)
      throw new NotFoundException("Conversation participant not found");
    return recipientId;
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
