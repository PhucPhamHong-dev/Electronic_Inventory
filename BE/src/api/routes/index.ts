import { Router } from "express";
import { auditRouter } from "./auditRoutes";
import { masterDataRouter } from "./masterDataRoutes";
import { voucherRouter } from "./voucherRoutes";

export const apiRouter = Router();

apiRouter.use("/vouchers", voucherRouter);
apiRouter.use("/audit-logs", auditRouter);
apiRouter.use("/", masterDataRouter);
