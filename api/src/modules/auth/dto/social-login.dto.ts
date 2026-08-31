import { IsIn, IsString, MinLength } from "class-validator";

export class SocialLoginDto {
  @IsIn(["GOOGLE"])
  provider!: "GOOGLE";

  @IsString()
  @MinLength(20)
  idToken!: string;
}
