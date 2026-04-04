import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { apiRouter } from "./api/routes";
import { authRouter } from "./api/routes/authRoutes";
import { authMiddleware } from "./api/middlewares/authMiddleware";
import { errorHandler } from "./api/middlewares/errorHandler";
import { requestContextMiddleware } from "./api/middlewares/requestContext";
import { requestPerformanceInterceptor } from "./common/interceptors/request-performance.interceptor";
import { swaggerSpec } from "./config/swagger";
import { AppError } from "./utils/errors";
import { sendSuccess } from "./utils/response";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(requestContextMiddleware);
app.use(requestPerformanceInterceptor);

app.get("/health", (req, res) => {
  const traceId = req.context?.traceId || "health";
  sendSuccess(
    res,
    traceId,
    {
      status: "ok",
      timestamp: new Date().toISOString()
    },
    200
  );
});

app.get("/api/openapi.json", (_req, res) => {
  res.status(200).json(swaggerSpec);
});
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use("/api/v1/auth", authRouter);
app.use("/api/v1", authMiddleware, apiRouter);

app.use((_req, _res, next) => {
  next(new AppError("Route not found", 404, "NOT_FOUND"));
});

app.use(errorHandler);
