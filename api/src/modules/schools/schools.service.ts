import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

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
}
