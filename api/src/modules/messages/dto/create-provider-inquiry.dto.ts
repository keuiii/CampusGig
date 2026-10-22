import { IsUUID } from "class-validator";

export class CreateProviderInquiryDto {
  @IsUUID()
  providerId!: string;
}
