import XLSX from "xlsx";

const legacyBaseUrl = process.env.LEGACY_BASE_URL ?? "http://localhost:3000";
const nestBaseUrl = process.env.NEST_BASE_URL ?? "http://localhost:3001";
const authToken = process.env.AUTH_TOKEN;

if (!authToken) {
  console.error("Missing AUTH_TOKEN");
  process.exit(1);
}

type HttpMethod = "GET" | "POST";
type BinaryKind = "binary-xlsx" | "binary-pdf";

type JsonCase = {
  name: string;
  kind: "json";
  method: HttpMethod;
  path: string;
  body?: unknown;
};

type BinaryCase = {
  name: string;
  kind: BinaryKind;
  method: HttpMethod;
  path: string;
  body?: unknown;
};

type CompareCase = JsonCase | BinaryCase;

type JsonResponse = {
  status: number;
  headers: {
    contentType: string | null;
    contentDisposition: string | null;
  };
  body: unknown;
};

type BinaryResponse = {
  status: number;
  headers: {
    contentType: string | null;
    contentDisposition: string | null;
  };
  size: number;
  signature: string;
  buffer: Buffer;
};

type DiscoveryContext = {
  productId?: string;
  partnerId?: string;
  quotationId?: string;
  voucherId?: string;
  salesVoucherId?: string;
  salesVoucherPartnerId?: string;
};

const importDomains = [
  "PRODUCTS",
  "PARTNERS_CUSTOMER",
  "PARTNERS_SUPPLIER",
  "SUPPLIER_DEBT_LIST",
  "CUSTOMER_DEBT_LIST",
  "CASH_VOUCHERS",
  "SALES_DETAILS",
  "PURCHASE_DETAILS",
  "MATERIAL_INVENTORY",
  "SALES_REVENUE",
  "PURCHASE_LIST"
] as const;

function buildHeaders(includeJsonContentType: boolean) {
  return {
    Authorization: `Bearer ${authToken}`,
    ...(includeJsonContentType ? { "Content-Type": "application/json" } : {})
  };
}

