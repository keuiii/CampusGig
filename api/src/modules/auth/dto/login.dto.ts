import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { SessionClientDto } from "./session-client.dto";

export class LoginDto extends SessionClientDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(200)
  trustedDeviceToken?: string;
}
