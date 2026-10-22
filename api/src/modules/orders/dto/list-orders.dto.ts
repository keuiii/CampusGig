import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class ListOrdersDto {
  @IsOptional() @IsIn(["client", "provider"]) scope?: "client" | "provider";
  @IsOptional() @IsIn(["active", "archived"]) view?: "active" | "archived";
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
}
