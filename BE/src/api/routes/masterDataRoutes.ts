import { Router } from "express";
import { DebtReportController } from "../controllers/debtReportController";
import { MasterDataController } from "../controllers/masterDataController";
import { SystemSettingController } from "../controllers/systemSettingController";
import { UserController } from "../controllers/userController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const masterDataRouter = Router();

masterDataRouter.get("/products", asyncHandler(MasterDataController.getProducts));
masterDataRouter.post("/products", asyncHandler(MasterDataController.createProduct));
masterDataRouter.get("/partners", asyncHandler(MasterDataController.getPartners));
masterDataRouter.post("/partners", asyncHandler(MasterDataController.createPartner));
masterDataRouter.put("/partners/:id", asyncHandler(MasterDataController.updatePartner));
masterDataRouter.delete("/partners/:id", asyncHandler(MasterDataController.deletePartner));
masterDataRouter.get("/partners/:partnerId/debt-pdf", asyncHandler(DebtReportController.exportPartnerDebtPdf));
masterDataRouter.get("/ar-ledger", asyncHandler(MasterDataController.getArLedger));
masterDataRouter.get("/reports/stock-card", asyncHandler(MasterDataController.getStockCard));
masterDataRouter.get("/reports/stock-card/excel", asyncHandler(MasterDataController.exportStockCardExcel));

masterDataRouter.get("/users", asyncHandler(UserController.list));
masterDataRouter.post("/users", asyncHandler(UserController.create));
masterDataRouter.put("/users/:id", asyncHandler(UserController.update));
masterDataRouter.delete("/users/:id", asyncHandler(UserController.delete));
masterDataRouter.patch("/users/:id/reset-password", asyncHandler(UserController.resetPassword));

masterDataRouter.get("/system-settings", asyncHandler(SystemSettingController.getCompanySettings));
masterDataRouter.put("/system-settings", asyncHandler(SystemSettingController.updateCompanySettings));
