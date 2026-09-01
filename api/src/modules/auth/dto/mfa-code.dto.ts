import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";

export class MfaCodeDto {
  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;
}

export class MfaChallengeDto {
  @IsString()
  @Length(32, 200)
  challengeToken!: string;

  @IsString()
  @Length(6, 20)
  code!: string;

  @IsOptional()
  @IsBoolean()
  recoveryCode?: boolean;

  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
