import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateReviewDto {
  @IsInt() @Min(1) @Max(5) overallRating!: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) qualityRating?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) communicationRating?: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) timelinessRating?: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
