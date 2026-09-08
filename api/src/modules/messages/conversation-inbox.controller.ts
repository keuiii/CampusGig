import { Controller, Delete, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MessagesService } from "./messages.service";

@ApiTags("messages")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("conversations")
export class ConversationInboxController {
  constructor(private readonly messages: MessagesService) {}
  @Get() inbox(@Req() request: AuthenticatedRequest) {
    return this.messages.inbox(request.auth.sub);
  }

  @Delete(":conversationId")
  remove(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId") conversationId: string,
  ) {
    return this.messages.hideConversation(request.auth.sub, conversationId);
  }
}
