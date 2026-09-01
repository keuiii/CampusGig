import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class SocialLoginDto {
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
