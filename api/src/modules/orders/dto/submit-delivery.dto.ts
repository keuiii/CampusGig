import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";

export class SubmitDeliveryDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  note!: string;

  @IsOptional()
  @IsUUID("4")
  clientRequestId?: string;
}
