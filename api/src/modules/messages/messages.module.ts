import { Module } from "@nestjs/common";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";
import { ConversationInboxController } from "./conversation-inbox.controller";

@Module({
  controllers: [MessagesController, ConversationInboxController],
  providers: [MessagesService],
})
export class MessagesModule {}
