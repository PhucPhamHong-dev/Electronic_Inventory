import { DeleteOutlined, DownOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EditOutlined } from "@ant-design/icons";
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
import { PartnerModal, type PartnerFormValues } from "./PartnerModal";
import { createPartner, createProduct, fetchPartners, fetchProducts, updatePartner } from "../services/masterData.api";
import { fetchQuotationById } from "../services/quotation.api";
import { createPurchaseVoucher, createSalesVoucher, downloadVoucherPdf, fetchVoucherById, payVoucher, updateVoucher } from "../services/voucher.api";
import { fetchCompanySettings } from "../services/system.api";
import type {
  CreateVoucherPayload,
  PaymentMethod,
  PartnerOption,
  ProductOption,
  QuotationDetail,
  VoucherDetail,
  VoucherTransactionResult
} from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";

interface SalesVoucherDrawerProps {
  open: boolean;
  voucherId?: string | null;
  sourceQuotationId?: string | null;
  mode?: "sales" | "purchase";
  onClose: () => void;
  onSuccess: (result: VoucherTransactionResult) => void;
}

interface SalesVoucherFormValues {
  accountingDate: Dayjs;
  voucherDate: Dayjs;
  voucherNo: string;
  partnerId?: string;
  customerName?: string;
  customerAddress?: string;
  customerTaxCode?: string;
  note?: string;
}

interface QuickProductFormValues {
  skuCode: string;
  name: string;
  unitName?: string;
  sellingPrice?: number;
}

type RowType = "ITEM" | "NOTE";

interface SalesRow {
  key: string;
  rowType: RowType;
  productId?: string;
  productName?: string;
  noteText?: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
  grossAmount: number;
  discountAmount: number;
  taxAmount: number;
  lineTotal: number;
}

interface StockAlertMeta {
  exceedsStock: boolean;
  availableStock: number;
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

function createEmptyRow(): SalesRow {
  return {
    key: crypto.randomUUID(),
    rowType: "ITEM",
    unitName: "",
    quantity: 0,
    unitPrice: 0,
    discountRate: 0,
    taxRate: 0,
    grossAmount: 0,
    discountAmount: 0,
    taxAmount: 0,
    lineTotal: 0
  };
}

function createNoteRow(): SalesRow {
  return {
    key: crypto.randomUUID(),
    rowType: "NOTE",
    noteText: "",
    unitName: "",
    quantity: 0,
    unitPrice: 0,
    discountRate: 0,
    taxRate: 0,
    grossAmount: 0,
    discountAmount: 0,
    taxAmount: 0,
    lineTotal: 0
  };
}

function recalculateRow(input: SalesRow): SalesRow {
  if (input.rowType === "NOTE") {
    return input;
  }

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
    lineTotal: Number(lineTotal.toFixed(2))
  };
}

function formatInputNumberValue(value: string | number | undefined, info: InputNumberFormatterInfo): string {
  if (info.userTyping) return info.input;
  if (value === undefined || value === null || value === "") return "";
  const normalized = String(value).replace(/,/g, "");
  const [integerPart, decimalPart] = normalized.split(".");
  const formattedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimalPart !== undefined ? `${formattedIntegerPart}.${decimalPart}` : formattedIntegerPart;
}

