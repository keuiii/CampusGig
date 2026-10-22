import { Module } from "@nestjs/common";
import { ProviderController } from "./provider.controller";
import { PublicProviderController } from "./public-provider.controller";
import { ProviderService } from "./provider.service";
import { MessagesModule } from "../messages/messages.module";
@Module({
  imports: [MessagesModule],
  controllers: [ProviderController, PublicProviderController],
  providers: [ProviderService],
})
export class ProviderModule {}
