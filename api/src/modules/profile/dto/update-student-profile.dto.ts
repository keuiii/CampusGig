import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class UpdateStudentProfileDto {
  @IsUUID() schoolId!: string;
  @IsString() @MaxLength(120) program!: string;
  @IsInt() @Min(1) @Max(10) yearLevel!: number;
  @IsOptional() @IsString() @MaxLength(500) bio?: string;
}
