import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { StorageService } from "../../common/storage/storage.service";
import type { UpdateStudentProfileDto } from "./dto/update-student-profile.dto";

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}
  async getAvatarPath(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true },
    });
    if (!user?.avatarPath)
      throw new NotFoundException("Profile picture not found");
    return user.avatarPath;
  }
  async updateAvatar(userId: string, file?: Express.Multer.File) {
    if (!file)
      throw new BadRequestException("Choose a JPG or PNG profile picture");
    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true },
    });
    const storagePath = await this.storage.persistUpload("avatars", file);
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarPath: storagePath },
      });
    } catch (error) {
      await this.storage.delete("avatars", storagePath);
      throw error;
    }
    if (previous?.avatarPath && previous.avatarPath !== storagePath)
      await this.storage.delete("avatars", previous.avatarPath);
    return { data: { hasAvatar: true } };
  }
  async getStudentProfile(userId: string) {
    return {
      data: await this.prisma.studentProfile.findUnique({
        where: { userId },
        include: { school: true },
      }),
    };
  }
  async updateStudentProfile(userId: string, input: UpdateStudentProfileDto) {
    const school = await this.prisma.school.findFirst({
      where: { id: input.schoolId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!school)
      throw new BadRequestException("Select an active participating school");
    const data = {
      schoolId: input.schoolId,
      program: input.program.trim(),
      yearLevel: input.yearLevel,
      bio: input.bio?.trim() || null,
    };
    return {
      data: await this.prisma.studentProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
        include: { school: true },
      }),
    };
  }
}
