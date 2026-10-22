import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PublicProviderReviewsQueryDto } from "./dto/public-provider-reviews-query.dto";
import { ProviderService } from "./provider.service";

@ApiTags("providers")
@Controller("providers")
export class PublicProviderController {
  constructor(private readonly providers: ProviderService) {}

  @Get(":id/public")
  @Header("Cache-Control", "no-store")
  publicProfile(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.providers.getPublicProfile(id);
  }

  @Get(":id/reviews")
  @Header("Cache-Control", "no-store")
  publicReviews(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: PublicProviderReviewsQueryDto,
  ) {
    return this.providers.getPublicReviews(id, query.page, query.pageSize);
  }
}
