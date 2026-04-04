import swaggerJsdoc from "swagger-jsdoc";
import type { Options } from "swagger-jsdoc";
import { env } from "./env";

const options: Options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "WMS Enterprise Backend API",
      version: "1.0.0",
      description: "Warehouse Management System API documentation"
    },
    servers: [
      {
        url: `http://127.0.0.1:${env.PORT}`,
        description: "Local development server"
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        ApiResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            traceId: { type: "string" },
            data: {},
            error: {
              type: ["object", "null"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: {}
              }
            }
          }
        },
        VoucherItemInput: {
          type: "object",
          required: ["productId", "quantity", "unitPrice"],
          properties: {
            productId: { type: "string", format: "uuid" },
            quantity: { type: "number" },
            unitPrice: { type: "number" },
            discountRate: { type: "number" },
            discountAmount: { type: "number" },
            taxRate: { type: "number" },
            taxAmount: { type: "number" }
          }
        }
      }
    },
    paths: {
      "/health": {
        get: {
          tags: ["System"],
          summary: "Health check",
          responses: {
            "200": {
              description: "Server status"
            }
          }
        }
      },
      "/api/v1/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login and receive JWT token",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  properties: {
                    username: { type: "string" },
                    password: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Login success" },
            "401": { description: "Invalid credentials" }
          }
        }
      },
      "/api/v1/vouchers": {
        get: {
          tags: ["Vouchers"],
          summary: "List vouchers with filter",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", required: false, schema: { type: "integer", default: 1 } },
            { in: "query", name: "pageSize", required: false, schema: { type: "integer", default: 20 } },
            {
              in: "query",
              name: "type",
              required: false,
              schema: {
                type: "string",
                enum: ["PURCHASE", "SALES", "CONVERSION", "RECEIPT", "PAYMENT", "OPENING_BALANCE"]
              }
            },
            { in: "query", name: "search", required: false, schema: { type: "string" } },
            { in: "query", name: "startDate", required: false, schema: { type: "string", format: "date" } },
            { in: "query", name: "endDate", required: false, schema: { type: "string", format: "date" } }
          ],
          responses: {
            "200": { description: "Voucher list" }
          }
        }
      },
      "/api/v1/vouchers/purchase": {
        post: {
          tags: ["Vouchers"],
          summary: "Create purchase voucher",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    voucherDate: { type: "string", format: "date-time" },
                    note: { type: "string" },
                    partnerId: { type: "string", format: "uuid" },
                    isPaidImmediately: { type: "boolean" },
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/VoucherItemInput" }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Created" },
            "403": { description: "Permission denied" }
          }
        }
      },
      "/api/v1/vouchers/sales": {
        post: {
          tags: ["Vouchers"],
          summary: "Create sales voucher",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["partnerId", "items"],
                  properties: {
                    voucherDate: { type: "string", format: "date-time" },
                    note: { type: "string" },
                    partnerId: { type: "string", format: "uuid" },
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/VoucherItemInput" }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Created" },
            "409": { description: "Insufficient stock" }
          }
        }
      },
      "/api/v1/vouchers/receipt": {
        post: {
          tags: ["Vouchers"],
          summary: "Create receipt voucher and reduce AR debt",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["partnerId", "amount"],
                  properties: {
                    partnerId: { type: "string", format: "uuid" },
                    amount: { type: "number" },
                    voucherDate: { type: "string", format: "date-time" },
                    description: { type: "string" },
                    referenceVoucherId: { type: "string", format: "uuid" }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Created" },
            "404": { description: "Partner or reference voucher not found" }
          }
        }
      },
      "/api/v1/vouchers/conversion": {
        post: {
          tags: ["Vouchers"],
          summary: "Create conversion voucher",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["sourceProductId", "targetProductId", "sourceQuantity"],
                  properties: {
                    voucherDate: { type: "string", format: "date-time" },
                    note: { type: "string" },
                    sourceProductId: { type: "string", format: "uuid" },
                    targetProductId: { type: "string", format: "uuid" },
                    sourceQuantity: { type: "number" }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Created" }
          }
        }
      },
      "/api/v1/vouchers/{id}": {
        put: {
          tags: ["Vouchers"],
          summary: "Update voucher (including booked voucher reverse-entry flow)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    voucherDate: { type: "string", format: "date-time" },
                    note: { type: "string" },
                    partnerId: { type: "string", format: "uuid" },
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/VoucherItemInput" }
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Updated" }
          }
        }
      },
      "/api/v1/vouchers/{id}/book": {
        post: {
          tags: ["Vouchers"],
          summary: "Book voucher",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" }
            }
          ],
          responses: {
            "200": { description: "Booked" },
            "409": { description: "Voucher already booked" }
          }
        }
      },
      "/api/v1/vouchers/{id}/pay": {
        post: {
          tags: ["Vouchers"],
          summary: "Quick payment for sales/purchase voucher",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" }
            }
          ],
          responses: {
            "200": { description: "Payment completed" },
            "404": { description: "Voucher not found" },
            "409": { description: "Voucher already paid" }
          }
        }
      },
      "/api/v1/vouchers/{id}/pdf": {
        get: {
          tags: ["Vouchers"],
          summary: "Download voucher PDF (Sales/Purchase)",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string", format: "uuid" }
            }
          ],
          responses: {
            "200": {
              description: "PDF binary stream",
              content: {
                "application/pdf": {
                  schema: {
                    type: "string",
                    format: "binary"
                  }
                }
              }
            }
          }
        }
      },
      "/api/v1/products": {
        get: {
          tags: ["Master Data"],
          summary: "List products",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", required: false, schema: { type: "integer", default: 1 } },
            { in: "query", name: "pageSize", required: false, schema: { type: "integer", default: 20 } },
            { in: "query", name: "keyword", required: false, schema: { type: "string" } },
            { in: "query", name: "type", required: false, schema: { type: "string", enum: ["SUPPLIER", "CUSTOMER", "BOTH"] } }
          ],
          responses: {
            "200": { description: "Products list" }
          }
        },
        post: {
          tags: ["Master Data"],
          summary: "Create product",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["skuCode", "name"],
                  properties: {
                    skuCode: { type: "string" },
                    name: { type: "string" },
                    costPrice: { type: "number" }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Created" }
          }
        }
      },
      "/api/v1/partners": {
        get: {
          tags: ["Master Data"],
          summary: "List partners",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "page", required: false, schema: { type: "integer", default: 1 } },
            { in: "query", name: "pageSize", required: false, schema: { type: "integer", default: 20 } },
            { in: "query", name: "keyword", required: false, schema: { type: "string" } }
          ],
          responses: {
            "200": { description: "Partners list" }
          }
        },
        post: {
          tags: ["Master Data"],
          summary: "Create partner",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    code: { type: "string" },
                    name: { type: "string" },
                    phone: { type: "string" },
                    taxCode: { type: "string" },
                    address: { type: "string" },
                    partnerType: { type: "string", enum: ["SUPPLIER", "CUSTOMER", "BOTH"] }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Created" }
          }
        }
      },
      "/api/v1/partners/{id}": {
        put: {
          tags: ["Master Data"],
          summary: "Update partner",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    code: { type: "string" },
                    name: { type: "string" },
                    phone: { type: "string" },
                    taxCode: { type: "string" },
                    address: { type: "string" },
                    partnerType: { type: "string", enum: ["SUPPLIER", "CUSTOMER", "BOTH"] }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Updated" },
            "404": { description: "Partner not found" }
          }
        },
        delete: {
          tags: ["Master Data"],
          summary: "Delete partner (soft-delete)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }
          ],
          responses: {
            "200": { description: "Deleted" },
            "404": { description: "Partner not found" }
          }
        }
      },
      "/api/v1/partners/{partnerId}/debt-pdf": {
        get: {
          tags: ["Reports"],
          summary: "Export partner debt notice PDF",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "partnerId", required: true, schema: { type: "string", format: "uuid" } },
            { in: "query", name: "startDate", required: true, schema: { type: "string", format: "date" } },
            { in: "query", name: "endDate", required: true, schema: { type: "string", format: "date" } }
          ],
          responses: {
            "200": { description: "PDF stream" },
            "404": { description: "Partner not found" }
          }
        }
      },
      "/api/v1/ar-ledger": {
        get: {
          tags: ["Reports"],
          summary: "Get AR ledger entries by partner",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "partnerId", required: true, schema: { type: "string", format: "uuid" } },
            { in: "query", name: "startDate", required: false, schema: { type: "string", format: "date" } },
            { in: "query", name: "endDate", required: false, schema: { type: "string", format: "date" } },
            { in: "query", name: "page", required: false, schema: { type: "integer", default: 1 } },
            { in: "query", name: "pageSize", required: false, schema: { type: "integer", default: 20 } }
          ],
          responses: {
            "200": { description: "AR ledger list" },
            "404": { description: "Partner not found" }
          }
        }
      },
      "/api/v1/reports/stock-card": {
        get: {
          tags: ["Reports"],
          summary: "Get stock card entries by product",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "productId", required: true, schema: { type: "string", format: "uuid" } },
            { in: "query", name: "startDate", required: false, schema: { type: "string", format: "date" } },
            { in: "query", name: "endDate", required: false, schema: { type: "string", format: "date" } }
          ],
          responses: {
            "200": { description: "Stock card list" },
            "404": { description: "Product not found" }
          }
        }
      },
      "/api/v1/reports/stock-card/excel": {
        get: {
          tags: ["Reports"],
          summary: "Export stock card Excel",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "query", name: "productId", required: true, schema: { type: "string", format: "uuid" } },
            { in: "query", name: "startDate", required: false, schema: { type: "string", format: "date" } },
            { in: "query", name: "endDate", required: false, schema: { type: "string", format: "date" } }
          ],
          responses: {
            "200": {
              description: "Excel file",
              content: {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
                  schema: {
                    type: "string",
                    format: "binary"
                  }
                }
              }
            }
          }
        }
      },
      "/api/v1/users": {
        get: {
          tags: ["System"],
          summary: "List users",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Users list" }
          }
        },
        post: {
          tags: ["System"],
          summary: "Create user",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  properties: {
                    username: { type: "string" },
                    fullName: { type: "string" },
                    password: { type: "string" },
                    isActive: { type: "boolean" },
                    permissions: { type: "object" }
                  }
                }
              }
            }
          },
          responses: {
            "201": { description: "Created" }
          }
        }
      },
      "/api/v1/users/{id}": {
        put: {
          tags: ["System"],
          summary: "Update user",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    username: { type: "string" },
                    fullName: { type: "string" },
                    password: { type: "string" },
                    isActive: { type: "boolean" },
                    permissions: { type: "object" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Updated" }
          }
        },
        delete: {
          tags: ["System"],
          summary: "Delete user (soft-delete)",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }
          ],
          responses: {
            "200": { description: "Deleted" }
          }
        }
      },
      "/api/v1/users/{id}/reset-password": {
        patch: {
          tags: ["System"],
          summary: "Reset user password",
          security: [{ bearerAuth: [] }],
          parameters: [
            { in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["newPassword"],
                  properties: {
                    newPassword: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Password reset success" }
          }
        }
      },
      "/api/v1/system-settings": {
        get: {
          tags: ["System"],
          summary: "Get company settings",
          security: [{ bearerAuth: [] }],
          responses: {
            "200": { description: "Company settings" }
          }
        },
        put: {
          tags: ["System"],
          summary: "Update company settings",
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["companyName", "companyAddress", "companyPhone"],
                  properties: {
                    companyName: { type: "string" },
                    companyAddress: { type: "string" },
                    companyPhone: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Settings updated" }
          }
        }
      },
      "/api/v1/audit-logs": {
        get: {
          tags: ["Audit"],
          summary: "Get audit logs",
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              in: "query",
              name: "entityName",
              required: false,
              schema: { type: "string" }
            },
            {
              in: "query",
              name: "limit",
              required: false,
              schema: { type: "integer", default: 100 }
            }
          ],
          responses: {
            "200": { description: "Audit logs list" },
            "403": { description: "Permission denied" }
          }
        }
      }
    }
  },
  apis: []
};

export const swaggerSpec = swaggerJsdoc(options);
