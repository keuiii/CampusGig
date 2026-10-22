import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateExtraRevisionCheckoutDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  instructions!: string;

  @IsOptional()
  @IsIn(["WEB", "MOBILE"])
  returnTarget?: "WEB" | "MOBILE";
}
