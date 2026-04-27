# Logic Contract v1

Pha migration này khóa 3 nguyên tắc:

1. Không đổi contract API `/api/v1`
2. Không đổi công thức và side effect trong domain hiện tại
3. Không đổi nguồn dữ liệu chuẩn:
   - tồn kho: `inventory_movement` + `product.stockQuantity`
   - công nợ: `ar_ledger` + `partner.currentDebt`
   - báo cáo: đọc từ cùng domain service hiện tại

## Domain đang khóa
- Voucher
- Import
- Report
- Master Data
- Debt
- Quotation
- System Settings

## Invariant bắt buộc
- `Product.stockQuantity == aggregate(inventoryMovement)`
- `Partner.currentDebt == closing(arLedger)`
- tổng phiếu == tổng dòng
- `paidAmount == allocation hợp lệ`
- tổng báo cáo == sum dữ liệu chi tiết hiển thị

## Nguồn logic tham chiếu
- `../BE/src/services/VoucherService.ts`
- `../BE/src/services/ImportService.ts`
- `../BE/src/services/ReportService.ts`
- `../BE/src/services/MasterDataService.ts`
- `../BE/src/services/DebtService.ts`
- `../BE/src/services/QuotationService.ts`
- `../BE/src/services/SystemSettingService.ts`

## Trạng thái migration hiện tại
- Phase adapter đã xong: `/backend` host NestJS, middleware/filter/bootstrap đã chạy độc lập.
- Phase 2→5 đã được native hóa route/controller theo module:
  - `auth`
  - `users`
  - `system-settings`
  - `master-data`
  - `quotations`
  - `debt`
  - `reports`
- Phase 6→7 đã native hóa nốt:
  - `vouchers`
  - `cash-vouchers`
  - `imports`
  - `audit-logs`
- Logic nghiệp vụ ở các module trên vẫn gọi service cũ trong `/BE`.
- `legacy-api.controller.ts` và adapter proxy đã được loại khỏi app wiring.
- Swagger/OpenAPI đã bật lại sau khi không còn route proxy raw.

## Chiến lược tiếp theo
- Giữ `/BE` làm reference để so contract, invariant và regression.
- Chỉ tách sâu service/domain khi route Nest native đã ổn định và qua smoke test.
- Bước tiếp theo không còn là native hóa route, mà là bóc dần service nội bộ khỏi `/BE` theo từng domain khi có đủ regression coverage.