async function requestJson(baseUrl: string, testCase: JsonCase): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${testCase.path}`, {
    method: testCase.method,
    headers: buildHeaders(true),
    body: testCase.body ? JSON.stringify(testCase.body) : undefined
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}

  return {
    status: response.status,
    headers: {
      contentType: response.headers.get("content-type"),
      contentDisposition: response.headers.get("content-disposition")
    },
    body
  };
}

async function requestBinary(baseUrl: string, testCase: BinaryCase): Promise<BinaryResponse> {
  const response = await fetch(`${baseUrl}${testCase.path}`, {
    method: testCase.method,
    headers: buildHeaders(Boolean(testCase.body)),
    body: testCase.body ? JSON.stringify(testCase.body) : undefined
  });

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    status: response.status,
    headers: {
      contentType: response.headers.get("content-type"),
      contentDisposition: response.headers.get("content-disposition")
    },
    size: buffer.length,
    signature: buffer.subarray(0, 16).toString("hex"),
    buffer
  };
}

function stable(value: unknown) {
  return JSON.stringify(value);
}

function normalizeJsonPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonPayload);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "traceId" && key !== "generatedAt")
      .map(([key, nestedValue]) => [key, normalizeJsonPayload(nestedValue)]);
    return Object.fromEntries(entries);
  }

  return value;
}

function unwrapData<T = unknown>(value: unknown): T | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const body = value as Record<string, unknown>;
  if ("data" in body) {
    return body.data as T;
  }

  return value as T;
}

function pickFirstIdFromListPayload(value: unknown): string | undefined {
  const data = unwrapData<Record<string, unknown>>(value);
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const first = items[0];
  if (!first || typeof first !== "object") {
    return undefined;
  }
  return typeof (first as Record<string, unknown>).id === "string"
    ? ((first as Record<string, unknown>).id as string)
    : undefined;
}

function pickFirstItemFromListPayload(value: unknown): Record<string, unknown> | undefined {
  const data = unwrapData<Record<string, unknown>>(value);
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  const first = items[0];
  return first && typeof first === "object" ? (first as Record<string, unknown>) : undefined;
}

function summarizeWorkbook(buffer: Buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  return {
    sheetNames: workbook.SheetNames,
    sheets: workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
        header: 1,
        raw: false,
        defval: ""
      });
      return {
        name: sheetName,
        rowCount: rows.length,
        firstRows: rows.slice(0, 5)
      };
    })
  };
}

function summarizePdf(buffer: Buffer) {
  const asciiSnippet = buffer.subarray(0, 256).toString("latin1");
  return {
    startsWithPdf: buffer.subarray(0, 4).toString("latin1") === "%PDF",
    size: buffer.length,
    signature: buffer.subarray(0, 16).toString("hex"),
    snippet: asciiSnippet.replace(/[^\x20-\x7e]/g, "")
  };
}

function compareBinaryPdf(legacy: BinaryResponse, nest: BinaryResponse) {
  const legacyPdf = summarizePdf(legacy.buffer);
  const nestPdf = summarizePdf(nest.buffer);
  return {
    same:
      legacy.status === nest.status &&
      stable(legacy.headers) === stable(nest.headers) &&
      legacyPdf.startsWithPdf === nestPdf.startsWithPdf &&
      legacyPdf.startsWithPdf &&
      nestPdf.startsWithPdf,
    legacyComparable: {
      status: legacy.status,
      headers: legacy.headers,
      pdf: legacyPdf
    },
    nestComparable: {
      status: nest.status,
      headers: nest.headers,
      pdf: nestPdf
    }
  };
}

function compareBinaryXlsx(legacy: BinaryResponse, nest: BinaryResponse) {
  const legacyWorkbook = summarizeWorkbook(legacy.buffer);
  const nestWorkbook = summarizeWorkbook(nest.buffer);
  return {
    same:
      legacy.status === nest.status &&
      stable(legacy.headers) === stable(nest.headers) &&
      stable(legacyWorkbook) === stable(nestWorkbook),
    legacyComparable: {
      status: legacy.status,
      headers: legacy.headers,
      workbook: legacyWorkbook
    },
    nestComparable: {
      status: nest.status,
      headers: nest.headers,
      workbook: nestWorkbook
    }
  };
}

async function discover(): Promise<DiscoveryContext> {
  const [products, partners, quotations, vouchers, salesVouchers] = await Promise.all([
    requestJson(legacyBaseUrl, {
      name: "discover.products",
      kind: "json",
      method: "GET",
      path: "/api/v1/products?page=1&pageSize=20"
    }),
    requestJson(legacyBaseUrl, {
      name: "discover.partners",
      kind: "json",
      method: "GET",
      path: "/api/v1/partners?page=1&pageSize=20"
    }),
    requestJson(legacyBaseUrl, {
      name: "discover.quotations",
      kind: "json",
      method: "GET",
      path: "/api/v1/quotations?page=1&pageSize=20"
    }),
    requestJson(legacyBaseUrl, {
      name: "discover.vouchers",
      kind: "json",
      method: "GET",
      path: "/api/v1/vouchers?page=1&pageSize=20"
    }),
    requestJson(legacyBaseUrl, {
      name: "discover.sales-vouchers",
      kind: "json",
      method: "GET",
      path: "/api/v1/vouchers?page=1&pageSize=20&type=SALES"
    })
  ]);

  const salesVoucher = pickFirstItemFromListPayload(salesVouchers.body);

  return {
    productId: pickFirstIdFromListPayload(products.body),
    partnerId: pickFirstIdFromListPayload(partners.body),
    quotationId: pickFirstIdFromListPayload(quotations.body),
    voucherId: pickFirstIdFromListPayload(vouchers.body),
    salesVoucherId: typeof salesVoucher?.id === "string" ? salesVoucher.id : undefined,
    salesVoucherPartnerId: typeof salesVoucher?.partnerId === "string" ? salesVoucher.partnerId : undefined
  };
}

function buildCompareCases(context: DiscoveryContext) {
  const cases: CompareCase[] = [
    { name: "users.list", kind: "json", method: "GET", path: "/api/v1/users" },
    { name: "system-settings.get", kind: "json", method: "GET", path: "/api/v1/system-settings" },
    { name: "warehouses.list", kind: "json", method: "GET", path: "/api/v1/warehouses" },
    { name: "products.list", kind: "json", method: "GET", path: "/api/v1/products?page=1&pageSize=20" },
    { name: "partners.list", kind: "json", method: "GET", path: "/api/v1/partners?page=1&pageSize=20" },
    { name: "quotations.list", kind: "json", method: "GET", path: "/api/v1/quotations?page=1&pageSize=20" },
    { name: "debt.summary", kind: "json", method: "GET", path: "/api/v1/debt/summary" },
    { name: "debt.collections", kind: "json", method: "GET", path: "/api/v1/debt/collections" },
    { name: "reports.templates", kind: "json", method: "GET", path: "/api/v1/reports/templates" },
    { name: "reports.filters", kind: "json", method: "GET", path: "/api/v1/reports/filters" },
    {
      name: "reports.query.sales",
      kind: "json",
      method: "POST",
      path: "/api/v1/reports/query",
      body: { reportType: "SO_CHI_TIET_BAN_HANG" }
    },
    {
      name: "reports.query.purchase",
      kind: "json",
      method: "POST",
      path: "/api/v1/reports/query",
      body: { reportType: "SO_CHI_TIET_MUA_HANG" }
    },
    {
      name: "reports.query.material",
      kind: "json",
      method: "POST",
      path: "/api/v1/reports/query",
      body: { reportType: "SO_CHI_TIET_VAT_TU_HANG_HOA" }
    },
    {
      name: "reports.query.debt-ar",
      kind: "json",
      method: "POST",
      path: "/api/v1/reports/query",
      body: { reportType: "TONG_HOP_CONG_NO" }
    },
    {
      name: "reports.query.debt-ap",
      kind: "json",
      method: "POST",
      path: "/api/v1/reports/query",
      body: { reportType: "TONG_HOP_CONG_NO_NCC" }
    },
    {
      name: "reports.debt-notice-excel.ar",
      kind: "binary-xlsx",
      method: "POST",
      path: "/api/v1/reports/debt-notice/excel",
      body: { reportType: "TONG_HOP_CONG_NO" }
    },
    {
      name: "reports.debt-notice-excel.ap",
      kind: "binary-xlsx",
      method: "POST",
      path: "/api/v1/reports/debt-notice/excel",
      body: { reportType: "TONG_HOP_CONG_NO_NCC" }
    },
    { name: "vouchers.list", kind: "json", method: "GET", path: "/api/v1/vouchers?page=1&pageSize=20" },
    { name: "audit-logs.list", kind: "json", method: "GET", path: "/api/v1/audit-logs?limit=20" }
  ];

  for (const domain of importDomains) {
    cases.push({
      name: `imports.template.${domain.toLowerCase()}`,
      kind: "binary-xlsx",
      method: "GET",
      path: `/api/v1/imports/template?domain=${domain}`
    });
  }

  if (context.quotationId) {
    cases.push({
      name: "quotations.detail",
      kind: "json",
      method: "GET",
      path: `/api/v1/quotations/${context.quotationId}`
    });
  }

  if (context.voucherId) {
    cases.push({
      name: "vouchers.detail",
      kind: "json",
      method: "GET",
      path: `/api/v1/vouchers/${context.voucherId}`
    });
  }

  if (context.partnerId) {
    cases.push({
      name: "partners.debt-pdf",
      kind: "binary-pdf",
      method: "GET",
      path: `/api/v1/partners/${context.partnerId}/debt-pdf`
    });
  }

  if (context.productId) {
    cases.push({
      name: "reports.stock-card",
      kind: "json",
      method: "GET",
      path: `/api/v1/reports/stock-card?productId=${context.productId}`
    });
    cases.push({
      name: "reports.stock-card-excel",
      kind: "binary-xlsx",
      method: "GET",
      path: `/api/v1/reports/stock-card/excel?productId=${context.productId}`
    });
  }

  if (context.partnerId) {
    cases.push({
      name: "ar-ledger.list",
      kind: "json",
      method: "GET",
      path: `/api/v1/ar-ledger?partnerId=${context.partnerId}&page=1&pageSize=20`
    });
  }

  if (context.salesVoucherPartnerId) {
    cases.push({
      name: "vouchers.unpaid.sales",
      kind: "json",
      method: "GET",
      path: `/api/v1/vouchers/unpaid?partnerId=${context.salesVoucherPartnerId}&type=SALES`
    });
  }

  if (context.partnerId && context.productId) {
    cases.push({
      name: "vouchers.last-price",
      kind: "json",
      method: "GET",
      path: `/api/v1/vouchers/last-price?customerId=${context.partnerId}&productId=${context.productId}`
    });
  }

  if (context.salesVoucherId) {
    cases.push({
      name: "vouchers.pdf.delivery-note",
      kind: "binary-pdf",
      method: "GET",
      path: `/api/v1/vouchers/${context.salesVoucherId}/pdf?template=DELIVERY_NOTE`
    });
    cases.push({
      name: "vouchers.pdf.handover-record",
      kind: "binary-pdf",
      method: "GET",
      path: `/api/v1/vouchers/${context.salesVoucherId}/pdf?template=HANDOVER_RECORD`
    });
  }

  return cases;
}

async function main() {
  const discovery = await discover();
  const compareCases = buildCompareCases(discovery);

  console.log(
    JSON.stringify({
      discovery,
      totalCases: compareCases.length
    })
  );

  let hasDiff = false;

  for (const testCase of compareCases) {
    const [legacy, nest] = await Promise.all([
      testCase.kind === "json" ? requestJson(legacyBaseUrl, testCase) : requestBinary(legacyBaseUrl, testCase),
      testCase.kind === "json" ? requestJson(nestBaseUrl, testCase) : requestBinary(nestBaseUrl, testCase)
    ]);

    if (testCase.kind === "json") {
      const legacyBody = normalizeJsonPayload(legacy.body);
      const nestBody = normalizeJsonPayload(nest.body);
      const same =
        legacy.status === nest.status &&
        stable(legacy.headers) === stable(nest.headers) &&
        stable(legacyBody) === stable(nestBody);

      console.log(
        JSON.stringify({
          case: testCase.name,
          kind: testCase.kind,
          same,
          legacyStatus: legacy.status,
          nestStatus: nest.status
        })
      );

      if (!same) {
        hasDiff = true;
        console.log(
          JSON.stringify(
            {
              case: testCase.name,
              legacy: { ...legacy, body: legacyBody },
              nest: { ...nest, body: nestBody }
            },
            null,
            2
          )
        );
      }

      continue;
    }

    const comparison =
      testCase.kind === "binary-xlsx" ? compareBinaryXlsx(legacy, nest) : compareBinaryPdf(legacy, nest);

    console.log(
      JSON.stringify({
        case: testCase.name,
        kind: testCase.kind,
        same: comparison.same,
        legacyStatus: legacy.status,
        nestStatus: nest.status
      })
    );

    if (!comparison.same) {
      hasDiff = true;
      console.log(
        JSON.stringify(
          {
            case: testCase.name,
            legacy: comparison.legacyComparable,
            nest: comparison.nestComparable
          },
          null,
          2
        )
      );
    }
  }

  if (hasDiff) {
    process.exitCode = 1;
  }
}

void main();
