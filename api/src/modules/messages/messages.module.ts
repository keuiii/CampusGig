import { Module } from "@nestjs/common";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";
import { ConversationInboxController } from "./conversation-inbox.controller";
import { MessagesGateway } from "./messages.gateway";

@Module({
  controllers: [MessagesController, ConversationInboxController],
  providers: [MessagesService, MessagesGateway],
})
export class MessagesModule {}
