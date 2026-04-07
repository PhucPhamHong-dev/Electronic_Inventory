import { Router } from "express";
import { DebtController } from "../controllers/debtController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const debtRouter = Router();

debtRouter.get("/summary", asyncHandler(DebtController.getSummary));
debtRouter.get("/collections", asyncHandler(DebtController.listCollections));
debtRouter.post("/collection", asyncHandler(DebtController.createCollection));
debtRouter.patch("/collection/:id/result", asyncHandler(DebtController.updateCollectionResult));
debtRouter.patch("/collection/:id/customers", asyncHandler(DebtController.addCustomers));
debtRouter.delete("/collection/:id/customers/:detailId", asyncHandler(DebtController.removeCustomer));
