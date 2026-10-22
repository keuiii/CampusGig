import { DisputeStatus } from "@prisma/client";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional } from "class-validator";
import { CursorPageDto } from "../../../common/cursor-page.dto";

export class ListDisputesDto extends CursorPageDto {
  @ApiPropertyOptional({ enum: DisputeStatus })
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;
}
