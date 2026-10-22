import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { DeliveryOption } from "@prisma/client";

export class CreateOrderDto {
  @IsOptional() @IsUUID("4") clientRequestId?: string;
  @IsUUID() serviceId!: string;
  @IsOptional() @IsUUID() servicePackageId?: string;
  @IsOptional() @IsEnum(DeliveryOption) deliveryOption?: DeliveryOption;
  @IsString() @MinLength(10) @MaxLength(3000) requirements!: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "requestedDeliveryDate must use YYYY-MM-DD format",
  })
  requestedDeliveryDate?: string;
}
