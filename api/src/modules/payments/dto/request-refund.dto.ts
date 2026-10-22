import { ApiProperty } from "@nestjs/swagger";
import { MarketplaceRefundReason } from "@prisma/client";
import { IsEnum } from "class-validator";

const clientRefundReasons = [
  MarketplaceRefundReason.PAID_NOT_STARTED,
  MarketplaceRefundReason.MISSED_RUSH_DEADLINE,
] as const;

export class RequestRefundDto {
  @ApiProperty({ enum: clientRefundReasons })
  @IsEnum(clientRefundReasons)
  reason!: (typeof clientRefundReasons)[number];
}
