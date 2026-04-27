import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "../src/create-app";

let app: INestApplication;

before(async () => {
  app = await createApp();
  await app.init();
});

after(async () => {
  await app.close();
});

test("GET /health returns ok", async () => {
  const response = await request(app.getHttpServer()).get("/health");
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
});

test("POST /api/v1/auth/login validates payload", async () => {
  const response = await request(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({});

  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

for (const route of [
  "/api/v1/users",
  "/api/v1/system-settings",
  "/api/v1/products",
  "/api/v1/partners",
  "/api/v1/warehouses",
  "/api/v1/ar-ledger",
  "/api/v1/quotations",
  "/api/v1/debt/summary",
  "/api/v1/reports/templates",
  "/api/v1/vouchers",
  "/api/v1/vouchers/unpaid",
  "/api/v1/vouchers/last-price",
  "/api/v1/imports/template?domain=PRODUCTS",
  "/api/v1/audit-logs"
]) {
  test(`GET ${route} requires auth`, async () => {
    const response = await request(app.getHttpServer()).get(route);
    assert.equal(response.status, 401);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  });
}

test("POST /api/v1/system-settings/accounting-reset requires auth", async () => {
  const response = await request(app.getHttpServer()).post("/api/v1/system-settings/accounting-reset");
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHORIZED");
});

for (const route of [
  "/api/v1/cash-vouchers",
  "/api/v1/imports/validate",
  "/api/v1/imports/commit"
]) {
  test(`POST ${route} requires auth`, async () => {
    const response = await request(app.getHttpServer()).post(route).send({});
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHORIZED");
  });
}

test("GET /api/openapi.json returns swagger document", async () => {
  const response = await request(app.getHttpServer()).get("/api/openapi.json");
  assert.equal(response.status, 200);
  assert.equal(typeof response.body.openapi, "string");
});

test("GET /api/docs returns swagger ui html", async () => {
  const response = await request(app.getHttpServer()).get("/api/docs/");
  assert.equal(response.status, 200);
  assert.match(response.text, /swagger/i);
});
