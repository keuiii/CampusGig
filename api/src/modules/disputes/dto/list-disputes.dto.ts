import { DisputeStatus } from "@prisma/client";
import { IsEnum, IsOptional } from "class-validator";

export class ListDisputesDto {
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}
