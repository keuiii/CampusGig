import { Controller, Get, Header } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CategoriesService } from "./categories.service";

@ApiTags("categories")
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}
  @Get()
  @Header("Cache-Control", "no-store")
  findAll() {
    return this.categories.findAll();
  }
}
