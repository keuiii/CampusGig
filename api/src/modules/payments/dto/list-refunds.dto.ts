import { RefundStatus } from "@prisma/client";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export class ListRefundsDto {
  @ApiPropertyOptional({ enum: RefundStatus })
  @IsOptional()
  @IsEnum(RefundStatus)
  status?: RefundStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
