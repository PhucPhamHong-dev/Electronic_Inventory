import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Row,
  Space,
  Table,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { AppSelect } from "./common/AppSelect";
import { fetchProducts } from "../services/masterData.api";
import { createSalesReturnVoucher, fetchVoucherById, fetchVouchers } from "../services/voucher.api";
import type {
  CreateVoucherPayload,
  ProductOption,
  SalesReturnSettlementMode,
  VoucherDetail,
  VoucherHistoryItem,
  VoucherTransactionResult
} from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";

interface SalesReturnDrawerProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: VoucherTransactionResult) => void;
}

interface SalesReturnFormValues {
  voucherDate: Dayjs;
  originalVoucherId?: string;
  partnerId?: string;
  customerName?: string;
  customerAddress?: string;
  customerTaxCode?: string;
  note?: string;
  voucherNo: string;
}

interface SalesReturnRow {
  key: string;
  productId: string;
  skuCode: string;
  productName: string;
  unitName: string;
  warehouseName: string;
  maxQuantity: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface SalesVoucherOption {
  value: string;
  label: string;
  searchText: string;
  voucherNo: string;
  partnerName: string;
  totalNetAmount: number;
}

interface InputNumberFormatterInfo {
  userTyping: boolean;
  input: string;
}

function formatInputNumberValue(value: string | number | undefined, info: InputNumberFormatterInfo): string {
  if (info.userTyping) {
    return info.input;
  }
  if (value === undefined || value === null || value === "") {
    return "";
  }

  const normalized = String(value).replace(/,/g, "");
  const [integerPart, decimalPart] = normalized.split(".");
  const formattedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimalPart !== undefined ? `${formattedIntegerPart}.${decimalPart}` : formattedIntegerPart;
}

function parseInputNumberValue(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.replace(/,/g, "").replace(/[^\d.-]/g, "");
}

function handleInputNumberFocus(event: FocusEvent<HTMLInputElement>): void {
  event.target.select();
}

function buildRowsFromOriginalVoucher(detail: VoucherDetail, products: ProductOption[]): SalesReturnRow[] {
  const productMap = new Map(products.map((item) => [item.id, item]));
  return detail.items.map((item) => ({
    key: item.id,
    productId: item.productId,
    skuCode: item.skuCode,
    productName: item.productName,
    unitName: item.unitName,
    warehouseName: productMap.get(item.productId)?.warehouseName ?? "Kho mặc định",
    maxQuantity: item.quantity,
    quantity: 0,
    unitPrice: item.netPrice,
    lineTotal: 0
  }));
}

export function SalesReturnDrawer(props: SalesReturnDrawerProps) {
  const { open, onClose, onSuccess } = props;
  const [form] = Form.useForm<SalesReturnFormValues>();
  const [rows, setRows] = useState<SalesReturnRow[]>([]);
  const [settlementMode, setSettlementMode] = useState<SalesReturnSettlementMode>("DEBT_REDUCTION");
  const [isInventoryInput, setIsInventoryInput] = useState(true);
  const [saving, setSaving] = useState(false);
  const selectedOriginalVoucherId = Form.useWatch("originalVoucherId", form);

  const productsQuery = useQuery({
    queryKey: ["sales-return-products"],
    queryFn: () => fetchProducts({ page: 1, pageSize: 200 }),
    enabled: open
  });

  const originalSalesQuery = useQuery({
    queryKey: ["sales-return-source-vouchers"],
    queryFn: () =>
      fetchVouchers({
        page: 1,
        pageSize: 100,
        type: "SALES",
        startDate: dayjs().subtract(12, "month").format("YYYY-MM-DD"),
        endDate: dayjs().endOf("day").format("YYYY-MM-DD")
      }),
    enabled: open
  });

  const originalVoucherDetailQuery = useQuery({
    queryKey: ["sales-return-source-detail", selectedOriginalVoucherId],
    queryFn: () => fetchVoucherById(selectedOriginalVoucherId as string),
    enabled: open && Boolean(selectedOriginalVoucherId)
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateVoucherPayload) => createSalesReturnVoucher(payload)
  });

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setRows([]);
      setSettlementMode("DEBT_REDUCTION");
      setIsInventoryInput(true);
      setSaving(false);
      return;
    }

    form.setFieldsValue({
      voucherDate: dayjs(),
      voucherNo: "Tự sinh khi lưu"
    });
  }, [form, open]);

  useEffect(() => {
    if (!originalVoucherDetailQuery.data || !productsQuery.data?.items) {
      return;
    }

    const detail = originalVoucherDetailQuery.data;
    form.setFieldsValue({
      partnerId: detail.partnerId ?? undefined,
      customerName: detail.partnerName ?? "",
      customerAddress: detail.partnerAddress ?? "",
      customerTaxCode: detail.partnerTaxCode ?? "",
      note: detail.partnerName ? `Trả lại hàng bán từ chứng từ ${detail.voucherNo ?? detail.id}` : "Trả lại hàng bán"
    });
    setRows(buildRowsFromOriginalVoucher(detail, productsQuery.data.items));
  }, [form, originalVoucherDetailQuery.data, productsQuery.data?.items]);

  const originalVoucherOptions = useMemo<SalesVoucherOption[]>(
    () =>
      (originalSalesQuery.data?.items ?? []).map((item: VoucherHistoryItem) => ({
        value: item.id,
        label: `${item.voucherNo ?? item.id.slice(0, 8)} - ${item.partnerName ?? "Khách lẻ"}`,
        searchText: `${item.voucherNo ?? ""} ${item.partnerName ?? ""}`.toLowerCase(),
        voucherNo: item.voucherNo ?? item.id.slice(0, 8),
        partnerName: item.partnerName ?? "Khách lẻ",
        totalNetAmount: item.totalNetAmount
      })),
    [originalSalesQuery.data?.items]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          acc.totalAmount += row.lineTotal;
          acc.totalNetAmount += row.lineTotal;
          return acc;
        },
        { totalAmount: 0, totalTaxAmount: 0, totalNetAmount: 0 }
      ),
    [rows]
  );

  const updateRow = (rowKey: string, quantity: number) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== rowKey) {
          return row;
        }
        const normalizedQuantity = Math.max(0, Math.min(quantity, row.maxQuantity));
        return {
          ...row,
          quantity: normalizedQuantity,
          lineTotal: Number((normalizedQuantity * row.unitPrice).toFixed(2))
        };
      })
    );
  };

  const columns: ColumnsType<SalesReturnRow> = [
    {
      title: "Mã hàng",
      dataIndex: "skuCode",
      key: "skuCode",
      width: 140
    },
    {
      title: "Tên hàng",
      dataIndex: "productName",
      key: "productName",
      ellipsis: true
    },
    {
      title: "ĐVT",
      dataIndex: "unitName",
      key: "unitName",
      align: "center",
      width: 90
    },
    {
      title: "Kho nhập",
      dataIndex: "warehouseName",
      key: "warehouseName",
      width: 150
    },
    {
      title: "Số lượng trả lại",
      dataIndex: "quantity",
      key: "quantity",
      width: 150,
      align: "right",
      render: (value: number, record) => (
        <InputNumber
          value={value}
          min={0}
          max={record.maxQuantity}
          controls={false}
          style={{ width: "100%" }}
          formatter={formatInputNumberValue}
          parser={parseInputNumberValue}
          onFocus={handleInputNumberFocus}
          onChange={(nextValue) => updateRow(record.key, Number(nextValue ?? 0))}
        />
      )
    },
    {
      title: "Đơn giá",
      dataIndex: "unitPrice",
      key: "unitPrice",
      align: "right",
      width: 140,
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "Thành tiền",
      dataIndex: "lineTotal",
      key: "lineTotal",
      align: "right",
      width: 160,
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    }
  ];

  const handleSave = async () => {
    try {
      await form.validateFields();
      const values = form.getFieldsValue();
      const validItems = rows
        .filter((row) => row.quantity > 0)
        .map((row) => ({
          productId: row.productId,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          discountRate: 0,
          taxRate: 0
        }));

      if (!values.partnerId) {
        throw new Error("Vui lòng chọn chứng từ bán hàng gốc.");
      }
      if (!values.originalVoucherId) {
        throw new Error("Vui lòng chọn chứng từ bán hàng.");
      }
      if (validItems.length === 0) {
        throw new Error("Vui lòng nhập ít nhất một số lượng trả lại.");
      }

      setSaving(true);
      const result = await createMutation.mutateAsync({
        voucherDate: values.voucherDate?.toISOString(),
        note: values.note,
        partnerId: values.partnerId,
        originalVoucherId: values.originalVoucherId,
        settlementMode,
        isInventoryInput,
        items: validItems
      });

      message.success(
        result.linkedCounterVoucherId
          ? "Đã lưu phiếu trả lại hàng bán và sinh phiếu chi đối ứng."
          : "Đã lưu phiếu trả lại hàng bán."
      );
      onSuccess(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Không thể lưu phiếu trả lại hàng bán.";
      message.error(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      width="100%"
      destroyOnClose
      open={open}
      title={<span className="sales-voucher-drawer-title">Trả lại hàng bán</span>}
      onClose={onClose}
      rootClassName="sales-voucher-drawer sales-return-drawer"
      styles={{ body: { paddingBottom: 12 } }}
      footer={
        <div className="sales-voucher-sticky-footer">
          <Button onClick={onClose}>Hủy</Button>
          <Space>
            <Button
              type="primary"
              style={{ background: "#0070c0", borderColor: "#0070c0" }}
              loading={saving}
              onClick={() => void handleSave()}
            >
              Lưu
            </Button>
          </Space>
        </div>
      }
    >
      <div className="sales-voucher-screen sales-return-screen">
        <div className="sales-voucher-topbar">
          <Space wrap className="sales-voucher-payment-row">
            <Radio.Group
              value={settlementMode}
              onChange={(event) => setSettlementMode(event.target.value as SalesReturnSettlementMode)}
              options={[
                { label: "Giảm trừ công nợ", value: "DEBT_REDUCTION" },
                { label: "Trả lại tiền mặt", value: "CASH_REFUND" }
              ]}
            />
            <Checkbox checked={isInventoryInput} onChange={(event) => setIsInventoryInput(event.target.checked)}>
              Kiêm phiếu nhập kho
            </Checkbox>
          </Space>
          <div className="sales-voucher-topbar-total">
            <span>Tổng tiền trả lại khách</span>
            <strong>{formatCurrency(totals.totalNetAmount)}</strong>
          </div>
        </div>
        <div className="sales-voucher-mode-tabs">
          <button type="button" className="sales-voucher-mode-tab sales-voucher-mode-tab-active">
            Trả lại hàng bán
          </button>
        </div>

        <Form<SalesReturnFormValues> form={form} layout="vertical" className="sales-voucher-form">
          <div className="sales-voucher-meta-layout">
            <div className="sales-voucher-panel sales-voucher-panel-main">
              <div className="sales-voucher-panel-title">Đối tượng</div>
              <Row gutter={12}>
                <Col xs={24}>
                  <Form.Item
                    label="Chọn từ chứng từ bán hàng"
                    name="originalVoucherId"
                    rules={[{ required: true, message: "Bắt buộc chọn chứng từ bán hàng" }]}
                  >
                    <AppSelect
                      showSearch
                      placeholder="Chọn chứng từ bán hàng gốc"
                      loading={originalSalesQuery.isFetching}
                      options={originalVoucherOptions}
                      optionRender={(option) => {
                        const data = option.data as SalesVoucherOption;
                        return (
                          <div className="sales-voucher-product-option">
                            <span>{`${data.voucherNo} - ${data.partnerName}`}</span>
                            <span className="sales-voucher-product-stock">{formatCurrency(data.totalNetAmount)}</span>
                          </div>
                        );
                      }}
                      filterOption={(input, option) =>
                        ((option as SalesVoucherOption | undefined)?.searchText ?? "").includes(input.toLowerCase())
                      }
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="Mã khách hàng" name="partnerId">
                    <Input readOnly />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="Tên khách hàng" name="customerName">
                    <Input readOnly />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item label="Mã số thuế" name="customerTaxCode">
                    <Input readOnly />
                  </Form.Item>
                </Col>
                <Col xs={24} md={14}>
                  <Form.Item label="Địa chỉ" name="customerAddress">
                    <Input readOnly />
                  </Form.Item>
                </Col>
                <Col xs={24} md={10}>
                  <Form.Item label="Ngày chứng từ" name="voucherDate" rules={[{ required: true, message: "Bắt buộc" }]}>
                    <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
                  </Form.Item>
                </Col>
                <Col xs={24}>
                  <Form.Item label="Diễn giải" name="note">
                    <Input placeholder="Nhập diễn giải cho phiếu trả lại" />
                  </Form.Item>
                </Col>
              </Row>
            </div>

            <div className="sales-voucher-panel sales-voucher-panel-side">
              <div className="sales-voucher-panel-title">Chứng từ</div>
              <Form.Item label="Số chứng từ" name="voucherNo">
                <Input readOnly />
              </Form.Item>
              <div className="sales-return-side-hint">
                <Typography.Text type="secondary">
                  Chọn chứng từ bán hàng gốc để hệ thống tự đổ danh sách hàng hóa, đơn vị tính và đơn giá.
                </Typography.Text>
              </div>
            </div>
          </div>
        </Form>

        <div className="sales-voucher-grid-section">
          <Table<SalesReturnRow>
            rowKey="key"
            size="small"
            bordered
            className="voucher-detail-table sales-voucher-detail-table"
            pagination={false}
            columns={columns}
            dataSource={rows}
            loading={originalVoucherDetailQuery.isFetching}
            scroll={{ x: 1100, y: 320 }}
          />
        </div>

        <div className="sales-voucher-table-footer">
          <Space wrap>
            <Typography.Text type="secondary">
              Hệ thống tự kế thừa hàng hóa từ chứng từ bán hàng gốc. Bạn chỉ cần nhập số lượng trả lại.
            </Typography.Text>
          </Space>

          <div className="voucher-summary-block sales-voucher-summary-block">
            <Row justify="space-between" className="voucher-summary-row">
              <Typography.Text>Cộng tiền hàng</Typography.Text>
              <Typography.Text className="voucher-summary-value">{formatCurrency(totals.totalAmount)}</Typography.Text>
            </Row>
            <Row justify="space-between" className="voucher-summary-row">
              <Typography.Text>Tiền thuế GTGT</Typography.Text>
              <Typography.Text className="voucher-summary-value">{formatCurrency(totals.totalTaxAmount)}</Typography.Text>
            </Row>
            <Row justify="space-between" className="voucher-summary-row voucher-summary-row-total">
              <Typography.Text strong>Tổng tiền trả lại khách</Typography.Text>
              <Typography.Text strong className="voucher-summary-value voucher-summary-value-total">
                {formatCurrency(totals.totalNetAmount)}
              </Typography.Text>
            </Row>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
