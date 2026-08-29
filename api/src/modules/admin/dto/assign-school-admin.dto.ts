import { IsEmail, IsUUID, MaxLength } from "class-validator";

export class AssignSchoolAdminDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsUUID() schoolId!: string;
}
