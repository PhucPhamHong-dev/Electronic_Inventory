import { Router } from "express";
import { VoucherController } from "../controllers/voucherController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const voucherRouter = Router();

voucherRouter.get("/", asyncHandler(VoucherController.listVouchers));
voucherRouter.post("/purchase", asyncHandler(VoucherController.createPurchase));
voucherRouter.post("/sales", asyncHandler(VoucherController.createSales));
voucherRouter.post("/conversion", asyncHandler(VoucherController.createConversion));
voucherRouter.post("/receipt", asyncHandler(VoucherController.createReceipt));
voucherRouter.put("/:id", asyncHandler(VoucherController.updateVoucher));
voucherRouter.post("/:id/book", asyncHandler(VoucherController.bookVoucher));
voucherRouter.post("/:id/pay", asyncHandler(VoucherController.payVoucher));
voucherRouter.get("/:id/pdf", asyncHandler(VoucherController.exportVoucherPdf));
