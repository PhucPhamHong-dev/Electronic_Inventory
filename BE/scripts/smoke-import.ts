import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { prisma } from "../src/config/db";
import { ImportService, type ImportDomainValue, type RawImportRecord } from "../src/services/ImportService";

type FieldAliasMap = Record<string, string[]>;

interface TestCaseDefinition {
  name: string;
  domain: ImportDomainValue;
  fieldAliases: FieldAliasMap;
  fileNeedleSets?: string[][];
  syntheticRows?: RawImportRecord[];
}

interface ParseResult {
  headers: string[];
  rows: RawImportRecord[];
  headerRowNumber: number;
}

const DOWNLOADS_DIR = path.resolve("C:/Users/patmy/Downloads");
const SHOULD_COMMIT = process.env.IMPORT_SMOKE_COMMIT !== "0";
const MAX_COMMIT_ROWS = Number(process.env.IMPORT_SMOKE_MAX_COMMIT_ROWS ?? "2");

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildUniqueHeaders(rawHeaders: unknown[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((cell, index) => {
    const base = String(cell ?? "").trim() || `Column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) {
      return base;
    }
    return `${base}_${count + 1}`;
  });
}

function isSummaryRow(cells: unknown[]): boolean {
  const firstText = cells
    .map((cell) => String(cell ?? "").trim())
    .find((cell) => cell.length > 0);
  if (!firstText) {
    return false;
  }
  const normalized = normalizeText(firstText).replace(/\s/g, "");
  return normalized === "tong" || normalized.startsWith("tongcong");
}

function detectHeaderRowByAliases(matrix: unknown[][], aliasSet: Set<string>): number {
  let bestIndex = 0;
  let bestScore = -1;
  const maxRows = Math.min(matrix.length, 40);
  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const nonEmpty = row.map((cell) => String(cell ?? "").trim()).filter((cell) => cell.length > 0);
    if (nonEmpty.length < 2) {
      continue;
    }

    const hits = new Set<string>();
    for (const rawCell of nonEmpty) {
      const cell = normalizeText(rawCell);
      if (!cell) {
        continue;
      }
      for (const alias of aliasSet) {
        if (cell === alias || cell.includes(alias) || alias.includes(cell)) {
          hits.add(alias);
        }
      }
    }

    const score = hits.size * 10 + nonEmpty.length * 0.5 - rowIndex * 0.2;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }
  return bestIndex;
}

function parseWorkbook(filePath: string, aliases: FieldAliasMap): ParseResult {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false
  });

  const aliasSet = new Set<string>(
    Object.entries(aliases).flatMap(([key, values]) => [normalizeText(key), ...values.map((item) => normalizeText(item))])
  );
  const headerRowIndex = detectHeaderRowByAliases(matrix, aliasSet);
  const headers = buildUniqueHeaders(matrix[headerRowIndex] ?? []);

  const rows: RawImportRecord[] = matrix
    .slice(headerRowIndex + 1)
    .filter((cells) => !isSummaryRow(cells))
    .map((cells) => {
      const record: RawImportRecord = {};
      headers.forEach((header, columnIndex) => {
        const value = cells[columnIndex];
        if (value === null || value === undefined || value === "") {
          record[header] = null;
        } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          record[header] = value;
        } else {
          record[header] = String(value);
        }
      });
      return record;
    })
    .filter((record) => Object.values(record).some((value) => value !== null && String(value).trim() !== ""));

  return {
    headers,
    rows,
    headerRowNumber: headerRowIndex + 1
  };
}

function buildMapping(headers: string[], aliases: FieldAliasMap): Record<string, string> {
  const usedHeaders = new Set<string>();
  const mapping: Record<string, string> = {};

  for (const [fieldKey, aliasList] of Object.entries(aliases)) {
    let bestHeader = "";
    let bestScore = -1;
    const normalizedKey = normalizeText(fieldKey);
    const normalizedAliases = [normalizedKey, ...aliasList.map((item) => normalizeText(item))];

    for (const header of headers) {
      if (usedHeaders.has(header)) {
        continue;
      }
      const normalizedHeader = normalizeText(header);
      if (!normalizedHeader) {
        continue;
      }

      let score = 0;
      for (const alias of normalizedAliases) {
        if (!alias) {
          continue;
        }
        if (normalizedHeader === alias) {
          score = Math.max(score, 100);
        } else if (normalizedHeader.includes(alias)) {
          score = Math.max(score, 80);
        } else if (alias.includes(normalizedHeader)) {
          score = Math.max(score, 60);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestHeader = header;
      }
    }

    if (bestHeader && bestScore > 0) {
      mapping[fieldKey] = bestHeader;
      usedHeaders.add(bestHeader);
    }
  }

  return mapping;
}

function findFileByNeedleSets(needleSets: string[][]): string | null {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    return null;
  }
  const files = fs
    .readdirSync(DOWNLOADS_DIR)
    .filter((name) => name.toLowerCase().endsWith(".xlsx") && !name.startsWith("~$"));

  for (const needles of needleSets) {
    const normalizedNeedles = needles.map((item) => normalizeText(item));
    const match = files.find((fileName) => {
      const normalizedFileName = normalizeText(fileName);
      return normalizedNeedles.every((needle) => normalizedFileName.includes(needle));
    });
    if (match) {
      return path.join(DOWNLOADS_DIR, match);
    }
  }
  return null;
}

const TEST_CASES: TestCaseDefinition[] = [
  {
    name: "Hàng hóa",
    domain: "PRODUCTS",
    fileNeedleSets: [["file", "hang hoa", "sample"], ["file", "hang hoa"]],
    fieldAliases: {
      skuCode: ["ma hang", "ma san pham", "sku"],
      name: ["ten hang", "ten san pham"],
      unitName: ["dvt", "don vi tinh", "don vi"],
      warehouseName: ["kho", "ma kho"],
      sellingPrice: ["gia ban", "don gia"]
    }
  },
  {
    name: "Khách hàng",
    domain: "PARTNERS_CUSTOMER",
    fileNeedleSets: [["danh sach", "khach hang"]],
    fieldAliases: {
      code: ["ma khach hang", "ma doi tac"],
      name: ["ten khach hang", "ten doi tac", "ten cong ty"],
      phone: ["dien thoai", "so dien thoai", "phone"],
      taxCode: ["ma so thue", "mst"],
      address: ["dia chi"]
    }
  },
  {
    name: "Nhà cung cấp",
    domain: "PARTNERS_SUPPLIER",
    fileNeedleSets: [["danh sach", "nha cung cap"]],
    fieldAliases: {
      code: ["ma nha cung cap", "ma doi tac"],
      name: ["ten nha cung cap", "ten doi tac", "ten cong ty"],
      phone: ["dien thoai", "so dien thoai", "phone"],
      taxCode: ["ma so thue", "mst"],
      address: ["dia chi"]
    }
  },
  {
    name: "Danh sách nợ nhà cung cấp",
    domain: "SUPPLIER_DEBT_LIST",
    fileNeedleSets: [["dsach", "no", "nha cung cap"], ["cong no", "ncc"]],
    fieldAliases: {
      code: ["ma nha cung cap", "ma doi tac"],
      name: ["ten nha cung cap", "ten doi tac"],
      address: ["dia chi"],
      debtAmount: ["so tien no", "cong no"],
      taxCode: ["ma so thue", "cccd"],
      phone: ["dien thoai", "so dien thoai"]
    }
  },
  {
    name: "Danh sách nợ khách hàng (synthetic)",
    domain: "CUSTOMER_DEBT_LIST",
    fieldAliases: {
      code: ["ma khach hang", "ma doi tuong"],
      name: ["ten khach hang", "ten doi tuong"],
      address: ["dia chi"],
      debtAmount: ["so tien no", "cong no"],
      taxCode: ["ma so thue", "cccd"],
      phone: ["dien thoai", "so dien thoai"]
    },
    syntheticRows: [
      {
        "Mã khách hàng": "SMOKE-KH-001",
        "Tên khách hàng": "Khách hàng smoke import",
        "Địa chỉ": "Hà Nội",
        "Số tiền nợ": "1500000",
        "Mã số thuế/CCCD chủ hộ": "",
        "Điện thoại": "0900000001"
      }
    ]
  },
  {
    name: "Thu chi tiền mặt",
    domain: "CASH_VOUCHERS",
    fileNeedleSets: [["thu chi", "tien mat"]],
    fieldAliases: {
      voucherDate: ["ngay hach toan", "ngay chung tu", "ngay"],
      voucherNo: ["so chung tu", "so phieu"],
      voucherType: ["loai chung tu", "loai phieu", "thu chi"],
      note: ["dien giai", "ly do"],
      partnerCode: ["ma doi tuong", "ma khach hang", "ma nha cung cap"],
      partnerName: ["doi tuong", "ten doi tuong", "ten khach hang", "ten nha cung cap"],
      paymentReason: ["ly do thu chi", "ly do nop", "ly do chi"],
      paymentMethod: ["phuong thuc", "phuong thuc thanh toan"],
      amount: ["so tien", "thanh tien"]
    }
  },
  {
    name: "Thu chi tiền gửi",
    domain: "CASH_VOUCHERS",
    fileNeedleSets: [["thu chi", "tien gui"]],
    fieldAliases: {
      voucherDate: ["ngay hach toan", "ngay chung tu", "ngay"],
      voucherNo: ["so chung tu", "so phieu"],
      voucherType: ["loai chung tu", "loai phieu", "thu chi"],
      note: ["dien giai", "ly do"],
      partnerCode: ["ma doi tuong", "ma khach hang", "ma nha cung cap"],
      partnerName: ["doi tuong", "ten doi tuong", "ten khach hang", "ten nha cung cap"],
      paymentReason: ["ly do thu chi", "ly do nop", "ly do chi"],
      paymentMethod: ["phuong thuc", "phuong thuc thanh toan"],
      amount: ["so tien", "thanh tien"]
    }
  },
  {
    name: "Chi tiết bán hàng",
    domain: "SALES_DETAILS",
    fileNeedleSets: [["chi tiet", "ban hang"]],
    fieldAliases: {
      voucherDate: ["ngay chung tu", "ngay hach toan"],
      voucherNo: ["so chung tu", "so phieu"],
      partnerCode: ["ma khach hang", "ma doi tuong"],
      partnerName: ["ten khach hang", "ten doi tuong"],
      note: ["dien giai", "ghi chu"],
      skuCode: ["ma hang", "ma san pham"],
      productName: ["ten hang", "ten san pham"],
      unitName: ["dvt", "don vi tinh"],
      quantity: ["so luong ban", "so luong"],
      unitPrice: ["don gia", "gia ban"],
      discountRate: ["chiet khau", "ck"],
      taxRate: ["thue gtgt", "vat"],
      lineAmount: ["tong thanh toan", "thanh tien"],
      totalAmount: ["tong tien hang", "doanh so ban"],
      totalDiscount: ["tien chiet khau"],
      taxAmount: ["tien thue gtgt", "tien thue"],
      totalNetAmount: ["tong tien thanh toan", "tong thanh toan"],
      paymentStatus: ["tt thanh toan", "trang thai thanh toan"]
    }
  },
  {
    name: "Chi tiết mua hàng",
    domain: "PURCHASE_DETAILS",
    fileNeedleSets: [["chi tiet mua hang"], ["mua hang hoa dich vu"]],
    fieldAliases: {
      voucherDate: ["ngay chung tu", "ngay hach toan"],
      voucherNo: ["so chung tu", "so phieu"],
      partnerCode: ["ma nha cung cap", "ma doi tuong"],
      partnerName: ["ten nha cung cap", "nha cung cap", "ten doi tuong"],
      note: ["dien giai", "ghi chu"],
      skuCode: ["ma hang", "ma san pham"],
      productName: ["ten hang", "ten san pham"],
      unitName: ["dvt", "don vi tinh"],
      quantity: ["so luong mua", "so luong"],
      unitPrice: ["don gia", "gia mua"],
      discountRate: ["chiet khau", "ck"],
      taxRate: ["thue gtgt", "vat"],
      lineAmount: ["tong thanh toan", "thanh tien"],
      totalAmount: ["tong tien hang", "doanh so ban"],
      totalDiscount: ["tien chiet khau"],
      taxAmount: ["tien thue gtgt", "tien thue"],
      totalNetAmount: ["tong tien thanh toan", "tong thanh toan"],
      paymentStatus: ["tt thanh toan", "trang thai thanh toan"]
    }
  },
  {
    name: "Tồn kho vật tư hàng hóa",
    domain: "MATERIAL_INVENTORY",
    fileNeedleSets: [["vat tu", "hang hoa"], ["so chi tiet vat tu"]],
    fieldAliases: {
      warehouseName: ["kho", "ma kho"],
      skuCode: ["ma hang"],
      productName: ["ten hang"],
      unitName: ["dvt", "don vi tinh"],
      quantityAfter: ["so luong ton", "ton so luong", "ton"],
      valueAfter: ["gia tri ton", "ton gia tri"],
      unitCost: ["don gia", "gia tri"]
    }
  },
  {
    name: "Doanh thu bán",
    domain: "SALES_REVENUE",
    fileNeedleSets: [["danh sach", "ban hang"]],
    fieldAliases: {
      voucherDate: ["ngay hach toan", "ngay chung tu"],
      voucherNo: ["so chung tu", "so phieu"],
      partnerCode: ["ma khach hang", "ma doi tuong"],
      partnerName: ["ten khach hang", "doi tuong"],
      note: ["dien giai", "ghi chu"],
      totalAmount: ["tong tien hang", "doanh so ban"],
      totalDiscount: ["tien chiet khau"],
      taxAmount: ["tien thue gtgt", "thue gtgt"],
      totalNetAmount: ["tong tien thanh toan", "tong thanh toan", "so tien"],
      paymentStatus: ["tt thanh toan", "trang thai thanh toan"]
    }
  },
  {
    name: "Danh sách nhập hàng",
    domain: "PURCHASE_LIST",
    fileNeedleSets: [["mua hang hoa dich vu"]],
    fieldAliases: {
      voucherDate: ["ngay hach toan", "ngay chung tu"],
      voucherNo: ["so chung tu", "so phieu"],
      partnerCode: ["ma nha cung cap", "ma doi tuong"],
      partnerName: ["ten nha cung cap", "nha cung cap", "ten doi tuong"],
      note: ["dien giai", "ghi chu"],
      totalAmount: ["tong tien hang", "doanh so ban"],
      totalDiscount: ["tien chiet khau"],
      taxAmount: ["tien thue gtgt", "thue gtgt"],
      totalNetAmount: ["tong tien thanh toan", "tong thanh toan", "so tien"],
      paymentStatus: ["tt thanh toan", "trang thai thanh toan"]
    }
  }
];

async function run(): Promise<void> {
  const service = new ImportService(prisma);
  const results: Array<Record<string, unknown>> = [];

  for (const testCase of TEST_CASES) {
    const record: Record<string, unknown> = {
      case: testCase.name,
      domain: testCase.domain
    };
    try {
      let headers: string[] = [];
      let rows: RawImportRecord[] = [];
      let headerRowNumber = 1;
      let filePath = "(synthetic)";

      if (testCase.syntheticRows) {
        rows = testCase.syntheticRows;
        headers = Object.keys(rows[0] ?? {});
      } else {
        const foundPath = testCase.fileNeedleSets ? findFileByNeedleSets(testCase.fileNeedleSets) : null;
        if (!foundPath) {
          throw new Error("Không tìm thấy file test trong Downloads");
        }
        filePath = foundPath;
        const parsed = parseWorkbook(foundPath, testCase.fieldAliases);
        headers = parsed.headers;
        rows = parsed.rows;
        headerRowNumber = parsed.headerRowNumber;
      }

      const mapping = buildMapping(headers, testCase.fieldAliases);
      const validateResult = await service.validate({
        domain: testCase.domain,
        jsonData: rows,
        mappingObject: mapping,
        importMode: "UPSERT"
      });

      const validRows = validateResult.rows.filter((row) => row.status === "valid");
      const invalidRows = validateResult.rows.filter((row) => row.status === "invalid");
      let commitResult: { processed: number; inserted: number; updated: number } | null = null;

      if (SHOULD_COMMIT && validRows.length > 0) {
        commitResult = await service.commit({
          domain: testCase.domain,
          importMode: "UPSERT",
          rows: validRows.slice(0, Math.max(1, MAX_COMMIT_ROWS))
        });
      }

      record.file = filePath;
      record.headerRowNumber = headerRowNumber;
      record.detectedRows = rows.length;
      record.mappingKeys = Object.keys(mapping).length;
      record.valid = validRows.length;
      record.invalid = invalidRows.length;
      record.sampleErrors = invalidRows.slice(0, 3).map((row) => row.errorNote);
      record.commit = commitResult ?? "SKIPPED";
      record.status = "PASS";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.status = "FAIL";
      record.error = message;
    }
    results.push(record);
  }

  console.table(
    results.map((item) => ({
      case: item.case,
      domain: item.domain,
      status: item.status,
      file: item.file,
      headerRow: item.headerRowNumber,
      rows: item.detectedRows,
      valid: item.valid,
      invalid: item.invalid
    }))
  );

  const failed = results.filter((item) => item.status === "FAIL");
  if (failed.length > 0) {
    console.log("\n--- FAILED DETAILS ---");
    for (const item of failed) {
      console.log(`${item.case}: ${item.error}`);
    }
    process.exitCode = 1;
  } else {
    console.log("\nAll import smoke test cases passed.");
  }

  const withInvalidRows = results.filter((item) => Number(item.invalid ?? 0) > 0);
  if (withInvalidRows.length > 0) {
    console.log("\n--- CASES WITH INVALID ROWS (validation) ---");
    for (const item of withInvalidRows) {
      console.log(`${item.case}: invalid=${item.invalid} | sample=${JSON.stringify(item.sampleErrors)}`);
    }
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
