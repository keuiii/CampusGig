import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from "class-validator";

export class ChangePasswordDto {
  @IsString() @MinLength(8) @MaxLength(72) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(72) newPassword!: string;

  @IsOptional()
  @IsString()
  @Length(6, 20)
  mfaCode?: string;

  @IsOptional()
  @IsBoolean()
  recoveryCode?: boolean;
}
