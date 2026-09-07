import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  { id: "graphic-design", name: "Graphic Design", icon: "▧", color: "coral", sortOrder: 1 },
  { id: "tutoring", name: "Tutoring", icon: "A+", color: "violet", sortOrder: 2 },
  { id: "programming", name: "Programming", icon: "</>", color: "blue", sortOrder: 3 },
  { id: "photography", name: "Photography", icon: "◉", color: "amber", sortOrder: 4 },
  { id: "video-editing", name: "Video Editing", icon: "▶", color: "mint", sortOrder: 5 },
  { id: "writing", name: "Writing", icon: "Aa", color: "pink", sortOrder: 6 },
];

async function main() {
  for (const category of categories) {
    await prisma.category.upsert({ where: { id: category.id }, update: category, create: category });
  }
}

main().finally(() => prisma.$disconnect());
