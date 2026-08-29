import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateSchoolDto {
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsString() @MinLength(2) @MaxLength(30) shortName!: string;
  @IsOptional() @IsString() @MaxLength(120) emailDomain?: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
}
