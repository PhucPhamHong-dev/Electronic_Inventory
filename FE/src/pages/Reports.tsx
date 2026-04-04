import { Button, Space, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../constants/routes";

export function ReportsPage() {
  const navigate = useNavigate();

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Báo cáo
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Chọn loại báo cáo để xem dữ liệu tổng hợp và đối soát.
      </Typography.Paragraph>
      <Space>
        <Button onClick={() => navigate(ROUTES.VOUCHER_HISTORY)}>Lịch sử chứng từ</Button>
        <Button onClick={() => navigate(ROUTES.STOCK_CARD_REPORT)}>Thẻ kho</Button>
        <Button type="primary" onClick={() => navigate(ROUTES.AR_LEDGER_REPORT)}>
          Sổ chi tiết công nợ
        </Button>
      </Space>
    </div>
  );
}

