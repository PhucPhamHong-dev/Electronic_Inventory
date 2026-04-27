import { Body, Controller, Inject, Post, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { AuthServiceAdapter } from "./auth.service";
import { assertTraceId } from "../shared/request-utils";
import { sendLegacySuccess } from "../shared/response";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthServiceAdapter) private readonly authService: AuthServiceAdapter) {}

  @Post("login")
  async login(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = loginSchema.parse(body);
    const result = await this.authService.login(payload.username, payload.password);
    return sendLegacySuccess(res, traceId, result);
  }
}
