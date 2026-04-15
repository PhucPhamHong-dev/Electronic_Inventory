import { Router } from "express";
import { VoucherController } from "../controllers/voucherController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const voucherRouter = Router();

voucherRouter.get("/", asyncHandler(VoucherController.listVouchers));
voucherRouter.get("/unpaid", asyncHandler(VoucherController.listUnpaidInvoices));
voucherRouter.get("/last-price", asyncHandler(VoucherController.getLastSalesPrice));
voucherRouter.get("/:id", asyncHandler(VoucherController.getVoucherById));
voucherRouter.post("/purchase", asyncHandler(VoucherController.createPurchase));
voucherRouter.post("/sales", asyncHandler(VoucherController.createSales));
voucherRouter.post("/sales-return", asyncHandler(VoucherController.createSalesReturn));
voucherRouter.post("/conversion", asyncHandler(VoucherController.createConversion));
voucherRouter.post("/receipt", asyncHandler(VoucherController.createReceipt));
voucherRouter.put("/:id", asyncHandler(VoucherController.updateVoucher));
voucherRouter.post("/:id/book", asyncHandler(VoucherController.bookVoucher));
voucherRouter.post("/:id/pay", asyncHandler(VoucherController.payVoucher));
voucherRouter.post("/:id/unpost", asyncHandler(VoucherController.unpostVoucher));
voucherRouter.post("/:id/duplicate", asyncHandler(VoucherController.duplicateVoucher));
voucherRouter.delete("/:id", asyncHandler(VoucherController.deleteVoucher));
voucherRouter.get("/:id/pdf", asyncHandler(VoucherController.exportVoucherPdf));
