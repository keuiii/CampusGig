import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Max,
  Min,
  MinLength,
} from "class-validator";

export class UpdateProviderProfileDto {
  @IsString() @MinLength(3) @MaxLength(100) headline!: string;
  @IsString() @MinLength(20) @MaxLength(1000) bio!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(15)
  @IsString({ each: true })
  skills!: string[];
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxActiveOrders?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxPendingOrders?: number;
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(300)
  instagramUrl?: string | null;
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(300)
  linkedinUrl?: string | null;
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(300)
  xUrl?: string | null;
  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  @MaxLength(300)
  portfolioUrl?: string | null;
}
