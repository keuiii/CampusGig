import { IsString, Length, Matches, MinLength } from "class-validator";

export class DisableMfaDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;
}

export class RegenerateRecoveryCodesDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
