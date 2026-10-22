import { DisputeResponseParty } from "@prisma/client";
import { IsEnum } from "class-validator";

export class RequestDisputeResponseDto {
  @IsEnum(DisputeResponseParty)
  requestedFrom!: DisputeResponseParty;
}
