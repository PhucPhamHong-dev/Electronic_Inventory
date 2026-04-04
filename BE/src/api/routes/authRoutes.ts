import { Router } from "express";
import { AuthController } from "../controllers/authController";
import { asyncHandler } from "../middlewares/asyncHandler";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(AuthController.login));
