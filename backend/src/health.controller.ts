import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { sendSuccess } from "../../BE/src/utils/response";

@Controller()
export class HealthController {
  @Get("health")
  health(@Req() req: Request, @Res() res: Response) {
    const traceId = req.context?.traceId || "health";
    return sendSuccess(
      res as any,
      traceId,
      {
        status: "ok",
        timestamp: new Date().toISOString()
      },
      200
    );
  }
}
