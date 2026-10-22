import { Type } from "class-transformer";
import {
  Equals,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class ReviewPayoutDestinationDto {
  @IsString()
  @Length(20, 1000)
  note!: string;
}

export class PayoutDecisionDto {
  @IsString()
  @Length(20, 1000)
  note!: string;
}

export class BeginManualPayoutDto {
  @IsString()
  @Length(20, 1000)
  note!: string;

  @IsString()
  @Equals("MANUAL SETTLEMENT")
  confirmation!: "MANUAL SETTLEMENT";
}

export class SettleManualPayoutDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCentavos!: number;

  @IsString()
  @Length(4, 120)
  manualReference!: string;

  @IsDateString()
  settledAt!: string;

  @IsString()
  @Length(20, 1000)
  note!: string;

  @IsString()
  @Equals("MANUAL SETTLEMENT CONFIRMED")
  confirmation!: "MANUAL SETTLEMENT CONFIRMED";
}

export class ListPayoutsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
}
