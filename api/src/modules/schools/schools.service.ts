import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { CreateSchoolDto } from "./dto/create-school.dto";
import type { UpdateSchoolStatusDto } from "./dto/update-school-status.dto";

@Injectable()
export class SchoolsService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll() {
    const schools = await this.prisma.school.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, shortName: true, city: true },
      orderBy: { name: "asc" },
    });
    return { data: schools };
  }
  async findAllForAdmin() {
    return { data: await this.prisma.school.findMany({ orderBy: { name: "asc" } }) };
  }
  async create(input: CreateSchoolDto) {
    return this.prisma.school.create({ data: { name: input.name.trim(), shortName: input.shortName.trim(), emailDomain: input.emailDomain?.trim().toLowerCase() || null, address: input.address?.trim() || null } });
  }
  async updateStatus(id: string, input: UpdateSchoolStatusDto) {
    return this.prisma.school.update({ where: { id }, data: { status: input.status } });
  }
}
