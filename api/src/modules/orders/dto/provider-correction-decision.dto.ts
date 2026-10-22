import { IsBoolean } from "class-validator";

export class ProviderCorrectionDecisionDto {
  @IsBoolean()
  accepted!: boolean;
}
