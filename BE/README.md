# WMS Enterprise Backend (TypeScript + Express + Prisma + Supabase/PostgreSQL)

## 1. Software Requirement Specification (SRS)

### 1.1 Mục tiêu hệ thống
Hệ thống WMS nội bộ phục vụ doanh nghiệp thương mại với 4 luồng chính:
1. Nhập kho (Purchase).
2. Xuất kho (Sales).
3. Xé lẻ/chuyển đổi mã (Conversion từ cuộn sang mét).
4. Đối soát truy vết (Audit & Monitoring).

Mục tiêu vận hành:
- Đảm bảo toàn vẹn dữ liệu tồn kho và công nợ trong môi trường đồng thời.
- Hỗ trợ kiểm soát quyền chi tiết theo JSON permission cho từng nhân viên.
- Cung cấp audit trail cấp giao dịch, phục vụ kiểm toán nội bộ.
- Cho phép mở rộng schema không phá vỡ logic hiện hữu.

### 1.2 Actors
- `Admin (Chị Hằng)`: toàn quyền; quản lý người dùng, bật/tắt quyền theo JSON.
- `Staff`: tạo và xử lý chứng từ nhập/xuất/chuyển đổi theo quyền; có thể bị ẩn giá vốn.

### 1.3 Use Cases nghiệp vụ

#### UC01 - Nhập kho (Purchase)
- Tạo phiếu nhập với nhiều dòng hàng.
- Tính `net_price` từng dòng = `quantity * unit_price - discount_amount`.
- Cập nhật tồn kho và giá vốn bình quân gia quyền:
  - `new_cost = ((old_qty * old_cost) + (in_qty * in_cost)) / (old_qty + in_qty)`.
- Nếu đối tác là nhà cung cấp công nợ: cập nhật sổ công nợ.

#### UC02 - Xuất kho (Sales)
- Validate payload, quyền và trạng thái đối tượng.
- Khóa dòng sản phẩm bằng `SELECT ... FOR UPDATE` để tránh race condition.
- Kiểm tra tồn đủ trước khi trừ kho.
- Ghi ledger công nợ khách hàng (debit).
- Ghi movement + voucher items + voucher header trong cùng transaction.

#### UC03 - Xé lẻ (Conversion)
- Chọn mã cha (cuộn) và mã con (mét) có `parent_id` liên kết.
- Trừ tồn mã cha theo số lượng nguồn.
- Cộng tồn mã con theo `source_qty * conversion_ratio`.
- Ghi hai movement: `CONVERSION_OUT` và `CONVERSION_IN`.

#### UC04 - Đối soát (Audit)
- Mọi thay đổi `INSERT/UPDATE/DELETE` của bảng `vouchers` được trigger ghi `audit_logs`.
- Nghiệp vụ ứng dụng ghi log theo từng bước xử lý:
  - `[Initiated]`, `[Auth Check]`, `[Pre-flight Check]`, `[Transaction Started]`,
  - `[Post-processing]`, `[Completed]`, `[FAILED]`.

### 1.4 Functional Requirements
- Tạo/sửa/ghi sổ chứng từ `PURCHASE`, `SALES`, `CONVERSION`.
- Sửa chứng từ đã ghi sổ:
  - Lấy snapshot dữ liệu cũ (voucher items + inventory movements + AR ledger).
  - Bút toán đảo: hoàn kho + hoàn công nợ theo dữ liệu cũ.
  - Áp số mới, cập nhật `is_edited=true`.
- Xuất PDF chứng từ:
  - Template có logo + thông tin công ty từ `system_settings`.
  - Lưu file và cập nhật `vouchers.pdf_file_path`.
- Masking dữ liệu nhạy cảm:
  - Ẩn `cost_price`, `unit_cost`, `cogs` khi user không có `view_cost_price`.

### 1.5 Non-functional Requirements
- **Data Integrity**: mọi nghiệp vụ kho/công nợ chạy trong DB transaction.
- **Concurrency Safety**: lock row cấp sản phẩm trước khi thay đổi tồn kho.
- **Scalability**: schema + service tách lớp, dễ mở rộng cột/bảng.
- **Observability**: log JSON có `traceId`, `step`, `status`, `latencyMs`.
- **Privacy**: masking field nhạy cảm theo permission.
- **Reliability**: lỗi ở bất kỳ bước nào bắt buộc rollback toàn phần.

### 1.6 Permission JSON chuẩn
```json
{
  "create_purchase_voucher": true,
  "create_sales_voucher": true,
  "create_conversion_voucher": true,
  "edit_booked_voucher": false,
  "view_cost_price": false,
  "view_audit_logs": false
}
```

### 1.7 Quy tắc đánh số chứng từ
- `PURCHASE`: `NK-YYYY-####`
- `SALES`: `GH-YYYY-####`
- `CONVERSION`: `XL-YYYY-####`

Số chứng từ sinh tại DB function `generate_voucher_no(...)` để tránh trùng khi concurrent.

### 1.8 API Contract chính
1. `POST /api/v1/vouchers/purchase`
2. `POST /api/v1/vouchers/sales`
3. `POST /api/v1/vouchers/conversion`
4. `PUT /api/v1/vouchers/:id`
5. `POST /api/v1/vouchers/:id/book`
6. `GET /api/v1/vouchers/:id/pdf`
7. `GET /api/v1/audit-logs`
8. `GET /api/v1/products`
9. `POST /api/v1/products`
10. `GET /api/v1/partners`
11. `POST /api/v1/partners`

