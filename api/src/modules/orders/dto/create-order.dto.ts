import { IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateOrderDto {
  @IsUUID() serviceId!: string;
  @IsUUID() servicePackageId!: string;
  @IsString() @MinLength(10) @MaxLength(3000) requirements!: string;
}
