import { Router } from "express";
import { ReportController } from "../controllers/reportController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const reportRouter = Router();

reportRouter.post("/query", asyncHandler(ReportController.query));
reportRouter.post("/debt-notice/excel", asyncHandler(ReportController.exportDebtNoticeExcel));
reportRouter.get("/templates", asyncHandler(ReportController.listTemplates));
reportRouter.post("/templates", asyncHandler(ReportController.saveTemplate));
reportRouter.get("/filters", asyncHandler(ReportController.listFilters));
reportRouter.post("/filters", asyncHandler(ReportController.saveFilter));
