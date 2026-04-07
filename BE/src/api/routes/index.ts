import { Router } from "express";
import { VoucherController } from "../controllers/voucherController";
import { auditRouter } from "./auditRoutes";
import { debtRouter } from "./debtRoutes";
import { masterDataRouter } from "./masterDataRoutes";
import { quotationRouter } from "./quotationRoutes";
import { voucherRouter } from "./voucherRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export const apiRouter = Router();

apiRouter.use("/vouchers", voucherRouter);
apiRouter.post("/cash-vouchers", asyncHandler(VoucherController.createCashVoucher));
apiRouter.use("/debt", debtRouter);
apiRouter.use("/quotations", quotationRouter);
apiRouter.use("/audit-logs", auditRouter);
apiRouter.use("/", masterDataRouter);
