import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MessagesService } from "./messages.service";
import { UpdateConversationPreferencesDto } from "./dto/update-conversation-preferences.dto";
import { CreateProviderInquiryDto } from "./dto/create-provider-inquiry.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { ListMessagesDto } from "./dto/list-messages.dto";
import { ListConversationsDto } from "./dto/list-conversations.dto";

@ApiTags("messages")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("conversations")
export class ConversationInboxController {
  constructor(private readonly messages: MessagesService) {}
  @Get() inbox(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListConversationsDto,
  ) {
    return this.messages.inbox(
      request.auth.sub,
      query.archived,
      query.cursor,
      query.limit,
    );
  }

  @Post("inquiries")
  startInquiry(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateProviderInquiryDto,
  ) {
    return this.messages.startProviderInquiry(
      request.auth.sub,
      body.providerId,
    );
  }

  @Get(":conversationId/messages")
  listMessages(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ParseUUIDPipe()) conversationId: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.messages.listConversation(
      request.auth.sub,
      conversationId,
      query,
    );
  }

  @Post(":conversationId/messages")
  sendMessage(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", new ParseUUIDPipe()) conversationId: string,
    @Body() body: SendMessageDto,
  ) {
    return this.messages.sendConversation(
      request.auth.sub,
      conversationId,
      body.body,
    );
  }

  @Patch(":conversationId/preferences")
  updatePreferences(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
    @Body() body: UpdateConversationPreferencesDto,
  ) {
    return this.messages.updateConversationPreferences(
      request.auth.sub,
      conversationId,
      body,
    );
  }

  @Delete(":conversationId")
  remove(
    @Req() request: AuthenticatedRequest,
    @Param("conversationId", ParseUUIDPipe) conversationId: string,
  ) {
    return this.messages.hideConversation(request.auth.sub, conversationId);
  }
}
