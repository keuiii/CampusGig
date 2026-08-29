import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class UpdateProviderProfileDto {
  @IsString() @MinLength(3) @MaxLength(100) headline!: string;
  @IsString() @MinLength(20) @MaxLength(1000) bio!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(15) @IsString({ each: true }) skills!: string[];
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}
