import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { ImportService, importDomainValues } from "../../services/ImportService";
import { AppError } from "../../utils/errors";
import { sendSuccess } from "../../utils/response";

const importService = new ImportService();
const importDomainSchema = z.enum(importDomainValues);
const importModeSchema = z.enum(["CREATE_ONLY", "UPDATE_ONLY", "UPSERT"]);
const rawCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const rawRecordSchema = z.record(rawCellSchema);

const analyzeSchema = z.object({
  domain: importDomainSchema,
  sheetName: z.string().trim().min(1).optional()
});

const validateSchema = z.object({
  domain: importDomainSchema,
  jsonData: z.array(rawRecordSchema).min(1),
  mappingObject: z.record(z.string()).default({}),
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

function assertContext(req: Request): string {
  if (!req.context) {
    throw new AppError("Missing request context", 500, "INTERNAL_ERROR");
  }
  return req.context.traceId;
}

export class ImportController {
  static async analyze(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const uploaded = (req as Request & { file?: Express.Multer.File }).file;
      if (!uploaded) {
        throw new AppError("Vui lòng upload file Excel", 400, "VALIDATION_ERROR");
      }

      const payload = analyzeSchema.parse(req.body);
      const data = await importService.analyze({
        domain: payload.domain,
        fileBuffer: uploaded.buffer,
        sheetName: payload.sheetName
      });

      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async validate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = validateSchema.parse(req.body);
      const data = await importService.validate(payload);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async commit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const traceId = assertContext(req);
      const payload = commitSchema.parse(req.body);
      const data = await importService.commit(payload);
      sendSuccess(res, traceId, data);
    } catch (error) {
      next(error);
    }
  }

  static async downloadTemplate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      assertContext(req);
      const query = templateSchema.parse(req.query);
      const result = await importService.buildTemplate(query.domain);

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      res.status(200).send(result.buffer);
    } catch (error) {
      next(error);
    }
  }
}
