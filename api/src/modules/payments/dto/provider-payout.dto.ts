import { ApiProperty } from "@nestjs/swagger";
import { PayoutDestinationType } from "@prisma/client";
import {
  Equals,
  IsEnum,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";

export class CreatePayoutDestinationDto {
  @ApiProperty({ enum: PayoutDestinationType })
  @IsEnum(PayoutDestinationType)
  type!: PayoutDestinationType;

  @IsString()
  @Length(2, 80)
  displayLabel!: string;

  @IsString()
  @Length(4, 80)
  accountIdentifier!: string;

  @IsString()
  @Length(2, 120)
  accountHolderName!: string;
}

export class RequestProviderPayoutDto {
  @IsUUID()
  destinationId!: string;

  @IsUUID()
  clientRequestId!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class ConfirmPayoutActionDto {
  @IsString()
  @Equals("CONFIRM")
  confirmation!: "CONFIRM";
}
