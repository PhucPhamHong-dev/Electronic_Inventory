import { Router } from "express";
import { AuditLogController } from "../controllers/auditLogController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const auditRouter = Router();

auditRouter.get("/", asyncHandler(AuditLogController.list));