Chuẩn response:
```json
{
  "success": true,
  "traceId": "req-uuid",
  "data": {},
  "error": null
}
```

Chuẩn lỗi:
```json
{
  "success": false,
  "traceId": "req-uuid",
  "data": null,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Stock is not enough"
  }
}
```

### 1.9 Dữ liệu và trạng thái
- Tiền tệ mặc định: `VND`.
- Decimal chuẩn:
  - tiền: `numeric(18,4)`,
  - số lượng: `numeric(18,3)`,
  - tỷ lệ quy đổi: `numeric(18,6)`.
- Soft delete: `deleted_at` cho bảng nghiệp vụ chính.
- V1 là single warehouse, mở rộng `warehouse_id` ở phase sau.

### 1.10 Acceptance Criteria
- Xuất kho đồng thời cùng SKU: chỉ transaction đủ tồn mới thành công.
- Sửa chứng từ booked:
  - Có đảo bút toán cũ.
  - Có áp bút toán mới.
  - Tồn kho và công nợ cuối cùng khớp.
- Lỗi giữa transaction không để lại dữ liệu nửa chừng.
- Trigger audit `vouchers` ghi đủ `old_value/new_value`.
- Staff không có `view_cost_price` không thấy dữ liệu giá vốn qua API.

## 2. Database Architecture

### 2.1 Migration folder
- `database/migrations/001_init_extensions.sql`
- `database/migrations/002_init_types.sql`
- `database/migrations/003_core_tables.sql`
- `database/migrations/004_indexes_constraints.sql`
- `database/migrations/005_triggers_audit.sql`

### 2.2 Bảng cốt lõi
- `users`
- `products`
- `categories`
- `partners`
- `vouchers`
- `voucher_items`
- `inventory_movements`
- `ar_ledger`
- `audit_logs`
- `system_settings`
- `voucher_number_counters`

## 3. Backend Architecture

### 3.1 Folder Structure
```plaintext
/src
  /api
    /controllers
    /routes
    /middlewares
  /services
  /models
  /utils
  /logs
  /types
  /config
```

### 3.2 Thiết kế lớp
- `Controller`: parse request/response, map lỗi HTTP.
- `Service`: nghiệp vụ cốt lõi + transaction.
- `Middleware`: auth, request context, error handler.
- `Utils`: logger, costing, pdf renderer, permission.
- `Prisma`: data access + transaction boundary.

### 3.3 Logging & Monitoring Step-by-step
Ví dụ flow Sales:
1. `[Initiated]`: nhận request, validate schema.
2. `[Auth Check]`: kiểm quyền `create_sales_voucher`.
3. `[Pre-flight Check]`: lock row + kiểm tồn.
4. `[Transaction Started]`: bắt đầu ghi DB.
5. `[Post-processing]`: cập nhật công nợ, giá vốn.
6. `[Completed]`: trả kết quả + thông tin PDF.

Nếu lỗi:
- Ghi `[FAILED]` + stack trace.
- Rollback transaction.
- Trả mã lỗi nghiệp vụ chuẩn hóa.

## 4. Runbook

### 4.1 Yêu cầu môi trường
- Node.js >= 20
- PostgreSQL/Supabase (schema public)
- npm hoặc pnpm

### 4.2 Cài đặt
```bash
npm install
cp .env.example .env
```

### 4.3 Tạo schema
Thực thi tuần tự SQL trong `database/migrations`:
1. `001_init_extensions.sql`
2. `002_init_types.sql`
3. `003_core_tables.sql`
4. `004_indexes_constraints.sql`
5. `005_triggers_audit.sql`

### 4.4 Prisma client
```bash
npm run prisma:generate
```

### 4.5 Chạy app
```bash
npm run dev
```

### 4.6 Swagger
- Swagger UI: `http://127.0.0.1:3000/api/docs`
- OpenAPI JSON: `http://127.0.0.1:3000/api/openapi.json`

### 4.7 Chạy test
```bash
npm test
```

Test integration DB/API được cấu hình `skip` mặc định. Để chạy thật:
```bash
set RUN_DB_INTEGRATION=true
npm test
```

### 4.8 API Access Log Format
Mỗi request API đều ghi log JSON với các trường:
- `traceId`, `method`, `path`, `statusCode`
- `startedAt` (ISO time bắt đầu request)
- `completedAt` (ISO time kết thúc response)
- `latencyMs` (thời gian xử lý)
- `userId`, `ipAddress`

## 5. Test Plan (Implemented)
- Unit tests:
  - weighted average cost.
  - net price calculator.
  - masking sensitive fields.
  - voucher edit flag.
- Integration tests:
  - concurrency sales lock scenario.
  - reverse-entry on edit booked voucher.
  - rollback on mid-transaction failure.
  - vouchers trigger audit coverage.

## 6. Ghi chú triển khai
- Migration SQL là source of truth cho DB.
- Prisma schema map theo DB để type-safe runtime.
- Toàn bộ endpoint nghiệp vụ dùng `try/catch` + `AppError`.
- Mọi response trả kèm `traceId` để đối soát log.
