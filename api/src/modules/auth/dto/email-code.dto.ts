import { IsEmail, IsString, Length, MaxLength } from "class-validator";
import { SessionClientDto } from "./session-client.dto";

export class EmailCodeDto extends SessionClientDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @Length(6, 6) code!: string;
}
