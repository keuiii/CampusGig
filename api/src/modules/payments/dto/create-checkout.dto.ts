import { IsIn, IsOptional } from "class-validator";

export class CreateCheckoutDto {
  @IsOptional()
  @IsIn(["WEB", "MOBILE"])
  returnTarget?: "WEB" | "MOBILE";
}
