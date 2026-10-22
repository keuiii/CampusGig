import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const serviceSorts = [
  "recommended",
  "newest",
  "rating",
  "price-low",
  "delivery-fast",
] as const;
export const serviceBudgetRanges = [
  "any",
  "under-500",
  "500-999",
  "1000-2499",
  "2500-4999",
  "5000-plus",
] as const;

export class ListServicesDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  query?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @IsOptional()
  @IsIn(serviceBudgetRanges)
  budgetRange?: (typeof serviceBudgetRanges)[number];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minimumRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  maximumDeliveryDays?: number;

  @IsOptional()
  @IsIn(serviceSorts)
  sort?: (typeof serviceSorts)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;
}
