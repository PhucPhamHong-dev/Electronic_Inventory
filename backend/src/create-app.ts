import cors from "cors";
import helmet from "helmet";
import express, { type NextFunction, type Request, type Response } from "express";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { GlobalExceptionFilter } from "./shared/global-exception.filter";
import { nestRequestLoggerMiddleware } from "./shared/nest-request-logger.middleware";
import { requestContextMiddleware } from "../../BE/src/api/middlewares/requestContext";
import { authMiddleware } from "../../BE/src/api/middlewares/authMiddleware";

export async function createApp() {
  const nestLogger = new ConsoleLogger("Nest", {
    timestamp: true
  });
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    logger: nestLogger
  });

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(requestContextMiddleware);
  app.use(nestRequestLoggerMiddleware);
  app.use("/api/v1", (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/auth")) {
      next();
      return;
    }
    authMiddleware(req as any, res as any, next as any);
  });

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.setGlobalPrefix("api/v1", {
    exclude: ["health"]
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("WMS Backend API")
    .setDescription("NestJS migration backend for WMS")
    .setVersion("1.0.0")
    .addBearerAuth()
    .build();
  const fallbackSwaggerDocument: OpenAPIObject = {
    openapi: "3.0.0",
    info: {
      title: "WMS Backend API",
      description: "NestJS migration backend for WMS",
      version: "1.0.0"
    },
    paths: {},
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      }
    }
  };

  const swaggerDocument: OpenAPIObject = (() => {
    try {
      return SwaggerModule.createDocument(app, swaggerConfig);
    } catch {
      return fallbackSwaggerDocument;
    }
  })();
  SwaggerModule.setup("api/docs", app, swaggerDocument);

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.get("/api/openapi.json", (_req: Request, res: Response) => {
    res.status(200).json(swaggerDocument);
  });

  return app;
}
