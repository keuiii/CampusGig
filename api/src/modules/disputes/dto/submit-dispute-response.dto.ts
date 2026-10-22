import { IsString, MaxLength, MinLength } from "class-validator";

export class SubmitDisputeResponseDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  details!: string;
}
