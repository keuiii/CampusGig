import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000", credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));

  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle("CampusGig API")
    .setDescription("Phase 1 API for the CampusGig student services marketplace")
    .setVersion("1.0")
    .addBearerAuth()
    .build());
  SwaggerModule.setup("docs", app, document);

  await app.listen(Number(process.env.PORT ?? 4000));
}

void bootstrap();
