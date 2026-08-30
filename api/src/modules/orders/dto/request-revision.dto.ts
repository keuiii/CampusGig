import { IsString, MaxLength, MinLength } from "class-validator";

export class RequestRevisionDto {
  @IsString() @MinLength(10) @MaxLength(2000)
  instructions!: string;
}
