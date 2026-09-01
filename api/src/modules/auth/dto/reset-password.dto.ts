import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
  IsOptional,
  IsBoolean,
} from "class-validator";

export class ResetPasswordDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(6, 6) code!: string;
  @IsString() @MinLength(8) @MaxLength(72) password!: string;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(20) mfaCode?: string;
  @IsOptional() @IsBoolean() recoveryCode?: boolean;
}
