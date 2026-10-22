import { Transform } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional } from "class-validator";
import { CursorPageDto } from "../../../common/cursor-page.dto";

export class ListConversationsDto extends CursorPageDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  archived = false;
}
