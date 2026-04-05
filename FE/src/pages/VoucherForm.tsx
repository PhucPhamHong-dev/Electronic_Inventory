import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  notification
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import debounce from "lodash.debounce";
import { PlusOutlined, PrinterOutlined } from "@ant-design/icons";
import { AppSelect } from "../components/common/AppSelect";
import { Protected } from "../components/Protected";
import { QuickAddPartnerModal, type QuickAddPartnerPayload } from "../components/QuickAddPartnerModal";
import { useHotkeys } from "../hooks/useHotkeys";
import { usePermission } from "../hooks/usePermission";
import { createPartner, fetchPartners, fetchProducts } from "../services/masterData.api";
import { bookVoucher, createPurchaseVoucher, createSalesVoucher, downloadVoucherPdf } from "../services/voucher.api";
import type { CreateVoucherPayload, PartnerOption, ProductOption, VoucherTransactionResult, VoucherType } from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";

interface VoucherRow {
  key: string;
  productId?: string;
  skuCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
  cogs: number;
}

interface VoucherFormValues {
  voucherNo: string;
  voucherType: VoucherType;
  voucherDate: dayjs.Dayjs;
  partnerId?: string;
  note?: string;
  isPaidImmediately?: boolean;
}

interface TotalsSnapshot {
  totalQuantity: number;
  totalAmount: number;
  totalDiscount: number;
  totalTaxAmount: number;
  totalNetAmount: number;
}

interface InputNumberFormatterInfo {
  userTyping: boolean;
  input: string;
}

function createEmptyRow(): VoucherRow {
  return {
    key: crypto.randomUUID(),
    productId: undefined,
    skuCode: "",
    productName: "",
    unit: "Cái",
    quantity: 0,
    unitPrice: 0,
    discountRate: 0,
    taxRate: 0,
    grossAmount: 0,
    discountAmount: 0,
    taxAmount: 0,
    lineTotal: 0,
    cogs: 0
  };
}

