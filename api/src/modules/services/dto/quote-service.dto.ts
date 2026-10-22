import { DeliveryOption } from "@prisma/client";
import { IsEnum } from "class-validator";

export class QuoteServiceDto {
  @IsEnum(DeliveryOption) deliveryOption!: DeliveryOption;
}
