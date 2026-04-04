import { Card, Col, Row, Statistic, Typography } from "antd";

export function DashboardPage() {
  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Bảng điều khiển
      </Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Phiếu chờ ghi sổ" value={0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Đơn xuất hôm nay" value={0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Statistic title="Đơn nhập hôm nay" value={0} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
