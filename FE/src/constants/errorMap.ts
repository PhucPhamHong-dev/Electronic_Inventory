export const ErrorMap: Record<string, string> = {
  INSUFFICIENT_STOCK: "Không đủ tồn kho để xuất hàng. Vui lòng kiểm tra lại.",
  PERMISSION_DENIED: "Bạn không có quyền thực hiện thao tác này.",
  VOUCHER_ALREADY_BOOKED: "Phiếu đã được ghi sổ, không thể chỉnh sửa.",
  CONCURRENCY_CONFLICT: "Dữ liệu đã bị thay đổi bởi người khác, vui lòng tải lại.",
  VALIDATION_ERROR: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
  NOT_FOUND: "Không tìm thấy dữ liệu.",
  UNAUTHORIZED: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  INTERNAL_ERROR: "Lỗi hệ thống. Vui lòng thử lại sau."
};
