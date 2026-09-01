import { IsIn, IsString, Length } from "class-validator";

export class PasswordChangeDecisionDto {
  @IsString()
  @Length(32, 200)
  token!: string;

  @IsIn(["CONFIRMED", "REJECTED"])
  decision!: "CONFIRMED" | "REJECTED";
}
