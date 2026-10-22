import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";
import { SessionClientDto } from "./session-client.dto";

export class MfaCodeDto {
  @IsString()
  @Matches(/^[0-9]{6}$/)
  code!: string;
}

export class MfaChallengeDto extends SessionClientDto {
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
