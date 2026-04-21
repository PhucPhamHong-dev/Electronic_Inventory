import { Router } from "express";
import multer from "multer";
import { DebtReportController } from "../controllers/debtReportController";
import { MasterDataController } from "../controllers/masterDataController";
import { SystemSettingController } from "../controllers/systemSettingController";
import { UserController } from "../controllers/userController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const masterDataRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

masterDataRouter.get("/warehouses", asyncHandler(MasterDataController.getWarehouses));
masterDataRouter.post("/warehouses", asyncHandler(MasterDataController.createWarehouse));
masterDataRouter.put("/warehouses/:id", asyncHandler(MasterDataController.updateWarehouse));
masterDataRouter.delete("/warehouses/:id", asyncHandler(MasterDataController.deleteWarehouse));
masterDataRouter.get("/warehouses/products", asyncHandler(MasterDataController.getWarehouseProducts));
masterDataRouter.get("/products", asyncHandler(MasterDataController.getProducts));
masterDataRouter.post("/products", asyncHandler(MasterDataController.createProduct));
masterDataRouter.put("/products/:id", asyncHandler(MasterDataController.updateProduct));
masterDataRouter.post("/products/import", upload.single("file"), asyncHandler(MasterDataController.importProducts));
masterDataRouter.post("/products/validate", asyncHandler(MasterDataController.validateProductImport));
masterDataRouter.post("/products/commit", asyncHandler(MasterDataController.commitProductImport));
masterDataRouter.get("/partners", asyncHandler(MasterDataController.getPartners));
masterDataRouter.post("/partners", asyncHandler(MasterDataController.createPartner));
masterDataRouter.put("/partners/:id", asyncHandler(MasterDataController.updatePartner));
masterDataRouter.delete("/partners/:id", asyncHandler(MasterDataController.deletePartner));
masterDataRouter.post("/partners/import", upload.single("file"), asyncHandler(MasterDataController.importPartners));
masterDataRouter.post("/partners/validate", asyncHandler(MasterDataController.validatePartnerImport));
masterDataRouter.post("/partners/commit", asyncHandler(MasterDataController.commitPartnerImport));
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
masterDataRouter.post("/system-settings/accounting-reset", asyncHandler(SystemSettingController.exportAndResetAccountingData));
