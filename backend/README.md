# Backend NestJS Migration Layer

`/backend` là backend NestJS mới dùng để thay thế dần `/BE` mà vẫn giữ nguyên API `/api/v1`.

## Mục tiêu hiện tại
- Giữ nguyên contract API mà FE đang gọi.
- Giữ nguyên logic nghiệp vụ bằng cách gọi service cũ trong `/BE`.
- Tách lớp framework trước, rồi mới bóc dần domain logic sang provider Nest riêng.

## Chạy local
```powershell
cd backend
npm install
npx prisma generate --schema prisma/schema.prisma
npm run dev
```

Mặc định app chạy cổng `3001`.

## Chạy test smoke
```powershell
cd backend
npm test
```

## Chạy đối soát sâu hơn
```powershell
cd backend
npm run test:invariants
```

```powershell
cd backend
$env:LEGACY_BASE_URL="http://localhost:3000"
$env:NEST_BASE_URL="http://localhost:3001"
$env:AUTH_TOKEN="..."
npm run test:contracts
```

Hoặc chạy tiện hơn bằng script tự lấy token:
```powershell
cd backend
npm run compare:all
```

Nếu không muốn set `AUTH_TOKEN`, khai báo trong `backend/.env`:
- `COMPARE_USERNAME=...`
- `COMPARE_PASSWORD=...`

## Kiến trúc hiện tại
- NestJS bootstrap + middleware/filter mới
- Module/controller Nest native cho:
  - auth
  - users
  - system-settings
  - master-data
  - quotations
  - debt
  - reports
  - vouchers
  - imports
  - audit-logs
- Swagger/OpenAPI đã bật lại tại:
  - `/api/docs`
  - `/api/openapi.json`
- Prisma schema/template assets được copy sang `/backend` để app mới tự chạy độc lập

## Nguyên tắc
- Không đổi API `/api/v1`
- Không đổi schema Prisma trong pha framework migration
- Không đổi công thức voucher/import/report ở pha này
