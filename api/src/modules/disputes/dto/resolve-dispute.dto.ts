import { DisputeStatus } from "@prisma/client";
import { IsIn, IsString, MaxLength, MinLength } from "class-validator";

const resolutionStatuses = [
  DisputeStatus.RESOLVED_CLIENT,
  DisputeStatus.RESOLVED_PROVIDER,
  DisputeStatus.CLOSED,
] as const;

export class ResolveDisputeDto {
  @IsIn(resolutionStatuses)
  status!: (typeof resolutionStatuses)[number];

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  resolutionNote!: string;
}
