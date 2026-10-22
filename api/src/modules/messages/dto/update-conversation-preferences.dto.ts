import { IsBoolean, IsOptional } from "class-validator";

export class UpdateConversationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
