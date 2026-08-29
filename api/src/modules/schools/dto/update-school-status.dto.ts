import { SchoolStatus } from "@prisma/client";
import { IsEnum } from "class-validator";

export class UpdateSchoolStatusDto {
  @IsEnum(SchoolStatus) status!: SchoolStatus;
}
