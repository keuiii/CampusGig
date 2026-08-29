import { IsEmail, MaxLength } from "class-validator";

export class EmailOnlyDto {
  @IsEmail() @MaxLength(254) email!: string;
}
