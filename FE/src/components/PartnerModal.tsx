import { Col, Form, Input, Modal, Row } from "antd";
import { useEffect } from "react";
import type { PartnerTypeValue } from "../types";
import { AppSelect } from "./common/AppSelect";

export interface PartnerFormValues {
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
  onCancel: () => void;
  onSubmit: (values: PartnerFormValues) => Promise<void>;
}

const DEFAULT_VALUES: PartnerFormValues = {
  name: "",
  partnerType: "CUSTOMER",
  phone: "",
  taxCode: "",
  address: ""
};

export function PartnerModal(props: PartnerModalProps) {
  const { open, loading, mode, title, requirePhone = false, initialValues, onCancel, onSubmit } = props;
  const [form] = Form.useForm<PartnerFormValues>();

  useEffect(() => {
    if (!open) {
      return;
    }
    form.setFieldsValue({
      ...DEFAULT_VALUES,
      ...initialValues
    });
  }, [form, initialValues, open]);

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    await onSubmit(values);
    form.resetFields();
  };

  return (
    <Modal
      open={open}
      title={title ?? (mode === "create" ? "Thêm đối tác" : "Cập nhật đối tác")}
      okText="Lưu"
      cancelText="Hủy"
      confirmLoading={loading}
      onCancel={handleCancel}
      onOk={() => void handleSubmit()}
      maskClosable={false}
      destroyOnClose={false}
      width={720}
    >
      <Form<PartnerFormValues> form={form} layout="vertical">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="Tên đối tác" name="name" rules={[{ required: true, message: "Vui lòng nhập tên đối tác" }]}>
              <Input placeholder="Nhập tên khách hàng / nhà cung cấp" maxLength={255} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Loại đối tác" name="partnerType" rules={[{ required: true, message: "Vui lòng chọn loại đối tác" }]}>
              <AppSelect
                options={[
                  { value: "CUSTOMER", label: "Khách hàng" },
                  { value: "SUPPLIER", label: "Nhà cung cấp" },
                  { value: "BOTH", label: "Khách hàng & Nhà cung cấp" }
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              label="Số điện thoại"
              name="phone"
              rules={requirePhone ? [{ required: true, message: "Vui lòng nhập số điện thoại" }] : undefined}
            >
              <Input placeholder="Nhập số điện thoại" maxLength={32} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="Mã số thuế" name="taxCode">
              <Input placeholder="Nhập mã số thuế" maxLength={64} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={24}>
            <Form.Item label="Địa chỉ" name="address">
              <Input.TextArea rows={3} placeholder="Nhập địa chỉ" maxLength={1000} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
