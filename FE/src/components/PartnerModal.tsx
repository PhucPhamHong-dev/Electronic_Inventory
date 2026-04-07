import { Checkbox, Col, Form, Input, Modal, Row, Space, Typography } from "antd";
import { useEffect } from "react";
import type { PartnerTypeValue } from "../types";

export interface PartnerFormValues {
  code?: string;
  name: string;
  partnerType: PartnerTypeValue;
  phone?: string;
  taxCode?: string;
  address?: string;
}

interface PartnerModalProps {
  open: boolean;
  loading: boolean;
  mode: "create" | "edit";
  title?: string;
  requirePhone?: boolean;
  initialValues?: Partial<PartnerFormValues>;
  baseGroup?: "CUSTOMER" | "SUPPLIER";
  onCancel: () => void;
  onSubmit: (values: PartnerFormValues) => Promise<void>;
}

const DEFAULT_VALUES: PartnerFormValues = {
  code: "",
  name: "",
  partnerType: "CUSTOMER",
  phone: "",
  taxCode: "",
  address: ""
};

export function PartnerModal(props: PartnerModalProps) {
  const { open, loading, mode, title, requirePhone = false, initialValues, baseGroup = "CUSTOMER", onCancel, onSubmit } = props;
  const [form] = Form.useForm<PartnerFormValues>();
  const watchedPartnerType = Form.useWatch("partnerType", form);

  useEffect(() => {
    if (!open) {
      return;
    }
    form.setFieldsValue({
      ...DEFAULT_VALUES,
      partnerType: baseGroup,
      ...initialValues
    });
  }, [baseGroup, form, initialValues, open]);

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    await onSubmit(values);
    form.resetFields();
  };

  const isCustomerBase = baseGroup === "CUSTOMER";
  const defaultPartnerType: PartnerTypeValue = isCustomerBase ? "CUSTOMER" : "SUPPLIER";
  const counterpartyCheckboxLabel = isCustomerBase ? "Là nhà cung cấp" : "Là khách hàng";
  const isBothRole = watchedPartnerType === "BOTH";

  return (
    <Modal
      open={open}
      title={
        <Space direction="vertical" size={2}>
          <Typography.Text strong style={{ fontSize: 18 }}>
            {title ?? (mode === "create" ? (isCustomerBase ? "Thông tin khách hàng" : "Thông tin nhà cung cấp") : "Cập nhật đối tác")}
          </Typography.Text>
          <Typography.Text type="secondary">
            Khai báo đầy đủ thông tin để dùng xuyên suốt trên chứng từ, báo giá và báo cáo công nợ.
          </Typography.Text>
        </Space>
      }
      okText={mode === "create" ? "Cất và thêm" : "Lưu"}
      cancelText="Hủy"
      confirmLoading={loading}
      onCancel={handleCancel}
      onOk={() => void handleSubmit()}
      maskClosable={false}
      destroyOnClose={false}
      width={960}
      className="partner-entry-modal"
    >
      <Form<PartnerFormValues> form={form} layout="vertical">
        <Form.Item name="partnerType" hidden rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Row gutter={16} align="middle" style={{ marginBottom: 8 }}>
          <Col xs={24} md={12}>
            <Space size={20}>
              <Typography.Text strong>Loại đối tượng</Typography.Text>
              <Typography.Text>
                {isBothRole
                  ? "Khách hàng và Nhà cung cấp"
                  : isCustomerBase
                    ? "Khách hàng"
                    : "Nhà cung cấp"}
              </Typography.Text>
            </Space>
          </Col>
          <Col xs={24} md={12} style={{ textAlign: "right" }}>
            <Checkbox
              checked={isBothRole}
              onChange={(event) => {
                form.setFieldValue("partnerType", event.target.checked ? "BOTH" : defaultPartnerType);
              }}
            >
              {counterpartyCheckboxLabel}
            </Checkbox>
          </Col>
        </Row>

        <div className="partner-entry-section">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Mã số thuế" name="taxCode">
                <Input placeholder="Nhập mã số thuế" maxLength={64} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label={isCustomerBase ? "Mã khách hàng" : "Mã nhà cung cấp"}
                name="code"
              >
                <Input
                  placeholder={mode === "create" ? "Để trống để hệ thống tự sinh" : (isCustomerBase ? "Ví dụ: KH001" : "Ví dụ: NCC001")}
                  maxLength={64}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                label={isCustomerBase ? "Tên khách hàng" : "Tên nhà cung cấp"}
                name="name"
                rules={[{ required: true, message: "Vui lòng nhập tên đối tác" }]}
              >
                <Input placeholder={isCustomerBase ? "Nhập tên khách hàng" : "Nhập tên nhà cung cấp"} maxLength={255} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                label="Điện thoại"
                name="phone"
                rules={requirePhone ? [{ required: true, message: "Vui lòng nhập số điện thoại" }] : undefined}
              >
                <Input placeholder="Nhập số điện thoại" maxLength={32} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="Địa chỉ" name="address">
                <Input.TextArea rows={4} placeholder="Nhập địa chỉ giao dịch" maxLength={1000} />
              </Form.Item>
            </Col>
          </Row>
        </div>
      </Form>
    </Modal>
  );
}