function recalculateRow(input: VoucherRow): VoucherRow {
  const quantity = Number(input.quantity) || 0;
  const unitPrice = Number(input.unitPrice) || 0;
  const discountRate = Number(input.discountRate) || 0;
  const taxRate = Number(input.taxRate) || 0;

  const grossAmount = quantity * unitPrice;
  const discountAmount = grossAmount * (discountRate / 100);
  const taxableAmount = grossAmount - discountAmount;
  const taxAmount = taxableAmount * (taxRate / 100);
  const lineTotal = taxableAmount + taxAmount;

  return {
    ...input,
    quantity,
    unitPrice,
    discountRate,
    taxRate,
    grossAmount: Number(grossAmount.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    lineTotal: Number(lineTotal.toFixed(2)),
    cogs: Number((quantity * unitPrice).toFixed(2))
  };
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

function focusNextEditor(currentElement: HTMLElement): void {
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-voucher-editor='true']"));
  const currentIndex = elements.findIndex((element) => element === currentElement);
  if (currentIndex >= 0 && currentIndex + 1 < elements.length) {
    elements[currentIndex + 1].focus();
  }
}

function inferVoucherTypeByRoute(pathname: string, query: URLSearchParams): VoucherType {
  if (pathname === "/purchase") {
    return "PURCHASE";
  }
  if (pathname === "/sales") {
    return "SALES";
  }

  const queryType = query.get("type");
  if (queryType === "PURCHASE" || queryType === "SALES" || queryType === "CONVERSION") {
    return queryType;
  }
  return "SALES";
}

export function VoucherFormPage() {
  const [form] = Form.useForm<VoucherFormValues>();
  const queryClient = useQueryClient();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const canViewCostPrice = usePermission("view_cost_price");

  const [rows, setRows] = useState<VoucherRow[]>([createEmptyRow()]);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [productKeyword, setProductKeyword] = useState("");
  const [savedVoucher, setSavedVoucher] = useState<VoucherTransactionResult | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const routeVoucherType = inferVoucherTypeByRoute(location.pathname, query);

  useEffect(() => {
    form.setFieldsValue({
      voucherType: routeVoucherType,
      isPaidImmediately: false
    });
  }, [form, routeVoucherType]);

  const debouncedProductSearch = useMemo(
    () =>
      debounce((keyword: string) => {
        setProductKeyword(keyword);
      }, 300),
    []
  );

  const partnersQuery = useQuery({
    queryKey: ["voucher-form-partners"],
    queryFn: () => fetchPartners({ page: 1, pageSize: 200 })
  });

  const productsQuery = useQuery({
    queryKey: ["voucher-form-products", productKeyword],
    queryFn: () => fetchProducts({ page: 1, pageSize: 200, keyword: productKeyword })
  });

  const quickAddPartnerMutation = useMutation({
    mutationFn: async (payload: QuickAddPartnerPayload) => {
      return createPartner({
        name: payload.name,
        phone: payload.phone,
        partnerType: payload.partnerType,
        taxCode: payload.taxCode,
        address: payload.address
      });
    },
    onSuccess: async (createdPartner) => {
      setQuickAddOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["voucher-form-partners"] });
      form.setFieldValue("partnerId", createdPartner.id);
      notification.success({
        message: "Thêm khách hàng thành công!"
      });
    }
  });

  const productMap = useMemo(() => {
    const result = new Map<string, ProductOption>();
    (productsQuery.data?.items ?? []).forEach((item) => {
      result.set(item.id, item);
    });
    return result;
  }, [productsQuery.data?.items]);

  const createVoucherMutation = useMutation({
    mutationFn: async (payload: CreateVoucherPayload) => {
      const voucherType = form.getFieldValue("voucherType");
      if (voucherType === "PURCHASE") {
        return createPurchaseVoucher(payload);
      }
      return createSalesVoucher(payload);
    },
    onSuccess: (result) => {
      setSavedVoucher(result);
      form.setFieldValue("voucherNo", result.voucherNo ?? result.voucherId);
      queryClient.setQueryData(["voucher-form-current"], result);
      notification.success({
        message: "Lưu phiếu thành công",
        description: `Số phiếu: ${result.voucherNo ?? result.voucherId}`
      });
    }
  });

  const bookMutation = useMutation({
    mutationFn: (voucherId: string) => bookVoucher(voucherId),
    onMutate: async (voucherId) => {
      const previous = queryClient.getQueryData<VoucherTransactionResult>(["voucher-form-current"]);
      if (previous && previous.voucherId === voucherId) {
        queryClient.setQueryData<VoucherTransactionResult>(["voucher-form-current"], {
          ...previous,
          status: "BOOKED"
        });
      }
      return { previous };
    },
    onError: (_error, _voucherId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["voucher-form-current"], context.previous);
      }
    },
    onSuccess: (result) => {
      setSavedVoucher(result);
      queryClient.setQueryData(["voucher-form-current"], result);
      notification.success({
        message: "Ghi sổ thành công",
        description: `Phiếu ${result.voucherNo ?? result.voucherId} đã được ghi sổ`
      });
    }
  });

  const printMutation = useMutation({
    mutationFn: ({
      voucherId,
      voucherNo,
      voucherType
    }: {
      voucherId: string;
      voucherNo: string;
      voucherType: VoucherType;
    }) => downloadVoucherPdf(voucherId, voucherNo, voucherType)
  });

  const totals = useMemo<TotalsSnapshot>(() => {
    return rows.reduce(
      (acc, row) => {
        acc.totalQuantity += row.quantity;
        acc.totalAmount += row.grossAmount;
        acc.totalDiscount += row.discountAmount;
        acc.totalTaxAmount += row.taxAmount;
        acc.totalNetAmount += row.lineTotal;
        return acc;
      },
      {
        totalQuantity: 0,
        totalAmount: 0,
        totalDiscount: 0,
        totalTaxAmount: 0,
        totalNetAmount: 0
      }
    );
  }, [rows]);

  const updateRow = (rowKey: string, patch: Partial<VoucherRow>) => {
    setRows((previous) =>
      previous.map((row) => {
        if (row.key !== rowKey) {
          return row;
        }
        return recalculateRow({
          ...row,
          ...patch
        });
      })
    );
  };

  const addRow = () => {
    setRows((previous) => [...previous, createEmptyRow()]);
  };

  const deleteSelectedRow = () => {
    if (!selectedRowKey) {
      return;
    }
    setRows((previous) => {
      const filtered = previous.filter((row) => row.key !== selectedRowKey);
      return filtered.length > 0 ? filtered : [createEmptyRow()];
    });
    setSelectedRowKey(null);
  };

  const buildPayload = (): CreateVoucherPayload => {
    const values = form.getFieldsValue();
    const voucherType = values.voucherType;
    return {
      voucherDate: values.voucherDate?.toISOString(),
      partnerId: values.partnerId,
      note: values.note,
      isPaidImmediately: voucherType === "SALES" ? Boolean(values.isPaidImmediately) : false,
      items: rows
        .filter((row) => row.productId && row.quantity > 0)
        .map((row) => ({
          productId: row.productId as string,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          discountRate: row.discountRate,
          taxRate: row.taxRate,
          discountAmount: row.discountAmount,
          taxAmount: row.taxAmount
        }))
    };
  };

  const handleSaveDraft = async () => {
    await form.validateFields();
    const payload = buildPayload();
    if (!payload.items || payload.items.length === 0) {
      notification.warning({
        message: "Thiếu dữ liệu",
        description: "Vui lòng thêm ít nhất một dòng hàng hóa."
      });
      return;
    }
    await createVoucherMutation.mutateAsync(payload);
  };

  const handleBook = async () => {
    if (!savedVoucher?.voucherId) {
      await handleSaveDraft();
    }
    const targetVoucher = queryClient.getQueryData<VoucherTransactionResult>(["voucher-form-current"]) ?? savedVoucher;
    if (!targetVoucher?.voucherId) {
      return;
    }
    await bookMutation.mutateAsync(targetVoucher.voucherId);
  };

  const handlePrint = async () => {
    if (!savedVoucher?.voucherId) {
      notification.warning({
        message: "Chưa có phiếu",
        description: "Vui lòng lưu phiếu trước khi in."
      });
      return;
    }
    const currentVoucherType = form.getFieldValue("voucherType");
    const printableType: VoucherType = currentVoucherType === "PURCHASE" ? "PURCHASE" : "SALES";
    await printMutation.mutateAsync({
      voucherId: savedVoucher.voucherId,
      voucherNo: savedVoucher.voucherNo ?? savedVoucher.voucherId,
      voucherType: printableType
    });
  };

  useHotkeys([
    { key: "s", ctrl: true, handler: () => void handleSaveDraft() },
    { key: "F9", handler: () => void handleBook() },
    { key: "p", ctrl: true, handler: () => void handlePrint() },
    { key: "F2", handler: addRow },
    { key: "Delete", handler: deleteSelectedRow }
  ]);

  const columns: ColumnsType<VoucherRow> = [
    {
      title: "STT",
      key: "stt",
      align: "center",
      width: 56,
      render: (_value, _record, index) => index + 1
    },
    {
      title: "Tên hàng",
      dataIndex: "productId",
      key: "productId",
      align: "left",
      width: 250,
      render: (_value, record) => (
        <AppSelect
          value={record.productId}
          showSearch
          filterOption={false}
          placeholder="Chọn hàng hóa"
          options={(productsQuery.data?.items ?? []).map((item: ProductOption) => ({
            value: item.id,
            label: `${item.skuCode} - ${item.name}`
          }))}
          onSearch={(keyword) => {
            debouncedProductSearch(keyword);
          }}
          onChange={(productId) => {
            const selected = productMap.get(productId);
            updateRow(record.key, {
              productId,
              skuCode: selected?.skuCode ?? "",
              productName: selected?.name ?? "",
              unitPrice: selected?.costPrice ?? 0
            });
          }}
          data-voucher-editor="true"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              focusNextEditor(event.currentTarget as HTMLElement);
            }
          }}
        />
      )
    },
    {
      title: "Đơn vị",
      dataIndex: "unit",
      key: "unit",
      align: "center",
      width: 90,
      render: (value: string, record) => (
        <Input
          value={value}
          onChange={(event) => {
            updateRow(record.key, { unit: event.target.value });
          }}
          data-voucher-editor="true"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              focusNextEditor(event.currentTarget as HTMLElement);
            }
          }}
        />
      )
    },
    {
      title: "Số lượng",
      dataIndex: "quantity",
      key: "quantity",
      align: "right",
      width: 110,
      render: (value: number, record) => (
        <InputNumber
          value={value}
          min={0}
          controls={false}
          style={{ width: "100%" }}
          formatter={formatInputNumberValue}
          parser={parseInputNumberValue}
          onFocus={handleInputNumberFocus}
          onChange={(nextValue) => {
            updateRow(record.key, { quantity: Number(nextValue ?? 0) });
          }}
          data-voucher-editor="true"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              focusNextEditor(event.currentTarget as HTMLElement);
            }
          }}
        />
      )
    },
    {
      title: "Đơn giá",
      dataIndex: "unitPrice",
      key: "unitPrice",
      align: "right",
      width: 130,
      render: (value: number, record) => (
        <InputNumber
          value={value}
          min={0}
          controls={false}
          style={{ width: "100%" }}
          formatter={formatInputNumberValue}
          parser={parseInputNumberValue}
          onFocus={handleInputNumberFocus}
          onChange={(nextValue) => {
            updateRow(record.key, { unitPrice: Number(nextValue ?? 0) });
          }}
          data-voucher-editor="true"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              focusNextEditor(event.currentTarget as HTMLElement);
            }
          }}
        />
      )
    },
    {
      title: "% CK",
      dataIndex: "discountRate",
      key: "discountRate",
      align: "right",
      width: 90,
      render: (value: number, record) => (
        <InputNumber
          value={value}
          min={0}
          max={100}
          controls={false}
          style={{ width: "100%" }}
          formatter={formatInputNumberValue}
          parser={parseInputNumberValue}
          onFocus={handleInputNumberFocus}
          onChange={(nextValue) => {
            updateRow(record.key, { discountRate: Number(nextValue ?? 0) });
          }}
          data-voucher-editor="true"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              focusNextEditor(event.currentTarget as HTMLElement);
            }
          }}
        />
      )
    },
    {
      title: "% Thuế",
      dataIndex: "taxRate",
      key: "taxRate",
      align: "right",
      width: 95,
      render: (value: number, record) => (
        <InputNumber
          value={value}
          min={0}
          max={100}
          controls={false}
          style={{ width: "100%" }}
          formatter={formatInputNumberValue}
          parser={parseInputNumberValue}
          onFocus={handleInputNumberFocus}
          onChange={(nextValue) => {
            updateRow(record.key, { taxRate: Number(nextValue ?? 0) });
          }}
          data-voucher-editor="true"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              focusNextEditor(event.currentTarget as HTMLElement);
            }
          }}
        />
      )
    },
    {
      title: "Thành tiền",
      dataIndex: "grossAmount",
      key: "grossAmount",
      align: "right",
      width: 140,
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "Tiền CK",
      dataIndex: "discountAmount",
      key: "discountAmount",
      align: "right",
      width: 120,
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "Tiền thuế",
      dataIndex: "taxAmount",
      key: "taxAmount",
      align: "right",
      width: 120,
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "Thanh toán",
      dataIndex: "lineTotal",
      key: "lineTotal",
      align: "right",
      width: 140,
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "Giá vốn",
      dataIndex: "cogs",
      key: "cogs",
      align: "right",
      width: 140,
      render: (value: number) => <Protected viewCostPrice>{formatCurrency(value)}</Protected>
    }
  ];

  const actionLoading = createVoucherMutation.isPending || bookMutation.isPending || printMutation.isPending;
  const voucherType = Form.useWatch("voucherType", form);

  return (
    <div className="voucher-form-screen">
      <div className="voucher-form-header-zone">
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Chứng từ nhập / xuất kho
        </Typography.Title>
        <Form<VoucherFormValues>
          form={form}
          layout="vertical"
          className="voucher-master-form"
          initialValues={{
            voucherNo: "Tự sinh khi lưu",
            voucherType: routeVoucherType,
            voucherDate: dayjs(),
            isPaidImmediately: false
          }}
        >
          <Row gutter={[12, 0]}>
            <Col xs={24} md={8}>
              <Form.Item
                label="Số chứng từ"
                name="voucherNo"
                rules={[{ required: true, message: "Bắt buộc có số chứng từ" }]}
              >
                <Input style={{ fontWeight: 700 }} readOnly />
              </Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item label="Ngày chứng từ" name="voucherDate" rules={[{ required: true }]}>
                <DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={5}>
              <Form.Item label="Loại phiếu" name="voucherType" rules={[{ required: true }]}>
                <AppSelect
                  options={[
                    { label: "Phiếu nhập", value: "PURCHASE" },
                    { label: "Phiếu xuất", value: "SALES" }
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="Trạng thái">
                {savedVoucher ? (
                  <Tag color={savedVoucher.status === "BOOKED" ? "green" : "orange"}>
                    {savedVoucher.status === "BOOKED" ? "Đã ghi sổ" : "Lưu nháp"}
                  </Tag>
                ) : (
                  <Tag color="default">Chưa lưu</Tag>
                )}
              </Form.Item>
            </Col>
            <Col xs={24} md={10}>
              <Form.Item label="Khách hàng / NCC" name="partnerId">
                <AppSelect
                  showSearch
                  allowClear
                  optionFilterProp="label"
                  placeholder="Chọn khách hàng/NCC"
                  options={(partnersQuery.data?.items ?? []).map((item: PartnerOption) => ({
                    value: item.id,
                    label: `${item.code} - ${item.name}`
                  }))}
                  dropdownRender={(menu) => (
                    <>
                      {menu}
                      <Divider style={{ margin: "8px 0" }} />
                      <Button
                        type="text"
                        icon={<PlusOutlined />}
                        block
                        onClick={() => {
                          setQuickAddOpen(true);
                        }}
                      >
                        Thêm khách hàng/NCC mới
                      </Button>
                    </>
                  )}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={14}>
              <Form.Item label="Diễn giải" name="note">
                <Input placeholder="Nhập diễn giải chứng từ" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </div>

      <div className="voucher-form-grid-zone">
        <Space style={{ marginBottom: 8 }}>
          <Button icon={<PlusOutlined />} onClick={addRow}>
            Thêm dòng (F2)
          </Button>
          <Typography.Text type="secondary">
            Phím tắt: Ctrl+S (Lưu), F9 (Ghi sổ), Ctrl+P (In), Delete (Xóa dòng)
          </Typography.Text>
        </Space>

        <Table<VoucherRow>
          className="voucher-detail-table"
          size="small"
          bordered
          sticky
          rowKey="key"
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ y: 360, x: 1700 }}
          rowSelection={{
            type: "radio",
            selectedRowKeys: selectedRowKey ? [selectedRowKey] : [],
            onChange: (keys) => {
              setSelectedRowKey((keys[0] as string) ?? null);
            }
          }}
          rowClassName={(_record, index) => (index % 2 === 0 ? "voucher-grid-row-even" : "voucher-grid-row-odd")}
          onRow={(record) => ({
            onClick: () => setSelectedRowKey(record.key)
          })}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={3} align="right">
                  <Typography.Text strong>Tổng số lượng</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <Typography.Text strong>{formatNumber(totals.totalQuantity)}</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} colSpan={9} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
        <div className="voucher-summary-block-wrap">
          <div className="voucher-summary-block">
            <Row justify="space-between" className="voucher-summary-row">
              <Typography.Text>Cộng tiền hàng</Typography.Text>
              <Typography.Text className="voucher-summary-value">{formatCurrency(totals.totalAmount)}</Typography.Text>
            </Row>
            <Row justify="space-between" className="voucher-summary-row">
              <Typography.Text>Tiền thuế GTGT</Typography.Text>
              <Typography.Text className="voucher-summary-value">{formatCurrency(totals.totalTaxAmount)}</Typography.Text>
            </Row>
            <Row justify="space-between" className="voucher-summary-row voucher-summary-row-total">
              <Typography.Text strong>Tổng tiền thanh toán</Typography.Text>
              <Typography.Text strong className="voucher-summary-value voucher-summary-value-total">
                {formatCurrency(totals.totalNetAmount)}
              </Typography.Text>
            </Row>
          </div>
        </div>

        {!canViewCostPrice ? (
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            Quyền xem giá vốn đang bị khóa, cột Giá vốn được ẩn dưới dạng ***
          </Typography.Paragraph>
        ) : null}
      </div>

      <div className="voucher-form-action-footer">
        <Space>
          {voucherType === "SALES" ? (
            <Form.Item name="isPaidImmediately" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Checkbox>Thu tiền ngay</Checkbox>
            </Form.Item>
          ) : null}
        </Space>
        <Space style={{ marginLeft: "auto" }}>
          <Button onClick={() => void handleSaveDraft()} disabled={actionLoading} loading={createVoucherMutation.isPending}>
            Lưu nháp
          </Button>
          <Button icon={<PrinterOutlined />} onClick={() => void handlePrint()} disabled={actionLoading || !savedVoucher} loading={printMutation.isPending}>
            In phiếu
          </Button>
          <Button
            type="primary"
            className="voucher-book-button"
            onClick={() => void handleBook()}
            disabled={actionLoading}
            loading={bookMutation.isPending}
          >
            Ghi sổ
          </Button>
        </Space>
      </div>

      <QuickAddPartnerModal
        open={quickAddOpen}
        loading={quickAddPartnerMutation.isPending}
        onCancel={() => setQuickAddOpen(false)}
        onSubmit={async (payload) => {
          await quickAddPartnerMutation.mutateAsync(payload);
        }}
      />
    </div>
  );
}
