# Backend Specialized Guide (BE)

## 1. Purpose
This backend runs an internal WMS with 4 main flows:
1. Purchase voucher (`PURCHASE`)
2. Sales voucher (`SALES`)
3. Conversion voucher (`CONVERSION`)
4. Audit and monitoring

All stock and debt operations run inside PostgreSQL transactions with row locking (`FOR UPDATE`) to avoid race conditions.

## 2. Supabase setup used in this project
- Project URL: `https://djcxyndgoqbzngrxxojn.supabase.co`
- Publishable key: `sb_publishable_WmUK42KTndAp562N0e-k-g_csImdIKP`
- Frontend-style env keys supported:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`

The backend still connects to PostgreSQL by `DATABASE_URL` / `DIRECT_URL` (not by publishable key).

## 3. Required env values
Use these exact formats in `.env`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://djcxyndgoqbzngrxxojn.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_WmUK42KTndAp562N0e-k-g_csImdIKP

DATABASE_URL=postgresql://postgres.djcxyndgoqbzngrxxojn:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require
DIRECT_URL=postgresql://postgres.djcxyndgoqbzngrxxojn:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
```

Notes:
- `DATABASE_URL` is for app traffic (pooler, port `6543`).
- `DIRECT_URL` is for Prisma migration/direct operations (port `5432`).
- Replace `[YOUR-PASSWORD]` with your real DB password from Supabase Dashboard.

## 4. Run backend
```bash
cd BE
npm install
npm run prisma:generate
npm run build
npm run db:check
npm run dev
```

Health check:
```bash
curl http://127.0.0.1:3000/health
```

Swagger:
```bash
http://127.0.0.1:3000/api/docs
http://127.0.0.1:3000/api/openapi.json
```

## 5. If database check fails
- `P1001`:
  - Usually host/network issue.
  - Use pooler host (`aws-1-ap-south-1.pooler.supabase.com`) as configured.
- `P1000`:
  - Wrong password/user in connection string.
  - Re-copy password from Supabase project settings.

## 6. API summary
1. `POST /api/v1/auth/login`
2. `POST /api/v1/vouchers/purchase`
3. `POST /api/v1/vouchers/sales`
4. `POST /api/v1/vouchers/conversion`
5. `PUT /api/v1/vouchers/:id`
6. `POST /api/v1/vouchers/:id/book`
7. `GET /api/v1/vouchers/:id/pdf`
8. `GET /api/v1/audit-logs`
9. `GET /api/v1/products`
10. `POST /api/v1/products`
11. `GET /api/v1/partners`
12. `POST /api/v1/partners`

## 7. API request log fields
Every API request writes JSON log with:
- `startedAt`
- `completedAt`
- `latencyMs`
- `method`, `path`, `statusCode`
- `traceId`, `userId`, `ipAddress`
