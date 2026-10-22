import { Module } from "@nestjs/common";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";
import { ConversationInboxController } from "./conversation-inbox.controller";
import { MessagesGateway } from "./messages.gateway";
import { TrafficProtectionModule } from "../../security/traffic-protection.module";

@Module({
  imports: [TrafficProtectionModule],
  controllers: [MessagesController, ConversationInboxController],
  providers: [MessagesService, MessagesGateway],
  exports: [MessagesGateway],
})
export class MessagesModule {}
