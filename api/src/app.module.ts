import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { ProviderModule } from "./modules/provider/provider.module";
import { ProfileModule } from "./modules/profile/profile.module";
import { ServicesModule } from "./modules/services/services.module";
import { SchoolsModule } from "./modules/schools/schools.module";
import { PrismaModule } from "./prisma/prisma.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { MessagesModule } from "./modules/messages/messages.module";
import { DisputesModule } from "./modules/disputes/disputes.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { StorageModule } from "./common/storage/storage.module";
import { SupportModule } from "./modules/support/support.module";
import { RequestRateLimitMiddleware } from "./security/request-rate-limit.middleware";
import { TrafficProtectionModule } from "./security/traffic-protection.module";
import { HttpMetricsMiddleware } from "./monitoring/http-metrics.middleware";
import { MonitoringModule } from "./monitoring/monitoring.module";
import { validateEnvironment } from "./config/environment";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    StorageModule,
    AuthModule,
    SchoolsModule,
    CategoriesModule,
    ServicesModule,
    OrdersModule,
    MessagesModule,
    DisputesModule,
    PaymentsModule,
    NotificationsModule,
    SupportModule,
    ProfileModule,
    ProviderModule,
    AdminModule,
    TrafficProtectionModule,
    MonitoringModule,
  ],
  controllers: [AppController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(HttpMetricsMiddleware, RequestRateLimitMiddleware)
      .forRoutes("*");
  }
}
