import { ApiProperty } from "@nestjs/swagger";
import { MarketplaceRefundSource } from "@prisma/client";
import { IsEnum, IsString, IsUUID, Length } from "class-validator";

export class AdminRefundExceptionDto {
  @ApiProperty({ enum: MarketplaceRefundSource })
  @IsEnum(MarketplaceRefundSource)
  sourceType!: MarketplaceRefundSource;

  @IsUUID()
  sourceId!: string;

  @IsString()
  @Length(20, 1000)
  policyNote!: string;
}
