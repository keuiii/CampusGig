import { IsOptional, IsString, MaxLength } from "class-validator";

export class SendAttachmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;
}
