import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { AuthService } from "../../services/AuthService";
import { AppError } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

const authService = new AuthService();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.context) {
        throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
      }

      const payload = loginSchema.parse(req.body);
      const result = await authService.login(payload.username, payload.password);
      sendSuccess(res, req.context.traceId, result);
    } catch (error) {
      next(error);
    }
  }
}
