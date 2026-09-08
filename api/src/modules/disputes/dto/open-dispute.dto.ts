import { DisputeReason } from "@prisma/client";
import { IsEnum, IsString, MaxLength, MinLength } from "class-validator";

export class OpenDisputeDto {
  @IsEnum(DisputeReason)
  reason!: DisputeReason;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  details!: string;
}
