import { IsBoolean } from "class-validator";

export class UpdateProviderAvailabilityDto {
  @IsBoolean()
  isAvailable!: boolean;
}
