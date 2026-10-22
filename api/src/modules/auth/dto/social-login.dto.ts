import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { SessionClientDto } from "./session-client.dto";

export class SocialLoginDto extends SessionClientDto {
  @IsIn(["GOOGLE"])
  provider!: "GOOGLE";

  @IsString()
  @MinLength(20)
  idToken!: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(200)
  trustedDeviceToken?: string;
}
