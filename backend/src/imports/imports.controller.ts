import { Body, Controller, Get, Inject, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import type { Request, Response } from "express";
import { AppError } from "../../../BE/src/utils/errors";
import { importDomainValues } from "../../../BE/src/services/ImportService";
import { sendLegacySuccess } from "../shared/response";
import { assertTraceId } from "../shared/request-utils";
import { ImportsServiceAdapter } from "./imports.service";

const importDomainSchema = z.enum(importDomainValues);
const importModeSchema = z.enum(["CREATE_ONLY", "UPDATE_ONLY", "UPSERT"]);
const rawCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rawRecordSchema = z.record(z.string(), rawCellSchema);

const analyzeSchema = z.object({
  domain: importDomainSchema,
  sheetName: z.string().trim().min(1).optional()
});

const validateSchema = z.object({
  domain: importDomainSchema,
  jsonData: z.array(rawRecordSchema).min(1),
  mappingObject: z.record(z.string(), z.string()).default({}),
  importMode: importModeSchema.default("UPSERT")
});

const commitSchema = z.object({
  domain: importDomainSchema,
  rows: z.array(
    z.object({
      rowNumber: z.number().int().positive(),
      status: z.enum(["valid", "invalid"]),
      errorNote: z.string().default(""),
      mappedData: rawRecordSchema
    })
  ).min(1),
  importMode: importModeSchema.default("UPSERT")
});

const templateSchema = z.object({
  domain: importDomainSchema
});

@Controller("imports")
export class ImportsController {
  constructor(@Inject(ImportsServiceAdapter) private readonly importsService: ImportsServiceAdapter) {}

  @Post("analyze")
  @UseInterceptors(FileInterceptor("file"))
  async analyze(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const traceId = assertTraceId(req);
    if (!file) {
      throw new AppError("Vui lòng upload file Excel", 400, "VALIDATION_ERROR");
    }
    const payload = analyzeSchema.parse(body);
    const data = await this.importsService.analyze({
      domain: payload.domain,
      fileBuffer: file.buffer,
      sheetName: payload.sheetName
    });
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("validate")
  async validate(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = validateSchema.parse(body);
    const data = await this.importsService.validate(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Post("commit")
  async commit(@Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    const traceId = assertTraceId(req);
    const payload = commitSchema.parse(body);
    const data = await this.importsService.commit(payload);
    return sendLegacySuccess(res, traceId, data);
  }

  @Get("template")
  async template(@Query() query: unknown, @Req() req: Request, @Res() res: Response) {
    assertTraceId(req);
    const payload = templateSchema.parse(query);
    const result = await this.importsService.buildTemplate(payload.domain);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    return res.status(200).send(result.buffer);
  }
}
