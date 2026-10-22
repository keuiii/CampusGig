import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

export class PublicProviderReviewsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  pageSize = 5;
}
