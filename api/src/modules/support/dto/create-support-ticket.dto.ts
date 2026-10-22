import { SupportTicketCategory, SupportTicketSource } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsEnum, IsString, MaxLength, MinLength } from "class-validator";

export class CreateSupportTicketDto {
  @IsEnum(SupportTicketCategory)
  category!: SupportTicketCategory;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @MinLength(5)
  @MaxLength(120)
  subject!: string;

  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @MinLength(20)
  @MaxLength(2000)
  message!: string;

  @IsEnum(SupportTicketSource)
  source!: SupportTicketSource;
}
