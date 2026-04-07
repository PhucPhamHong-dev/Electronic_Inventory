import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Col,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
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
import { PartnerModal, type PartnerFormValues } from "./PartnerModal";
import { createPartner, createProduct, fetchPartners, fetchProducts, updatePartner } from "../services/masterData.api";
import { createQuotation, fetchQuotationById, updateQuotation } from "../services/quotation.api";
import type { PartnerOption, ProductOption, QuotationDetail } from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";

const quotationUnitPriceFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

interface QuotationDrawerProps {
  open: boolean;
  quotationId?: string | null;
  onClose: () => void;
  onSuccess: (detail: QuotationDetail) => void;
}

interface QuotationFormValues {
  partnerId?: string;
  partnerName?: string;
  customerTaxCode?: string;
  customerAddress?: string;
  notes?: string;
  quotationNo?: string;
  quotationDate?: Dayjs;
}

interface QuickProductFormValues {
  skuCode: string;
  name: string;
  unitName?: string;
  sellingPrice?: number;
}

interface ProductSelectOption {
  value: string;
  label: string;
  skuCode: string;
  productName: string;
  stockQuantity: number;
  searchText: string;
}

interface InputNumberFormatterInfo {
  userTyping: boolean;
  input: string;
}

interface QuotationRow {
  key: string;
  productId?: string;
  skuCode?: string;
  productName?: string;
  unitName: string;
  quantity: number;
  price: number;
  discountPercent: number;
  taxPercent: number;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  netAmount: number;
}

function createEmptyRow(): QuotationRow {
  return {
    key: crypto.randomUUID(),
    productId: undefined,
    skuCode: undefined,
    productName: undefined,
    unitName: "",
    quantity: 0,
    price: 0,
    discountPercent: 0,
    taxPercent: 10,
    grossAmount: 0,
    discountAmount: 0,
    taxAmount: 0,
    netAmount: 0
  };
}

