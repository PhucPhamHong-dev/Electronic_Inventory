import { Router } from "express";
import multer from "multer";
import { ImportController } from "../controllers/importController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

importRouter.post("/analyze", upload.single("file"), asyncHandler(ImportController.analyze));
importRouter.post("/validate", asyncHandler(ImportController.validate));
importRouter.post("/commit", asyncHandler(ImportController.commit));
importRouter.get("/template", asyncHandler(ImportController.downloadTemplate));