function parseInputNumberValue(value: string | undefined): string {
  if (!value) return "";
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

function mapDetailToRows(detail: VoucherDetail): SalesRow[] {
  const mapped = detail.items.map((item) =>
    recalculateRow({
      key: item.id,
      rowType: "ITEM",
      productId: item.productId,
      productName: item.productName,
      unitName: item.unitName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountRate: item.discountRate,
      taxRate: item.taxRate,
      grossAmount: item.quantity * item.unitPrice,
      discountAmount: item.discountAmount,
      taxAmount: item.taxAmount,
      lineTotal: item.lineNetAmount
    })
  );
  return mapped.length > 0 ? mapped : [createEmptyRow()];
}

export function SalesVoucherDrawer(props: SalesVoucherDrawerProps) {
  const { open, voucherId, sourceQuotationId, mode = "sales", onClose, onSuccess } = props;
  const [form] = Form.useForm<SalesVoucherFormValues>();
  const [quickProductForm] = Form.useForm<QuickProductFormValues>();
  const [rows, setRows] = useState<SalesRow[]>([createEmptyRow()]);
  const [actionLoading, setActionLoading] = useState(false);
  const [savedVoucher, setSavedVoucher] = useState<VoucherTransactionResult | null>(null);
  const [paymentFlow, setPaymentFlow] = useState<"UNPAID" | "IMMEDIATE">("UNPAID");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [partnerModalMode, setPartnerModalMode] = useState<"create" | "edit">("create");
  const watchedVoucherNo = Form.useWatch("voucherNo", form);
  const selectedPartnerId = Form.useWatch("partnerId", form);
  const isEditMode = Boolean(voucherId);
  const isPurchaseMode = mode === "purchase";
  const partnerCodeLabel = isPurchaseMode ? "Mã nhà cung cấp" : "Mã khách hàng";
  const partnerNameLabel = isPurchaseMode ? "Tên nhà cung cấp" : "Tên khách hàng";
  const partnerPlaceholder = isPurchaseMode ? "Chọn mã nhà cung cấp" : "Chọn mã khách hàng";
  const headerTitle = isPurchaseMode ? "Chứng từ mua hàng" : "Chứng từ bán hàng";
  const noteDefaultPrefix = isPurchaseMode ? "Mua hàng từ" : "Xuất bán hàng cho";
  const saveSuccessMessage = isPurchaseMode ? "Lưu phiếu nhập thành công." : "Lưu chứng từ thành công.";
  const savePrintSuccessMessage = isPurchaseMode ? "Lưu phiếu nhập và tải PDF thành công." : "Lưu chứng từ và tải PDF thành công.";
  const paymentFlowOptions = isPurchaseMode
    ? [
        { label: "Chưa thanh toán", value: "UNPAID" },
        { label: "Thanh toán ngay", value: "IMMEDIATE" }
      ]
    : [
        { label: "Chưa thu tiền", value: "UNPAID" },
        { label: "Thu tiền ngay", value: "IMMEDIATE" }
      ];

  const partnersQuery = useQuery({
    queryKey: [mode, "voucher-drawer-partners"],
    queryFn: () => fetchPartners({ page: 1, pageSize: 200, group: isPurchaseMode ? "SUPPLIER" : "CUSTOMER" }),
    enabled: open
  });

  const productsQuery = useQuery({
    queryKey: ["sales-drawer-products"],
    queryFn: () => fetchProducts({ page: 1, pageSize: 200 }),
    enabled: open
  });

  const voucherDetailQuery = useQuery({
    queryKey: [mode, "voucher-detail", voucherId],
    queryFn: () => fetchVoucherById(voucherId as string),
    enabled: open && Boolean(voucherId)
  });

  const quotationSourceQuery = useQuery({
    queryKey: ["sales-source-quotation", sourceQuotationId],
    queryFn: () => fetchQuotationById(sourceQuotationId as string),
    enabled: open && !isPurchaseMode && !isEditMode && Boolean(sourceQuotationId)
  });

  const settingsQuery = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchCompanySettings,
    enabled: open && !isPurchaseMode
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateVoucherPayload) => (isPurchaseMode ? createPurchaseVoucher(payload) : createSalesVoucher(payload))
  });
  const updateMutation = useMutation({
    mutationFn: (input: { voucherId: string; payload: CreateVoucherPayload }) => updateVoucher(input.voucherId, input.payload)
  });

  const quickCreateProductMutation = useMutation({
    mutationFn: (payload: QuickProductFormValues) => createProduct({
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

  useEffect(() => {
    if (!open) {
      form.resetFields();
      quickProductForm.resetFields();
      setRows([createEmptyRow()]);
      setSavedVoucher(null);
      setActionLoading(false);
      setPaymentFlow("UNPAID");
      setPaymentMethod("CASH");
      setQuickProductOpen(false);
      setPartnerModalOpen(false);
      setPartnerModalMode("create");
      return;
    }

    if (!isEditMode) {
      const today = dayjs();
      form.setFieldsValue({ accountingDate: today, voucherDate: today, voucherNo: "Tự sinh khi lưu" });
      setRows([createEmptyRow()]);
      setPaymentFlow("UNPAID");
      setPaymentMethod("CASH");
    }
  }, [form, isEditMode, open, quickProductForm]);

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

  const productOptions = useMemo<ProductSelectOption[]>(() =>
    (productsQuery.data?.items ?? []).map((product) => ({
      value: product.id,
      label: product.skuCode,
      skuCode: product.skuCode,
      productName: product.name,
      stockQuantity: product.stockQuantity,
      searchText: `${product.skuCode} ${product.name}`.toLowerCase()
    })), [productsQuery.data?.items]);

  const partnerOptions = useMemo(() =>
    (partnersQuery.data?.items ?? [])
      .filter((item) =>
        isPurchaseMode
          ? item.partnerType === "SUPPLIER" || item.partnerType === "BOTH"
          : item.partnerType === "CUSTOMER" || item.partnerType === "BOTH"
      )
      .map((item) => ({ value: item.id, label: item.name })), [isPurchaseMode, partnersQuery.data?.items]);

  useEffect(() => {
    if (!voucherDetailQuery.data) return;
    const detail = voucherDetailQuery.data;
    const partner = detail.partnerId ? partnerMap.get(detail.partnerId) : undefined;
    const voucherDate = dayjs(detail.voucherDate);
    form.setFieldsValue({
      accountingDate: voucherDate,
      voucherDate,
      voucherNo: detail.voucherNo ?? "Tự sinh khi lưu",
      partnerId: detail.partnerId ?? undefined,
      customerName: detail.partnerName ?? partner?.name ?? "",
      customerAddress: detail.partnerAddress ?? partner?.address ?? "",
      customerTaxCode: detail.partnerTaxCode ?? partner?.taxCode ?? "",
      note: detail.note ?? ""
    });
    setRows(mapDetailToRows(detail));
    setSavedVoucher({ voucherId: detail.id, voucherNo: detail.voucherNo, status: detail.status, paymentStatus: detail.paymentStatus, paidAmount: detail.paidAmount });
    setPaymentFlow(detail.paymentStatus === "PAID" ? "IMMEDIATE" : "UNPAID");
    setPaymentMethod(detail.paymentMethod ?? "CASH");
  }, [form, partnerMap, voucherDetailQuery.data]);

  useEffect(() => {
    if (!quotationSourceQuery.data || isEditMode) return;
    const detail: QuotationDetail = quotationSourceQuery.data;
    const partner = partnerMap.get(detail.partnerId);
    const sourceDate = dayjs(detail.createdAt);
    form.setFieldsValue({
      accountingDate: sourceDate,
      voucherDate: sourceDate,
      voucherNo: "Tự sinh khi lưu",
      partnerId: detail.partnerId,
      customerName: detail.partnerName ?? partner?.name ?? "",
      customerAddress: partner?.address ?? "",
      customerTaxCode: partner?.taxCode ?? "",
      note: detail.notes ?? (detail.partnerName ? `${noteDefaultPrefix} ${detail.partnerName}` : "")
    });
    setRows(detail.items.length ? detail.items.map((item) => recalculateRow({
      key: item.id,
      rowType: "ITEM",
      productId: item.productId,
      productName: item.productName,
      unitName: productMap.get(item.productId)?.unitName ?? "",
      quantity: item.quantity,
      unitPrice: item.price,
      discountRate: item.discountPercent,
      taxRate: item.taxPercent,
      grossAmount: item.quantity * item.price,
      discountAmount: 0,
      taxAmount: 0,
      lineTotal: item.netAmount
    })) : [createEmptyRow()]);
  }, [form, isEditMode, noteDefaultPrefix, partnerMap, productMap, quotationSourceQuery.data]);

  const totals = useMemo(() => rows.reduce((acc, row) => {
    if (row.rowType === "NOTE") return acc;
    acc.totalAmount += row.grossAmount;
    acc.totalTaxAmount += row.taxAmount;
    acc.totalNetAmount += row.lineTotal;
    return acc;
  }, { totalAmount: 0, totalTaxAmount: 0, totalNetAmount: 0 }), [rows]);

  const totalQuantity = useMemo(
    () => rows.filter((row) => row.rowType === "ITEM").reduce((sum, row) => sum + row.quantity, 0),
    [rows]
  );

  const allowNegativeStock = settingsQuery.data?.allowNegativeStock === true;

  const stockAlerts = useMemo<Record<string, StockAlertMeta>>(
    () =>
      rows.reduce<Record<string, StockAlertMeta>>((acc, row) => {
        if (isPurchaseMode || row.rowType === "NOTE" || !row.productId) {
          return acc;
        }
        const availableStock = productMap.get(row.productId)?.stockQuantity ?? 0;
        acc[row.key] = {
          exceedsStock: row.quantity > availableStock,
          availableStock
        };
        return acc;
      }, {}),
    [isPurchaseMode, productMap, rows]
  );

  const hasStockViolation = useMemo(
    () => !isPurchaseMode && rows.some((row) => stockAlerts[row.key]?.exceedsStock),
    [isPurchaseMode, rows, stockAlerts]
  );

  const shouldBlockSaveForStock = !isPurchaseMode && !allowNegativeStock && hasStockViolation;

  const handlePartnerChange = (partnerId: string | undefined) => {
    const partner = partnerId ? partnerMap.get(partnerId) : undefined;
    form.setFieldsValue({
      partnerId,
      customerName: partner?.name ?? "",
      customerAddress: partner?.address ?? "",
      customerTaxCode: partner?.taxCode ?? "",
      note: partner?.name ? `${noteDefaultPrefix} ${partner.name}` : ""
    });
  };

  const openCreatePartnerModal = () => {
    setPartnerModalMode("create");
    setPartnerModalOpen(true);
  };

  const openEditPartnerModal = () => {
    if (!selectedPartnerId) {
      message.warning(`Vui lòng chọn ${isPurchaseMode ? "nhà cung cấp" : "khách hàng"} trước khi sửa.`);
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

    const nextName = String(form.getFieldValue("customerName") ?? "").trim();
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

  const syncDates = (value: Dayjs | null) => {
    if (!value) return;
    form.setFieldsValue({ accountingDate: value, voucherDate: value });
  };

  const updateRow = (rowKey: string, patch: Partial<SalesRow>) => {
    setRows((prev) => prev.map((row) => row.key !== rowKey ? row : recalculateRow({ ...row, ...patch })));
  };

  const addRow = () => setRows((prev) => [...prev, createEmptyRow()]);
  const addNoteRow = () => setRows((prev) => [...prev, createNoteRow()]);
  const clearRows = () => setRows([createEmptyRow()]);
  const deleteRow = (rowKey: string) => setRows((prev) => {
    const next = prev.filter((row) => row.key !== rowKey);
    return next.length > 0 ? next : [createEmptyRow()];
  });

  const buildPayload = (): CreateVoucherPayload => {
    const values = form.getFieldsValue();
    const payload: CreateVoucherPayload = {
      voucherDate: (values.accountingDate ?? values.voucherDate)?.toISOString(),
      partnerId: values.partnerId,
      note: values.note,
      paymentMethod: paymentFlow === "IMMEDIATE" ? paymentMethod : undefined,
      items: rows.filter((row) => row.rowType === "ITEM" && row.productId && row.quantity > 0).map((row) => ({
        productId: row.productId as string,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        discountRate: row.discountRate,
        taxRate: row.taxRate
      }))
    };
    if (!isPurchaseMode) {
      payload.quotationId = !isEditMode ? sourceQuotationId ?? undefined : undefined;
      if (!isEditMode) {
        payload.isPaidImmediately = paymentFlow === "IMMEDIATE";
      }
    }
    return payload;
  };

  const persistVoucher = async (): Promise<VoucherTransactionResult> => {
    await form.validateFields();
    await persistPartnerDraftIfNeeded();
    const payload = buildPayload();
    if (!payload.items || payload.items.length === 0) {
      throw new Error("Vui lòng thêm ít nhất một dòng hàng hóa.");
    }

    if (isEditMode && voucherId) {
      const { isPaidImmediately: _ignored, ...updatePayload } = payload;
      return updateMutation.mutateAsync({ voucherId, payload: updatePayload });
    }

    return createMutation.mutateAsync(payload);
  };

  const settleImmediatePaymentIfNeeded = async (result: VoucherTransactionResult): Promise<VoucherTransactionResult> => {
    if (paymentFlow !== "IMMEDIATE" || isEditMode) {
      return result;
    }
    if (result.paymentStatus === "PAID") {
      return result;
    }
    if (!isPurchaseMode) {
      return result;
    }
    return payVoucher(result.voucherId);
  };

  const handleSave = async () => {
    if (actionLoading) return;
    if (shouldBlockSaveForStock) {
      message.error("Số lượng xuất đang vượt quá tồn kho hiện tại.");
      return;
    }
    try {
      setActionLoading(true);
      const persisted = await persistVoucher();
      const result = await settleImmediatePaymentIfNeeded(persisted);
      setSavedVoucher(result);
      form.setFieldValue("voucherNo", result.voucherNo ?? result.voucherId);
      message.success(
        isPurchaseMode && paymentFlow === "IMMEDIATE"
          ? "Lưu phiếu nhập thành công. Hệ thống đã tự sinh phiếu chi."
          : !isPurchaseMode && result.linkedReceiptVoucherId
            ? "Lưu chứng từ thành công. Hệ thống đã tự sinh phiếu thu."
            : saveSuccessMessage
      );
      onSuccess(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Không thể lưu chứng từ.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    const targetId = savedVoucher?.voucherId ?? voucherId ?? null;
    const voucherNo = form.getFieldValue("voucherNo") ?? savedVoucher?.voucherNo ?? targetId ?? "";
    if (!targetId) {
      message.warning("Vui lòng lưu chứng từ trước khi tải PDF.");
      return;
    }
    await downloadVoucherPdf(targetId, voucherNo, isPurchaseMode ? "PURCHASE" : "SALES");
  };

  const handleSaveAndPrint = async () => {
    if (actionLoading) return;
    if (shouldBlockSaveForStock) {
      message.error("Số lượng xuất đang vượt quá tồn kho hiện tại.");
      return;
    }
    try {
      setActionLoading(true);
      const persisted = await persistVoucher();
      const result = await settleImmediatePaymentIfNeeded(persisted);
      setSavedVoucher(result);
      const nextVoucherNo = result.voucherNo ?? result.voucherId;
      form.setFieldValue("voucherNo", nextVoucherNo);
      await downloadVoucherPdf(result.voucherId, nextVoucherNo, isPurchaseMode ? "PURCHASE" : "SALES");
      message.success(
        isPurchaseMode && paymentFlow === "IMMEDIATE"
          ? "Lưu phiếu nhập thành công. Hệ thống đã tự sinh phiếu chi."
          : !isPurchaseMode && result.linkedReceiptVoucherId
            ? "Lưu chứng từ thành công. Hệ thống đã tự sinh phiếu thu."
            : savePrintSuccessMessage
      );
      onSuccess(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Không thể lưu chứng từ.");
    } finally {
      setActionLoading(false);
    }
  };

  const drawerTitle = watchedVoucherNo && watchedVoucherNo !== "Tự sinh khi lưu" ? `${headerTitle} ${watchedVoucherNo}` : headerTitle;
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

  const columns: ColumnsType<SalesRow> = [
    { title: "#", key: "stt", width: 48, align: "center", render: (_value, _record, index) => index + 1 },
    {
      title: "Mã hàng",
      dataIndex: "productId",
      key: "productId",
      width: 156,
      render: (_value, record) => {
        if (record.rowType === "NOTE") return <Typography.Text type="secondary">Ghi chú</Typography.Text>;
        return (
          <AppSelect
            value={record.productId}
            showSearch
            placeholder="Chọn hàng hóa"
            options={productOptions}
            optionFilterProp="searchText"
            optionRender={(option) => {
              const data = option.data as ProductSelectOption;
              return <div className="sales-voucher-product-option"><span>{`${data.skuCode} - ${data.productName}`}</span><span className="sales-voucher-product-stock">{`SL: ${formatNumber(data.stockQuantity)}`}</span></div>;
            }}
            filterOption={(input, option) => ((option as ProductSelectOption | undefined)?.searchText ?? "").includes(input.toLowerCase())}
            dropdownRender={(menu) => <><>{menu}</><Divider style={{ margin: "8px 0" }} /><Button type="text" icon={<PlusOutlined />} block onClick={() => setQuickProductOpen(true)}>+ Thêm mới (F9)</Button></>}
            onChange={(productId) => {
              const selected = productMap.get(productId);
              updateRow(record.key, {
                productId,
                productName: selected?.name ?? "",
                unitName: selected?.unitName ?? "",
                unitPrice: selected ? Number(isPurchaseMode ? (selected.costPrice || selected.sellingPrice || 0) : (selected.sellingPrice || selected.costPrice || 0)) : 0
              });
            }}
          />
        );
      }
    },
    {
      title: "Tên hàng",
      dataIndex: "productName",
      key: "productName",
      ellipsis: true,
      render: (value: string | undefined, record) => record.rowType === "NOTE" ? <Input value={record.noteText} placeholder="Nhập ghi chú cho chứng từ" onChange={(event) => updateRow(record.key, { noteText: event.target.value })} /> : value || productMap.get(record.productId ?? "")?.name || "-"
    },
    { title: "ĐVT", dataIndex: "unitName", key: "unitName", width: 72, align: "center", render: (value: string, record) => (record.rowType === "NOTE" ? "-" : value || "-") },
    {
      title: "Số lượng",
      dataIndex: "quantity",
      key: "quantity",
      width: 110,
      align: "right",
      render: (value: number, record) => {
        if (record.rowType === "NOTE") {
          return "-";
        }
        const stockAlert = stockAlerts[record.key];
        return (
          <div>
            {renderEditableNumberCell(value, (nextValue) => updateRow(record.key, { quantity: nextValue }))}
            {stockAlert?.exceedsStock ? (
              <Typography.Text className={allowNegativeStock ? "stock-warning-text" : "stock-error-text"}>
                {allowNegativeStock
                  ? "Số lượng xuất vượt quá tồn kho hiện tại"
                  : "Số lượng xuất vượt quá tồn kho hiện tại. Không thể lưu phiếu."}
              </Typography.Text>
            ) : null}
          </div>
        );
      }
    },
    {
      title: "Đơn giá",
      dataIndex: "unitPrice",
      key: "unitPrice",
      width: 128,
      align: "right",
      render: (value: number, record) =>
        record.rowType === "NOTE" ? "-" : renderEditableNumberCell(value, (nextValue) => updateRow(record.key, { unitPrice: nextValue }))
    },
    {
      title: "% Chiết khấu",
      dataIndex: "discountRate",
      key: "discountRate",
      width: 108,
      align: "right",
      render: (value: number, record) =>
        record.rowType === "NOTE" ? "-" : renderEditableNumberCell(value, (nextValue) => updateRow(record.key, { discountRate: nextValue }), { max: 100 })
    },
    {
      title: "Đơn giá sau CK",
      key: "unitPriceAfterDiscount",
      width: 128,
      align: "right",
      render: (_value, record) => {
        if (record.rowType === "NOTE") {
          return "-";
        }
        const discountedPrice = record.unitPrice * (1 - (record.discountRate || 0) / 100);
        return <Typography.Text>{formatCurrency(discountedPrice)}</Typography.Text>;
      }
    },
    {
      title: "% Thuế GTGT",
      dataIndex: "taxRate",
      key: "taxRate",
      width: 108,
      align: "right",
      render: (value: number, record) =>
        record.rowType === "NOTE" ? "-" : renderEditableNumberCell(value, (nextValue) => updateRow(record.key, { taxRate: nextValue }), { max: 100 })
    },
    {
      title: "Thành tiền",
      dataIndex: "lineTotal",
      key: "lineTotal",
      width: 148,
      align: "right",
      render: (value: number, record) => record.rowType === "NOTE" ? "-" : <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    },
    { title: "", key: "action", align: "center", width: 56, render: (_value, record) => <Button type="text" danger icon={<DeleteOutlined />} onClick={() => deleteRow(record.key)} /> }
  ];

  return (
    <>
      <Drawer
        width="100%"
        destroyOnClose
        open={open}
        title={<span className="sales-voucher-drawer-title">{drawerTitle}</span>}
        onClose={onClose}
        rootClassName="sales-voucher-drawer"
        styles={{ body: { paddingBottom: 12 } }}
        footer={<div className="sales-voucher-sticky-footer sales-voucher-sticky-footer-dark"><Button className="sales-voucher-footer-button sales-voucher-footer-button-secondary" onClick={onClose}>Hủy</Button><Space><Button className="sales-voucher-footer-button sales-voucher-footer-button-secondary" onClick={() => void handleDownloadPdf()}>Tải PDF</Button><Button className="sales-voucher-footer-button sales-voucher-footer-button-primary" loading={actionLoading} disabled={shouldBlockSaveForStock} onClick={() => void handleSave()}>Cất</Button><Button className="sales-voucher-footer-button sales-voucher-footer-button-primary" loading={actionLoading} disabled={shouldBlockSaveForStock} onClick={() => void handleSaveAndPrint()}>Cất và In <DownOutlined /></Button></Space></div>}
      >
        <div className="sales-voucher-screen">
          <div className="sales-voucher-topbar"><Space wrap className="sales-voucher-payment-row"><><Radio.Group value={paymentFlow} onChange={(event) => setPaymentFlow(event.target.value as "UNPAID" | "IMMEDIATE")} options={paymentFlowOptions} />{paymentFlow === "IMMEDIATE" ? <AppSelect value={paymentMethod} style={{ width: 160 }} options={[{ value: "CASH", label: "Tiền mặt" }, { value: "TRANSFER", label: "Chuyển khoản" }]} onChange={(value) => setPaymentMethod(value as PaymentMethod)} /> : null}</></Space><div className="sales-voucher-topbar-total"><span>Tổng tiền thanh toán</span><strong>{formatCurrency(totals.totalNetAmount)}</strong></div></div>
          <div className="sales-voucher-mode-tabs"><button type="button" className="sales-voucher-mode-tab sales-voucher-mode-tab-active">{isPurchaseMode ? "Chứng từ mua hàng" : "Chứng từ ghi nợ"}</button></div>
          <Form<SalesVoucherFormValues> form={form} layout="vertical" className="sales-voucher-form">
            <div className="sales-voucher-meta-layout sales-voucher-meta-layout-misa">
              <div className="sales-voucher-panel sales-voucher-panel-main">
                <Row gutter={12}>
                  <Col xs={24} lg={7}><Form.Item label={partnerCodeLabel} name="partnerId" rules={[{ required: true, message: `Bắt buộc chọn ${isPurchaseMode ? "nhà cung cấp" : "khách hàng"}` }]}><Space.Compact style={{ width: "100%" }}><AppSelect showSearch optionFilterProp="label" placeholder={partnerPlaceholder} loading={partnersQuery.isFetching} options={partnerOptions} onChange={(value) => handlePartnerChange(value as string | undefined)} style={{ flex: 1 }} /><Button icon={<PlusOutlined />} onClick={openCreatePartnerModal} title={isPurchaseMode ? "Thêm nhà cung cấp" : "Thêm khách hàng"} /><Button icon={<EditOutlined />} onClick={openEditPartnerModal} title={isPurchaseMode ? "Sửa nhà cung cấp" : "Sửa khách hàng"} /></Space.Compact></Form.Item></Col>
                  <Col xs={24} lg={11}><Form.Item label={partnerNameLabel} name="customerName"><Input placeholder={isPurchaseMode ? "Nhập tên nhà cung cấp" : "Nhập tên khách hàng"} /></Form.Item></Col>
                  <Col xs={24} lg={6}><Form.Item label="Mã số thuế" name="customerTaxCode"><Input placeholder="Nhập mã số thuế" /></Form.Item></Col>
                  <Col xs={24} lg={18}><Form.Item label="Địa chỉ" name="customerAddress"><Input placeholder="Nhập địa chỉ" /></Form.Item></Col>
                  <Col xs={24} lg={6}><Form.Item label="Ngày hạch toán" name="accountingDate" rules={[{ required: true, message: "Bắt buộc" }]}><DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" onChange={(value) => syncDates(value)} /></Form.Item></Col>
                  <Col xs={24} lg={12}><Form.Item label="Diễn giải" name="note"><Input placeholder={isPurchaseMode ? "Mua hàng từ nhà cung cấp" : "Bán hàng cho khách hàng"} /></Form.Item></Col>
                  <Col xs={24} lg={6}><Form.Item label="Ngày chứng từ" name="voucherDate" rules={[{ required: true, message: "Bắt buộc" }]}><DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" onChange={(value) => syncDates(value)} /></Form.Item></Col>
                  <Col xs={24} lg={6}><Form.Item label="Số chứng từ" name="voucherNo"><Input readOnly /></Form.Item></Col>
                </Row>
              </div>
            </div>
          </Form>
          <div className="sales-voucher-grid-section"><Table<SalesRow> rowKey="key" size="small" bordered tableLayout="fixed" className="voucher-detail-table sales-voucher-detail-table sales-voucher-detail-table-misa" pagination={false} columns={columns} dataSource={rows} scroll={{ y: 320 }} /></div>
          <div className="sales-voucher-table-footer sales-voucher-table-footer-misa"><div className="sales-voucher-footer-actions-left"><Typography.Text type="secondary">{`Tổng số: ${rows.length} bản ghi`}</Typography.Text><Space wrap><Button icon={<PlusOutlined />} onClick={addRow}>Thêm dòng</Button><Button onClick={addNoteRow}>Thêm ghi chú</Button><Button danger onClick={clearRows}>Xóa hết dòng</Button></Space></div><div className="voucher-summary-block sales-voucher-summary-block"><Row justify="space-between" className="voucher-summary-row"><Typography.Text>Tổng tiền hàng</Typography.Text><Typography.Text className="voucher-summary-value">{formatCurrency(totals.totalAmount)}</Typography.Text></Row><Row justify="space-between" className="voucher-summary-row"><Typography.Text>Thuế GTGT</Typography.Text><Typography.Text className="voucher-summary-value">{formatCurrency(totals.totalTaxAmount)}</Typography.Text></Row><Row justify="space-between" className="voucher-summary-row voucher-summary-row-total"><Typography.Text strong>Tổng tiền thanh toán</Typography.Text><Typography.Text strong className="voucher-summary-value voucher-summary-value-total">{formatCurrency(totals.totalNetAmount)}</Typography.Text></Row></div></div>
        </div>
      </Drawer>
      <PartnerModal
        open={partnerModalOpen}
        loading={createPartnerMutation.isPending || updatePartnerMutation.isPending}
        mode={partnerModalMode}
        title={partnerModalMode === "create" ? (isPurchaseMode ? "Thêm nhà cung cấp" : "Thêm khách hàng") : (isPurchaseMode ? "Cập nhật nhà cung cấp" : "Cập nhật khách hàng")}
        baseGroup={isPurchaseMode ? "SUPPLIER" : "CUSTOMER"}
        initialValues={partnerModalInitialValues}
        onCancel={() => setPartnerModalOpen(false)}
        onSubmit={async (values) => {
          const targetGroup = isPurchaseMode ? "SUPPLIER" : "CUSTOMER";
          if (partnerModalMode === "create") {
            const created = await createPartnerMutation.mutateAsync({
              code: values.code,
              name: values.name,
              phone: values.phone,
              taxCode: values.taxCode,
              address: values.address,
              partnerType: values.partnerType ?? targetGroup,
              group: targetGroup
            });
            await partnersQuery.refetch();
            form.setFieldsValue({
              partnerId: created.id,
              customerName: created.name,
              customerTaxCode: created.taxCode ?? "",
              customerAddress: created.address ?? "",
              note: created.name ? `${noteDefaultPrefix} ${created.name}` : ""
            });
            message.success(isPurchaseMode ? "Đã thêm nhà cung cấp." : "Đã thêm khách hàng.");
          } else {
            if (!selectedPartnerId) {
              throw new Error(`Vui lòng chọn ${isPurchaseMode ? "nhà cung cấp" : "khách hàng"} trước khi sửa.`);
            }
            const updated = await updatePartnerMutation.mutateAsync({
              id: selectedPartnerId,
              payload: {
                code: values.code,
                name: values.name,
                phone: values.phone,
                taxCode: values.taxCode,
                address: values.address,
                partnerType: values.partnerType ?? targetGroup,
                group: targetGroup
              }
            });
            await partnersQuery.refetch();
            form.setFieldsValue({
              partnerId: updated.id,
              customerName: updated.name,
              customerTaxCode: updated.taxCode ?? "",
              customerAddress: updated.address ?? "",
              note: updated.name ? `${noteDefaultPrefix} ${updated.name}` : form.getFieldValue("note")
            });
            message.success(isPurchaseMode ? "Đã cập nhật nhà cung cấp." : "Đã cập nhật khách hàng.");
          }
          setPartnerModalOpen(false);
        }}
      />
      <Modal title="Thêm nhanh hàng hóa" open={quickProductOpen} onCancel={() => setQuickProductOpen(false)} onOk={() => { void quickProductForm.submit(); }} confirmLoading={quickCreateProductMutation.isPending} okText="Lưu" cancelText="Hủy">
        <Form<QuickProductFormValues> form={quickProductForm} layout="vertical" onFinish={async (values) => { await quickCreateProductMutation.mutateAsync(values); }}>
          <Form.Item label="Mã hàng" name="skuCode" rules={[{ required: true, message: "Bắt buộc" }]}><Input /></Form.Item>
          <Form.Item label="Tên hàng hóa" name="name" rules={[{ required: true, message: "Bắt buộc" }]}><Input /></Form.Item>
          <Row gutter={12}><Col span={12}><Form.Item label="Đơn vị tính" name="unitName"><Input /></Form.Item></Col><Col span={12}><Form.Item label="Đơn giá bán" name="sellingPrice"><InputNumber min={0} style={{ width: "100%" }} formatter={formatInputNumberValue} parser={parseInputNumberValue} /></Form.Item></Col></Row>
        </Form>
      </Modal>
    </>
  );
}
