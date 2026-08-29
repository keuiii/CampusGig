import { Type } from "class-transformer";
import { DeliveryMethod, PackageTier } from "@prisma/client";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

export class CreateServicePackageDto {
  @IsEnum(PackageTier) tier!: PackageTier;
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @IsString() @MinLength(10) @MaxLength(500) description!: string;
  @IsInt() @Min(100) @Max(10000000) priceCentavos!: number;
  @IsInt() @Min(1) @Max(90) deliveryDays!: number;
  @IsInt() @Min(0) @Max(20) revisionLimit!: number;
}

export class CreateServiceDto {
  @IsString() @MinLength(2) @MaxLength(80) categoryId!: string;
  @IsString() @MinLength(10) @MaxLength(120) title!: string;
  @IsString() @MinLength(50) @MaxLength(3000) description!: string;
  @IsEnum(DeliveryMethod) deliveryMethod!: DeliveryMethod;
  @IsOptional() @IsString() @MaxLength(160) campusLocation?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => CreateServicePackageDto) packages!: CreateServicePackageDto[];
}
