import { Router } from "express";
import { QuotationController } from "../controllers/quotationController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const quotationRouter = Router();

quotationRouter.get("/", asyncHandler(QuotationController.list));
quotationRouter.post("/", asyncHandler(QuotationController.create));
quotationRouter.post("/:id/convert-to-sales", asyncHandler(QuotationController.convertToSales));
quotationRouter.get("/:id", asyncHandler(QuotationController.getById));
quotationRouter.put("/:id", asyncHandler(QuotationController.update));
quotationRouter.delete("/:id", asyncHandler(QuotationController.delete));
