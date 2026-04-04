# FE - WMS Enterprise (React + Ant Design)

## Tổng quan
Frontend cho hệ thống WMS nội bộ, kết nối Backend Express + Prisma + Supabase.  
Giao diện theo phong cách ERP B2B: mật độ dữ liệu cao, tối ưu nhập liệu bằng bàn phím, tập trung chứng từ kho và công nợ.

## Công nghệ
- React 18 + TypeScript strict + Vite
- Ant Design v5
- TailwindCSS (lớp utility để dễ bảo trì layout)
- React Router v6
- Zustand (auth/global state)
- TanStack Query v5 (server state)
- Axios + Interceptors (gắn JWT, map lỗi nghiệp vụ)

## Chạy nhanh
```bash
cd FE
npm install
cp .env.example .env
npm run dev
```

## Biến môi trường
```env
VITE_API_BASE_URL=http://127.0.0.1:3000
VITE_SUPABASE_URL=https://djcxyndgoqbzngrxxojn.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_WmUK42KTndAp562N0e-k-g_csImdIKP
```

## Cấu trúc chính
- `src/config`: axios config, theme AntD, query client
- `src/store`: Zustand auth store
- `src/services`: API theo module (`auth`, `masterData`, `voucher`, `report`)
- `src/pages`: màn hình nghiệp vụ (`Login`, `VoucherForm`, `ArLedgerReport`, ...)
- `src/components`: component dùng lại (`Protected`, `PDFPreview`, `QuickAddPartnerModal`, ...)
- `src/types`: DTO đồng bộ với Backend
- `src/assets/global.css`: Tailwind directives + override AntD + highlight row

## Màn hình trọng tâm
### 1) VoucherForm
- Form master-detail cho nhập/xuất kho.
- Bảng chi tiết inline edit, có hotkeys: `Ctrl+S`, `F9`, `Ctrl+P`, `F2`, `Delete`.
- Có `% CK`, `% Thuế`, tự tính `Thành tiền`, `Tiền CK`, `Thuế`, `Tổng thanh toán`.
- Có checkbox `Thu tiền ngay` để Backend tự sinh phiếu `RECEIPT`.

### 2) Quick Add Khách hàng/NCC trong Voucher
- Trường `Khách hàng / NCC` dùng `Select.dropdownRender`.
- Có nút `Thêm khách hàng/NCC mới` ngay cuối dropdown.
- Mở modal `QuickAddPartnerModal` với 3 trường bắt buộc:
  - `name`
  - `phone`
  - `partnerType` (mặc định `CUSTOMER`)
- Khi lưu thành công:
  - Gọi `POST /api/v1/partners`
  - `invalidateQueries(["voucher-form-partners"])`
  - Tự gán `partnerId` vừa tạo vào form chứng từ hiện tại
  - Hiện notification thành công
- Dữ liệu hàng hóa đang nhập trong bảng chi tiết không bị mất.

### 3) ArLedgerReport
- Lọc theo khách hàng + từ ngày/đến ngày.
- Xuất PDF công nợ qua API:
  `GET /api/v1/partners/:partnerId/debt-pdf?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- Highlight row:
  - Hover: `#fffbe6`
  - Row được chọn: `#fff1b8`

## Theme/UX chuẩn kế toán
- `ConfigProvider` dùng token:
  - `fontSize: 14`
  - `colorText: #1f1f1f`
  - `controlHeight: 36`
  - `borderRadius: 4`
- Override component:
  - `Table`: font 14, header nền xám nhạt, tiêu đề đậm
  - `Form`: label 14, màu chữ dễ đọc
- Input trong bảng chứng từ được làm gọn theo kiểu gần Excel để nhập liệu nhanh hơn.

## Lưu ý API
- Tất cả endpoint đi qua `VITE_API_BASE_URL`.
- Request tự gắn `Authorization: Bearer <token>`.
- `401` sẽ tự clear session và điều hướng về `/login`.
- Mã lỗi BE (`INSUFFICIENT_STOCK`, `PERMISSION_DENIED`, ...) được map sang thông báo tiếng Việt.

## Build
```bash
npm run build
```

## Handoff cho AI/dev mới
- Khi đổi contract API: cập nhật `src/types` trước, sau đó sửa `src/services`.
- Khi thêm route mới: cập nhật `src/constants/routes.ts`, `src/App.tsx`, menu `src/layouts/MainLayout.tsx`.
- Dữ liệu nhạy cảm (giá vốn): luôn đi qua `Protected`/permission hook để mask khi user không có quyền.
