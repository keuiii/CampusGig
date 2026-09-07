import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}
  async findAll() {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        _count: {
          select: {
            services: {
              where: {
                status: "PUBLISHED",
                provider: {
                  studentProfile: { school: { status: "ACTIVE" } },
                },
              },
            },
          },
        },
      },
    });
    return {
      data: categories.map(({ _count, ...category }) => ({
        ...category,
        serviceCount: _count.services,
      })),
    };
  }
}
