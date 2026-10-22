import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class SessionClientDto {
  @IsOptional()
  @IsIn(["WEB", "MOBILE"])
  clientType?: "WEB" | "MOBILE";

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  deviceName?: string;
}

export class RefreshSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(500)
  refreshToken?: string;
}