function recalculateRow(input: QuotationRow): QuotationRow {
  const quantity = Number(input.quantity) || 0;
  const price = Number(input.price) || 0;
  const discountPercent = Number(input.discountPercent) || 0;
  const taxPercent = Number(input.taxPercent) || 0;
  const grossAmount = quantity * price;
  const discountAmount = grossAmount * (discountPercent / 100);
  const taxableAmount = grossAmount - discountAmount;
  const taxAmount = taxableAmount * (taxPercent / 100);
  const netAmount = taxableAmount + taxAmount;

  return {
    ...input,
    quantity,
    price,
    discountPercent,
    taxPercent,
    grossAmount: Number(grossAmount.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    netAmount: Number(netAmount.toFixed(2))
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

function renderEditableNumberCell(
  value: number,
  onChange: (nextValue: number) => void,
  options?: { max?: number }
) {
  return (
    <div className="sales-voucher-number-editor">
      <InputNumber
        value={value}
        min={0}
        max={options?.max}
        controls={false}
        style={{ width: "100%" }}
        formatter={formatInputNumberValue}
        parser={parseInputNumberValue}
        onFocus={handleInputNumberFocus}
        onChange={(nextValue) => onChange(Number(nextValue ?? 0))}
      />
    </div>
  );
}

function resolveQuotationUnitPrice(product?: ProductOption): number {
  if (!product) {
    return 0;
  }
  if (typeof product.sellingPrice === "number" && product.sellingPrice > 0) {
    return product.sellingPrice;
  }
  if (typeof product.costPrice === "number" && product.costPrice > 0) {
    return product.costPrice;
  }
  return product.sellingPrice ?? product.costPrice ?? 0;
}

export function QuotationDrawer(props: QuotationDrawerProps) {
  const { open, quotationId, onClose, onSuccess } = props;
  const [form] = Form.useForm<QuotationFormValues>();
  const watchedQuotationNo = Form.useWatch("quotationNo", form);
  const [quickProductForm] = Form.useForm<QuickProductFormValues>();
  const [rows, setRows] = useState<QuotationRow[]>([createEmptyRow()]);
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [partnerModalMode, setPartnerModalMode] = useState<"create" | "edit">("create");
  const isEditMode = Boolean(quotationId);
  const selectedPartnerId = Form.useWatch("partnerId", form);

  const partnersQuery = useQuery({
    queryKey: ["quotation-drawer-partners"],
    queryFn: () => fetchPartners({ page: 1, pageSize: 200, group: "CUSTOMER" }),
    enabled: open
  });

  const productsQuery = useQuery({
    queryKey: ["quotation-drawer-products"],
    queryFn: () => fetchProducts({ page: 1, pageSize: 200 }),
    enabled: open
  });

  const detailQuery = useQuery({
    queryKey: ["quotation-drawer-detail", quotationId],
    queryFn: () => fetchQuotationById(quotationId as string),
    enabled: open && Boolean(quotationId)
  });

  const createMutation = useMutation({ mutationFn: createQuotation });
  const updateMutation = useMutation({
    mutationFn: (input: { quotationId: string; payload: Parameters<typeof updateQuotation>[1] }) =>
      updateQuotation(input.quotationId, input.payload)
  });

  const quickCreateProductMutation = useMutation({
    mutationFn: (payload: QuickProductFormValues) =>
      createProduct({
        skuCode: payload.skuCode,
        name: payload.name,
        unitName: payload.unitName,
        sellingPrice: payload.sellingPrice ?? 0
      }),
    onSuccess: async () => {
      message.success("Đã thêm nhanh hàng hóa.");
      setQuickProductOpen(false);
      quickProductForm.resetFields();
      await productsQuery.refetch();
    }
  });

  const createPartnerMutation = useMutation({ mutationFn: createPartner });
  const updatePartnerMutation = useMutation({
    mutationFn: (input: { id: string; payload: Parameters<typeof updatePartner>[1] }) =>
      updatePartner(input.id, input.payload)
  });

  const partnerMap = useMemo(() => {
    const map = new Map<string, PartnerOption>();
    (partnersQuery.data?.items ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [partnersQuery.data?.items]);

  const productMap = useMemo(() => {
    const map = new Map<string, ProductOption>();
    (productsQuery.data?.items ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [productsQuery.data?.items]);

  const productOptions = useMemo<ProductSelectOption[]>(
    () =>
      (productsQuery.data?.items ?? []).map((product) => ({
        value: product.id,
        label: product.skuCode,
        skuCode: product.skuCode,
        productName: product.name,
        stockQuantity: product.stockQuantity,
        searchText: `${product.skuCode} ${product.name}`.toLowerCase()
      })),
    [productsQuery.data?.items]
  );

  useEffect(() => {
    if (!open) {
      form.resetFields();
      quickProductForm.resetFields();
      setRows([createEmptyRow()]);
      setQuickProductOpen(false);
      setPartnerModalOpen(false);
      setPartnerModalMode("create");
      return;
    }

    if (!isEditMode) {
      form.setFieldsValue({
        quotationNo: "Tự sinh khi lưu",
        quotationDate: dayjs(),
        notes: undefined
      });
      setRows([createEmptyRow()]);
    }
  }, [form, isEditMode, open, quickProductForm]);

  useEffect(() => {
    if (!detailQuery.data) {
      return;
    }

    const detail = detailQuery.data;
    const partner = partnerMap.get(detail.partnerId);

    form.setFieldsValue({
      quotationNo: detail.quotationNo,
      partnerId: detail.partnerId,
      partnerName: detail.partnerName ?? partner?.name ?? "",
      customerTaxCode: partner?.taxCode ?? "",
      customerAddress: partner?.address ?? "",
      quotationDate: dayjs(detail.createdAt),
      notes: detail.notes ?? ""
    });

    setRows(
      detail.items.length
        ? detail.items.map((item) =>
            recalculateRow({
              key: item.id,
              productId: item.productId,
              skuCode: item.skuCode,
              productName: item.productName,
              unitName: productMap.get(item.productId)?.unitName ?? "",
              quantity: item.quantity,
              price: item.price,
              discountPercent: item.discountPercent,
              taxPercent: item.taxPercent,
              grossAmount: item.quantity * item.price,
              discountAmount: 0,
              taxAmount: ((item.quantity * item.price) - ((item.quantity * item.price) * (item.discountPercent / 100))) * (item.taxPercent / 100),
              netAmount: item.netAmount
            })
          )
        : [createEmptyRow()]
    );
  }, [detailQuery.data, form, partnerMap, productMap]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          acc.totalAmount += row.grossAmount;
          acc.totalDiscount += row.discountAmount;
          acc.totalTax += row.taxAmount;
          acc.totalNetAmount += row.netAmount;
          acc.totalQuantity += row.quantity;
          return acc;
        },
        { totalAmount: 0, totalDiscount: 0, totalTax: 0, totalNetAmount: 0, totalQuantity: 0 }
      ),
    [rows]
  );

  const handlePartnerChange = (partnerId: string | undefined) => {
    const partner = partnerId ? partnerMap.get(partnerId) : undefined;
    form.setFieldsValue({
      partnerId,
      partnerName: partner?.name ?? "",
      customerTaxCode: partner?.taxCode ?? "",
      customerAddress: partner?.address ?? "",
      notes: partner?.name ? `Báo giá cho ${partner.name}` : ""
    });
  };

  const openCreatePartnerModal = () => {
    setPartnerModalMode("create");
    setPartnerModalOpen(true);
  };

  const openEditPartnerModal = () => {
    if (!selectedPartnerId) {
      message.warning("Vui lòng chọn khách hàng trước khi sửa.");
      return;
    }
    setPartnerModalMode("edit");
    setPartnerModalOpen(true);
  };

  const persistPartnerDraftIfNeeded = async () => {
    const partnerId = form.getFieldValue("partnerId");
    if (!partnerId) {
      return;
    }

    const currentPartner = partnerMap.get(partnerId);
    if (!currentPartner) {
      return;
    }

    const nextName = String(form.getFieldValue("partnerName") ?? "").trim();
    const nextTaxCode = String(form.getFieldValue("customerTaxCode") ?? "").trim();
    const nextAddress = String(form.getFieldValue("customerAddress") ?? "").trim();
    const payload: Parameters<typeof updatePartner>[1] = {};

    if (nextName && nextName !== (currentPartner.name ?? "")) {
      payload.name = nextName;
    }
    if (nextTaxCode !== (currentPartner.taxCode ?? "")) {
      payload.taxCode = nextTaxCode;
    }
    if (nextAddress !== (currentPartner.address ?? "")) {
      payload.address = nextAddress;
    }

    if (Object.keys(payload).length === 0) {
      return;
    }

    await updatePartnerMutation.mutateAsync({ id: partnerId, payload });
    await partnersQuery.refetch();
  };

  const updateRow = (rowKey: string, patch: Partial<QuotationRow>) => {
    setRows((prev) => prev.map((row) => (row.key !== rowKey ? row : recalculateRow({ ...row, ...patch }))));
  };

  const addRow = () => setRows((prev) => [...prev, createEmptyRow()]);
  const clearRows = () => setRows([createEmptyRow()]);
  const deleteRow = (rowKey: string) => {
    setRows((prev) => {
      const next = prev.filter((row) => row.key !== rowKey);
      return next.length > 0 ? next : [createEmptyRow()];
    });
  };

  const columns: ColumnsType<QuotationRow> = [
    {
      title: "#",
      key: "index",
      width: 40,
      align: "center",
      render: (_value, _record, index) => index + 1
    },
    {
      title: "Mã hàng",
      dataIndex: "productId",
      key: "productId",
      width: 140,
      render: (_value, record) => (
        <AppSelect
          value={record.productId}
          showSearch
          placeholder="Chọn hàng hóa"
          options={productOptions}
          optionFilterProp="searchText"
          optionRender={(option) => {
            const data = option.data as ProductSelectOption;
            return (
              <div className="sales-voucher-product-option">
                <span>{`${data.skuCode} - ${data.productName}`}</span>
                <span className="sales-voucher-product-stock">{`SL: ${formatNumber(data.stockQuantity)}`}</span>
              </div>
            );
          }}
          filterOption={(input, option) =>
            ((option as ProductSelectOption | undefined)?.searchText ?? "").includes(input.toLowerCase())
          }
          dropdownRender={(menu) => (
            <>
              {menu}
              <Divider style={{ margin: "8px 0" }} />
              <Button type="text" icon={<PlusOutlined />} block onClick={() => setQuickProductOpen(true)}>
                + Thêm mới (F9)
              </Button>
            </>
          )}
          onChange={(productId) => {
            const selected = productMap.get(productId);
            updateRow(record.key, {
              productId,
              skuCode: selected?.skuCode ?? "",
              productName: selected?.name ?? "",
              unitName: selected?.unitName ?? "",
              price: resolveQuotationUnitPrice(selected)
            });
          }}
        />
      )
    },
    {
      title: "Tên hàng",
      dataIndex: "productName",
      key: "productName",
      width: 220,
      render: (_value, record) => (
        <Input
          value={record.productName}
          placeholder="Tên hàng"
          onChange={(event) => updateRow(record.key, { productName: event.target.value })}
        />
      )
    },
    {
      title: "ĐVT",
      dataIndex: "unitName",
      key: "unitName",
      width: 72,
      align: "center",
      render: (_value, record) => (
        <Input value={record.unitName} onChange={(event) => updateRow(record.key, { unitName: event.target.value })} />
      )
    },
    {
      title: "Số lượng",
      dataIndex: "quantity",
      key: "quantity",
      width: 100,
      align: "right",
      render: (value: number, record) => renderEditableNumberCell(value, (nextValue) => updateRow(record.key, { quantity: nextValue }))
    },
    {
      title: "Đơn giá",
      dataIndex: "price",
      key: "price",
      width: 110,
      align: "right",
      render: (value: number, record) => renderEditableNumberCell(value, (nextValue) => updateRow(record.key, { price: nextValue }))
    },
    {
      title: "% Chiết khấu",
      dataIndex: "discountPercent",
      key: "discountPercent",
      width: 100,
      align: "right",
      render: (value: number, record) =>
        renderEditableNumberCell(value, (nextValue) => updateRow(record.key, { discountPercent: nextValue }), { max: 100 })
    },
    {
      title: "Đơn giá sau CK",
      key: "unitPriceAfterDiscount",
      width: 130,
      align: "right",
      render: (_value, record) => {
        const unitPriceAfterDiscount = record.price * (1 - record.discountPercent / 100);
        return (
          <Typography.Text className="quotation-readonly-value">
            {quotationUnitPriceFormatter.format(unitPriceAfterDiscount)}
          </Typography.Text>
        );
      }
    },
    {
      title: "% Thuế GTGT",
      dataIndex: "taxPercent",
      key: "taxPercent",
      width: 100,
      align: "right",
      render: (value: number, record) =>
        renderEditableNumberCell(value, (nextValue) => updateRow(record.key, { taxPercent: nextValue }), { max: 100 })
    },
    {
      title: "Thành tiền",
      dataIndex: "netAmount",
      key: "netAmount",
      width: 130,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    },
    {
      title: "",
      key: "action",
      width: 44,
      align: "center",
      render: (_value, record) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => deleteRow(record.key)} />
      )
    }
  ];

  const buildPayload = () => {
    const values = form.getFieldsValue();
    const items = rows
      .filter((row) => row.productId && row.quantity > 0)
      .map((row) => ({
        productId: row.productId as string,
        quantity: row.quantity,
        price: row.price,
        discountPercent: row.discountPercent,
        taxPercent: row.taxPercent
      }));

    if (!values.partnerId) {
      throw new Error("Vui lòng chọn khách hàng.");
    }
    if (!items.length) {
      throw new Error("Vui lòng thêm ít nhất một hàng hóa.");
    }

    return {
      partnerId: values.partnerId,
      notes: values.notes,
      items
    };
  };

  const persistQuotation = async () => {
    await form.validateFields();
    await persistPartnerDraftIfNeeded();
    const payload = buildPayload();

    if (isEditMode && quotationId) {
      return updateMutation.mutateAsync({ quotationId, payload });
    }

    return createMutation.mutateAsync(payload);
  };

  const drawerTitle = watchedQuotationNo && watchedQuotationNo !== "Tự sinh khi lưu" ? `Báo giá ${watchedQuotationNo}` : "Báo giá";
  const selectedPartner = selectedPartnerId ? partnerMap.get(selectedPartnerId) : undefined;
  const partnerModalInitialValues: Partial<PartnerFormValues> | undefined =
    partnerModalMode === "edit" && selectedPartner
      ? {
          code: selectedPartner.code,
          name: selectedPartner.name,
          phone: selectedPartner.phone ?? "",
          taxCode: selectedPartner.taxCode ?? "",
          address: selectedPartner.address ?? "",
          partnerType: selectedPartner.partnerType
        }
      : undefined;

  const handleSave = async (keepOpenForNew: boolean) => {
    try {
      const detail = await persistQuotation();
      message.success(isEditMode ? "Cập nhật báo giá thành công." : "Tạo báo giá thành công.");
      onSuccess(detail);

      if (keepOpenForNew && !isEditMode) {
        form.resetFields();
        form.setFieldsValue({
          quotationNo: "Tự sinh khi lưu",
          quotationDate: dayjs()
        });
        setRows([createEmptyRow()]);
        return;
      }

      onClose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Không thể lưu báo giá.";
      message.error(errorMessage);
    }
  };

  return (
    <>
      <Drawer
        width="100%"
        open={open}
        destroyOnClose
        title={<span className="sales-voucher-drawer-title">{drawerTitle}</span>}
        onClose={onClose}
        rootClassName="sales-voucher-drawer quotation-entry-drawer"
        styles={{ body: { paddingBottom: 12, overflow: "hidden", display: "flex", flexDirection: "column" } }}
        footer={
          <div className="sales-voucher-sticky-footer sales-voucher-sticky-footer-dark">
            <Space>
              <Button className="sales-voucher-footer-button sales-voucher-footer-button-secondary" onClick={onClose}>
                Hủy
              </Button>
            </Space>
            <Space>
              <Button
                className="sales-voucher-footer-button sales-voucher-footer-button-primary"
                loading={createMutation.isPending || updateMutation.isPending}
                onClick={() => void handleSave(false)}
              >
                Cất
              </Button>
              <Button
                className="sales-voucher-footer-button sales-voucher-footer-button-primary"
                loading={createMutation.isPending || updateMutation.isPending}
                onClick={() => void handleSave(true)}
              >
                Cất và Thêm
              </Button>
            </Space>
          </div>
        }
      >
        <div className="sales-voucher-screen quotation-entry-screen">
          <div className="sales-voucher-topbar quotation-entry-topbar">
            <div className="sales-voucher-topbar-total">
              <span>Tổng tiền thanh toán</span>
              <strong>{formatCurrency(totals.totalNetAmount)}</strong>
            </div>
          </div>
          <div className="sales-voucher-mode-tabs">
            <button type="button" className="sales-voucher-mode-tab sales-voucher-mode-tab-active">
              Báo giá
            </button>
          </div>

          <Form<QuotationFormValues> form={form} layout="vertical" className="sales-voucher-form quotation-entry-form">
            <div className="sales-voucher-meta-layout sales-voucher-meta-layout-misa quotation-entry-meta">
              <div className="sales-voucher-panel sales-voucher-panel-main quotation-entry-left">
                <Row gutter={12}>
                  <Col xs={24} lg={7}>
                    <Form.Item label="Mã khách hàng" name="partnerId" rules={[{ required: true, message: "Bắt buộc chọn khách hàng" }]}>
                      <Space.Compact style={{ width: "100%" }}>
                        <AppSelect
                          showSearch
                          placeholder="Chọn khách hàng"
                          optionFilterProp="label"
                          style={{ width: "100%" }}
                          options={(partnersQuery.data?.items ?? []).map((item) => ({
                            value: item.id,
                            label: item.name
                          }))}
                          onChange={(value) => handlePartnerChange(value as string | undefined)}
                        />
                        <Button icon={<PlusOutlined />} onClick={openCreatePartnerModal} />
                        <Button icon={<EditOutlined />} onClick={openEditPartnerModal} disabled={!selectedPartnerId} />
                      </Space.Compact>
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={11}>
                    <Form.Item label="Tên khách hàng" name="partnerName">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item label="Mã số thuế" name="customerTaxCode">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={18}>
                    <Form.Item label="Địa chỉ" name="customerAddress">
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item label="Ngày báo giá" name="quotationDate">
                      <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={18}>
                    <Form.Item label="Ghi chú" name="notes">
                      <Input placeholder="Báo giá cho khách hàng" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={6}>
                    <Form.Item label="Số báo giá" name="quotationNo">
                      <Input readOnly />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
            </div>
          </Form>

          <div className="quotation-grid-section quotation-entry-grid">
            <Table<QuotationRow>
              rowKey="key"
              size="small"
              bordered
              tableLayout="fixed"
              pagination={false}
              className="voucher-detail-table sales-voucher-detail-table quotation-detail-table quotation-entry-table"
              columns={columns}
              dataSource={rows}
              scroll={{ y: 300 }}
            />
          </div>

          <div className="sales-voucher-table-footer sales-voucher-table-footer-misa quotation-entry-bottom">
            <div className="sales-voucher-footer-actions-left quotation-entry-left-tools">
              <Typography.Text>{`Tổng số: ${rows.length} bản ghi`}</Typography.Text>
              <Space wrap>
                <Button icon={<PlusOutlined />} onClick={addRow}>
                  Thêm dòng
                </Button>
                <Button onClick={clearRows}>Xóa hết dòng</Button>
              </Space>
            </div>

            <div className="voucher-summary-block quotation-entry-summary">
              <Row justify="space-between" className="voucher-summary-row">
                <Typography.Text>Tổng tiền hàng</Typography.Text>
                <Typography.Text>{formatCurrency(totals.totalAmount)}</Typography.Text>
              </Row>
              <Row justify="space-between" className="voucher-summary-row">
                <Typography.Text>Thuế GTGT</Typography.Text>
                <Typography.Text>{formatCurrency(totals.totalTax)}</Typography.Text>
              </Row>
              <Row justify="space-between" className="voucher-summary-row voucher-summary-row-total">
                <Typography.Text strong>Tổng tiền thanh toán</Typography.Text>
                <Typography.Text strong className="voucher-summary-value-total">
                  {formatCurrency(totals.totalNetAmount)}
                </Typography.Text>
              </Row>
            </div>
          </div>
        </div>
      </Drawer>

      <Modal
        title="Thêm nhanh hàng hóa"
        open={quickProductOpen}
        onCancel={() => setQuickProductOpen(false)}
        onOk={() => {
          void quickProductForm.submit();
        }}
        confirmLoading={quickCreateProductMutation.isPending}
        okText="Lưu"
        cancelText="Hủy"
      >
        <Form<QuickProductFormValues>
          form={quickProductForm}
          layout="vertical"
          onFinish={async (values) => {
            await quickCreateProductMutation.mutateAsync(values);
          }}
        >
          <Form.Item label="Mã hàng" name="skuCode" rules={[{ required: true, message: "Bắt buộc" }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Tên hàng hóa" name="name" rules={[{ required: true, message: "Bắt buộc" }]}>
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Đơn vị tính" name="unitName">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Đơn giá bán" name="sellingPrice">
                <InputNumber min={0} style={{ width: "100%" }} formatter={formatInputNumberValue} parser={parseInputNumberValue} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <PartnerModal
        open={partnerModalOpen}
        loading={createPartnerMutation.isPending || updatePartnerMutation.isPending}
        mode={partnerModalMode}
        title={partnerModalMode === "create" ? "Thêm khách hàng" : "Cập nhật khách hàng"}
        baseGroup="CUSTOMER"
        initialValues={partnerModalInitialValues}
        onCancel={() => setPartnerModalOpen(false)}
        onSubmit={async (values) => {
          if (partnerModalMode === "edit" && selectedPartnerId) {
            const updated = await updatePartnerMutation.mutateAsync({
              id: selectedPartnerId,
              payload: {
                code: values.code,
                name: values.name,
                phone: values.phone,
                taxCode: values.taxCode,
                address: values.address,
                partnerType: values.partnerType,
                group: "CUSTOMER"
              }
            });
            await partnersQuery.refetch();
            form.setFieldsValue({
              partnerId: updated.id,
              partnerName: updated.name ?? "",
              customerTaxCode: updated.taxCode ?? "",
              customerAddress: updated.address ?? "",
              notes: updated.name ? `Báo giá cho ${updated.name}` : form.getFieldValue("notes")
            });
            message.success("Cập nhật khách hàng thành công.");
          } else {
            const created = await createPartnerMutation.mutateAsync({
              code: values.code,
              name: values.name,
              phone: values.phone,
              taxCode: values.taxCode,
              address: values.address,
              partnerType: values.partnerType,
              group: "CUSTOMER"
            });
            await partnersQuery.refetch();
            form.setFieldsValue({
              partnerId: created.id,
              partnerName: created.name ?? "",
              customerTaxCode: created.taxCode ?? "",
              customerAddress: created.address ?? "",
              notes: created.name ? `Báo giá cho ${created.name}` : form.getFieldValue("notes")
            });
            message.success("Thêm khách hàng thành công.");
          }
          setPartnerModalOpen(false);
        }}
      />
    </>
  );
}
