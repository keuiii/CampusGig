import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProviderModule } from "./modules/provider/provider.module";
import { ServicesModule } from "./modules/services/services.module";
import { SchoolsModule } from "./modules/schools/schools.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AuthModule, SchoolsModule, CategoriesModule, ServicesModule, OrdersModule, ProviderModule, AdminModule],
  controllers: [AppController],
})
export class AppModule {}
