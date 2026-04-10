import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
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
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { createPartner, fetchPartners, updatePartner } from "../services/masterData.api";
import { createCashVoucher, downloadVoucherPdf, fetchUnpaidInvoices, fetchVoucherById } from "../services/voucher.api";
import type {
  CashVoucherAllocationInput,
  PartnerOption,
  PaymentMethod,
  PaymentReason,
  UnpaidInvoiceItem,
  VoucherAllocationItem,
  VoucherDetail,
  VoucherTransactionResult
} from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";
import { AppSelect } from "./common/AppSelect";
import { PartnerModal, type PartnerFormValues } from "./PartnerModal";

interface CashVoucherDrawerProps {
  open: boolean;
  voucherType: "RECEIPT" | "PAYMENT";
  paymentReason: PaymentReason;
  invoiceBased: boolean;
  entryMode?: "STANDARD" | "EXPENSE_INVOICE";
  voucherId?: string;
  onClose: () => void;
  onSuccess: (result: VoucherTransactionResult) => void;
}

interface CashVoucherFormValues {
  partnerId?: string;
  partnerName?: string;
  payerName?: string;
  salesEmployee?: string;
  currency?: string;
  address?: string;
  taxCode?: string;
  accountingDate: Dayjs;
  voucherDate: Dayjs;
  voucherNo?: string;
  paymentMethod: PaymentMethod;
  note?: string;
}

interface InvoiceSelectionRow extends UnpaidInvoiceItem {
  checked: boolean;
  amountApplied: number;
}

interface DirectCashEntryRow {
  key: string;
  description: string;
  amount: number;
}

interface ExpenseInvoiceTaxRow {
  key: string;
  sourceEntryKey?: string;
  taxDescription: string;
  hasInvoice: boolean;
  vatRate: number;
  vatAmount: number;
  vatAccount: string;
  invoiceDate: Dayjs | null;
  invoiceNo: string;
  purchaseGroup: string;
}

const paymentReasonLabelMap: Record<PaymentReason, string> = {
  CUSTOMER_PAYMENT: "Thu tiền khách hàng",
  SUPPLIER_PAYMENT: "Trả tiền nhà cung cấp",
  BANK_WITHDRAWAL: "Thu rút tiền gửi",
  BANK_DEPOSIT: "Nộp tiền ngân hàng",
  OTHER: "Thu/chi khác"
};

function createDirectRowKey() {
  return `cash-entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getDefaultDescription(
  voucherType: "RECEIPT" | "PAYMENT",
  paymentReason: PaymentReason,
  partnerName?: string
) {
  const trimmedName = partnerName?.trim();
  if (paymentReason === "CUSTOMER_PAYMENT") {
    return trimmedName ? `Thu tiền của ${trimmedName}` : "Thu tiền khách hàng";
  }
  if (paymentReason === "SUPPLIER_PAYMENT") {
    return trimmedName ? `Chi tiền cho ${trimmedName}` : "Trả tiền nhà cung cấp";
  }
  if (paymentReason === "BANK_WITHDRAWAL") {
    return "Thu rút tiền gửi ngân hàng";
  }
  if (paymentReason === "BANK_DEPOSIT") {
    return "Nộp tiền vào ngân hàng";
  }
  return voucherType === "RECEIPT" ? "Thu tiền khác" : "Chi tiền khác";
}

function createDirectEntryRow(
  voucherType: "RECEIPT" | "PAYMENT",
  paymentReason: PaymentReason,
  partnerName?: string
): DirectCashEntryRow {
  return {
    key: createDirectRowKey(),
    description: getDefaultDescription(voucherType, paymentReason, partnerName),
    amount: 0
  };
}

function createExpenseDirectEntryRow(partnerName?: string): DirectCashEntryRow {
  return {
    key: createDirectRowKey(),
    description: partnerName?.trim() ? `Chi mua ngoài có hóa đơn - ${partnerName.trim()}` : "Chi mua ngoài có hóa đơn",
    amount: 0
  };
}

function createExpenseTaxRow(seed?: { sourceEntryKey?: string; description?: string }): ExpenseInvoiceTaxRow {
  const baseDescription = seed?.description?.trim();
  return {
    key: `expense-tax-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceEntryKey: seed?.sourceEntryKey,
    taxDescription: baseDescription ? `Thuế GTGT - ${baseDescription}` : "Thuế GTGT",
    hasInvoice: true,
    vatRate: 10,
    vatAmount: 0,
    vatAccount: "1331",
    invoiceDate: dayjs(),
    invoiceNo: "",
    purchaseGroup: "1"
  };
}

function formatAmountInput(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  const normalized = String(value).replace(/\./g, "").replace(/,/g, ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return formatNumber(parsed);
}

function parseAmountInput(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Number(value.replace(/\./g, "").replace(/,/g, "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseMetadataDate(value: unknown): Dayjs | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

function parseMetadataString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseMetadataNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mapAllocationToInvoiceRow(
  allocation: VoucherAllocationItem,
  detail: VoucherDetail
): InvoiceSelectionRow {
  return {
    id: allocation.invoiceVoucherId,
    voucherNo: allocation.invoiceVoucherNo,
    type: allocation.invoiceVoucherType,
    partnerId: detail.partnerId,
    partnerName: detail.partnerName,
    voucherDate: allocation.invoiceVoucherDate,
    note: "",
    totalNetAmount: allocation.amountApplied,
    paidAmount: allocation.amountApplied,
    remainingAmount: allocation.amountApplied,
    paymentStatus: "PAID",
    checked: true,
    amountApplied: allocation.amountApplied
  };
}

export function CashVoucherDrawer(props: CashVoucherDrawerProps) {
  const { open, voucherType, paymentReason, invoiceBased, entryMode = "STANDARD", voucherId, onClose, onSuccess } = props;
  const isEditing = Boolean(voucherId);
  const [form] = Form.useForm<CashVoucherFormValues>();
  const [invoiceRows, setInvoiceRows] = useState<InvoiceSelectionRow[]>([]);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [bulkCollectAmount, setBulkCollectAmount] = useState(0);
  const [loadedPartnerId, setLoadedPartnerId] = useState<string | null>(null);
  const [directRows, setDirectRows] = useState<DirectCashEntryRow[]>([createDirectEntryRow(voucherType, paymentReason)]);
  const [expenseTaxRows, setExpenseTaxRows] = useState<ExpenseInvoiceTaxRow[]>([]);
  const [combineMultipleInvoices, setCombineMultipleInvoices] = useState(false);
  const [expenseActiveTab, setExpenseActiveTab] = useState<"ACCOUNTING" | "INVOICE">("ACCOUNTING");
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [partnerModalMode, setPartnerModalMode] = useState<"create" | "edit">("create");
  const isExpenseInvoicePaymentFlow = !invoiceBased && voucherType === "PAYMENT" && entryMode === "EXPENSE_INVOICE";
  const requiresPartner = paymentReason === "CUSTOMER_PAYMENT" || paymentReason === "SUPPLIER_PAYMENT";
  const requiresMandatoryPartner = requiresPartner || isExpenseInvoicePaymentFlow;
  const isOtherReceiptFlow = !invoiceBased && voucherType === "RECEIPT" && paymentReason === "OTHER";
  const isObjectStyleFlow = isOtherReceiptFlow || isExpenseInvoicePaymentFlow;
  const supportsPartnerLookup = requiresPartner || isObjectStyleFlow;
  const partnerGroup = paymentReason === "SUPPLIER_PAYMENT" || isExpenseInvoicePaymentFlow ? "SUPPLIER" : "CUSTOMER";
  const invoiceType = paymentReason === "SUPPLIER_PAYMENT" ? "PURCHASE" : "SALES";
  const isInvoiceReceiptFlow = invoiceBased && voucherType === "RECEIPT" && paymentReason === "CUSTOMER_PAYMENT";
  const selectedPartnerId = Form.useWatch("partnerId", form);
  const partnerNameValue = Form.useWatch("partnerName", form);
  const invoiceQueryPartnerId = isInvoiceReceiptFlow ? loadedPartnerId : selectedPartnerId;
  const partnerCodeLabel = isObjectStyleFlow ? "Mã đối tượng" : partnerGroup === "SUPPLIER" ? "Mã nhà cung cấp" : "Mã khách hàng";
  const partnerNameLabel = isObjectStyleFlow ? "Tên đối tượng" : partnerGroup === "SUPPLIER" ? "Tên nhà cung cấp" : "Tên khách hàng";
  const partnerPlaceholder =
    isObjectStyleFlow ? "Chọn đối tượng" : partnerGroup === "SUPPLIER" ? "Chọn nhà cung cấp" : "Chọn khách hàng";
  const reasonTitle = isInvoiceReceiptFlow
    ? "1. Thu tiền khách hàng (theo hóa đơn)"
    : paymentReason === "CUSTOMER_PAYMENT" && !invoiceBased
      ? "1. Thu tiền khách hàng (không theo hóa đơn)"
      : isExpenseInvoicePaymentFlow
        ? "3. Chi mua ngoài có hóa đơn"
      : paymentReason === "SUPPLIER_PAYMENT" && !invoiceBased
        ? "4. Trả tiền nhà cung cấp (không theo hóa đơn)"
      : isOtherReceiptFlow
        ? "4. Thu khác"
        : `1. ${paymentReasonLabelMap[paymentReason]}`;
  const partnerEntityLabel = isObjectStyleFlow ? "đối tượng" : partnerGroup === "SUPPLIER" ? "nhà cung cấp" : "khách hàng";
  const buildDefaultNote = useCallback(
    (partnerName?: string) => {
      if (isExpenseInvoicePaymentFlow) {
        const name = partnerName?.trim();
        return name ? `Chi mua ngoài có hóa đơn cho ${name}` : "Chi mua ngoài có hóa đơn";
      }
      return getDefaultDescription(voucherType, paymentReason, partnerName);
    },
    [isExpenseInvoicePaymentFlow, paymentReason, voucherType]
  );

  const partnersQuery = useQuery({
    queryKey: ["cash-voucher-partners", paymentReason, invoiceBased],
    queryFn: () => fetchPartners({ page: 1, pageSize: 200, group: partnerGroup }),
    enabled: open && supportsPartnerLookup
  });

  const unpaidInvoicesQuery = useQuery({
    queryKey: ["cash-voucher-unpaid", invoiceQueryPartnerId, invoiceType],
    queryFn: () => fetchUnpaidInvoices({ partnerId: invoiceQueryPartnerId as string, type: invoiceType }),
    enabled: open && invoiceBased && Boolean(invoiceQueryPartnerId) && !isEditing
  });

  const editingVoucherQuery = useQuery({
    queryKey: ["cash-voucher-editing-detail", voucherId],
    queryFn: () => fetchVoucherById(voucherId as string),
    enabled: open && isEditing && Boolean(voucherId)
  });

  const createMutation = useMutation({ mutationFn: createCashVoucher });
  const createPartnerMutation = useMutation({ mutationFn: createPartner });
  const updatePartnerMutation = useMutation({
    mutationFn: (input: { id: string; payload: Parameters<typeof updatePartner>[1] }) => updatePartner(input.id, input.payload)
  });

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setInvoiceRows([]);
      setInvoiceSearch("");
      setBulkCollectAmount(0);
      setLoadedPartnerId(null);
      setDirectRows([isExpenseInvoicePaymentFlow ? createExpenseDirectEntryRow() : createDirectEntryRow(voucherType, paymentReason)]);
      setExpenseTaxRows([]);
      setCombineMultipleInvoices(false);
      setExpenseActiveTab("ACCOUNTING");
      setPartnerModalOpen(false);
      setPartnerModalMode("create");
      return;
    }

    if (isEditing) {
      return;
    }

    const today = dayjs();
    form.setFieldsValue({
      accountingDate: today,
      voucherDate: today,
      voucherNo: "Tự sinh khi lưu",
      currency: "VND",
      salesEmployee: "",
      paymentMethod: "CASH",
      note: buildDefaultNote()
    });
    setInvoiceRows([]);
    setInvoiceSearch("");
    setBulkCollectAmount(0);
    setLoadedPartnerId(null);
    setDirectRows([isExpenseInvoicePaymentFlow ? createExpenseDirectEntryRow() : createDirectEntryRow(voucherType, paymentReason)]);
    setExpenseTaxRows(isExpenseInvoicePaymentFlow ? [createExpenseTaxRow()] : []);
    setCombineMultipleInvoices(false);
    setExpenseActiveTab("ACCOUNTING");
  }, [buildDefaultNote, form, isEditing, isExpenseInvoicePaymentFlow, open, paymentReason, voucherType]);

  useEffect(() => {
    if (!invoiceBased) {
      setInvoiceRows([]);
      setBulkCollectAmount(0);
      return;
    }

    if (isEditing) {
      return;
    }

    const nextRows = [...(unpaidInvoicesQuery.data ?? [])]
      .sort((a, b) => {
        const dateDiff = dayjs(a.voucherDate).valueOf() - dayjs(b.voucherDate).valueOf();
        if (dateDiff !== 0) {
          return dateDiff;
        }
        return (a.voucherNo ?? a.id).localeCompare(b.voucherNo ?? b.id);
      })
      .map((invoice) => ({
        ...invoice,
        checked: false,
        amountApplied: 0
      }));
    setInvoiceRows(nextRows);
    setBulkCollectAmount(0);
  }, [invoiceBased, isEditing, unpaidInvoicesQuery.data]);

  useEffect(() => {
    if (!open || !isEditing || !editingVoucherQuery.data) {
      return;
    }

    const detail = editingVoucherQuery.data;
    const metadata = asRecord(detail.metadata);
    const metadataEntries = Array.isArray(metadata.entries) ? metadata.entries : [];
    const metadataExpenseInvoice = asRecord(metadata.expenseInvoice);
    const metadataTaxRows = Array.isArray(metadataExpenseInvoice.taxRows) ? metadataExpenseInvoice.taxRows : [];
    const voucherDate = dayjs(detail.voucherDate);
    const dateValue = voucherDate.isValid() ? voucherDate : dayjs();

    form.setFieldsValue({
      partnerId: detail.partnerId ?? undefined,
      partnerName: parseMetadataString(metadata.partnerName) || detail.partnerName || "",
      payerName: parseMetadataString(metadata.payerName) || "",
      salesEmployee: parseMetadataString(metadata.salesEmployee) || "",
      currency: parseMetadataString(metadata.currency) || "VND",
      address: parseMetadataString(metadata.address) || detail.partnerAddress || "",
      taxCode: parseMetadataString(metadata.taxCode) || detail.partnerTaxCode || "",
      accountingDate: parseMetadataDate(metadata.accountingDate) ?? dateValue,
      voucherDate: dateValue,
      voucherNo: detail.voucherNo ?? detail.id.slice(0, 8),
      paymentMethod: detail.paymentMethod ?? "CASH",
      note: detail.note ?? ""
    });

    setLoadedPartnerId(detail.partnerId ?? null);
    setInvoiceSearch("");
    setPartnerModalOpen(false);
    setPartnerModalMode("create");

    if (invoiceBased) {
      const nextInvoiceRows = (detail.allocations ?? []).map((allocation) => mapAllocationToInvoiceRow(allocation, detail));
      setInvoiceRows(nextInvoiceRows);
      setBulkCollectAmount(nextInvoiceRows.reduce((sum, row) => sum + row.amountApplied, 0));
      setDirectRows([]);
      setExpenseTaxRows([]);
      setCombineMultipleInvoices(false);
      setExpenseActiveTab("ACCOUNTING");
      return;
    }

    const nextDirectRows = metadataEntries
      .map((entry, index) => {
        const record = asRecord(entry);
        const amount = parseMetadataNumber(record.amount);
        const description = parseMetadataString(record.description);

        if (!description && amount <= 0) {
          return null;
        }

        return {
          key: parseMetadataString(record.id) || `edit-entry-${index + 1}`,
          description,
          amount
        } satisfies DirectCashEntryRow;
      })
      .filter((row): row is DirectCashEntryRow => row !== null);

    setDirectRows(
      nextDirectRows.length > 0
        ? nextDirectRows
        : [
            (() => {
              const fallback = isExpenseInvoicePaymentFlow
                ? createExpenseDirectEntryRow(detail.partnerName ?? undefined)
                : createDirectEntryRow(voucherType, paymentReason, detail.partnerName ?? undefined);
              return {
                ...fallback,
                description: detail.note ?? fallback.description,
                amount: detail.totalNetAmount
              };
            })()
          ]
    );

    const nextTaxRows = metadataTaxRows
      .map((row, index) => {
        const record = asRecord(row);
        return {
          key: parseMetadataString(record.id) || `edit-tax-${index + 1}`,
          sourceEntryKey: parseMetadataString(record.sourceEntryKey) || undefined,
          taxDescription: parseMetadataString(record.taxDescription),
          hasInvoice: typeof record.hasInvoice === "boolean" ? record.hasInvoice : true,
          vatRate: parseMetadataNumber(record.vatRate),
          vatAmount: parseMetadataNumber(record.vatAmount),
          vatAccount: parseMetadataString(record.vatAccount) || "1331",
          invoiceDate: parseMetadataDate(record.invoiceDate),
          invoiceNo: parseMetadataString(record.invoiceNo),
          purchaseGroup: parseMetadataString(record.purchaseGroup) || "1"
        } satisfies ExpenseInvoiceTaxRow;
      })
      .filter((row) => row.taxDescription || row.vatAmount > 0 || row.invoiceNo);

    setExpenseTaxRows(nextTaxRows.length > 0 ? nextTaxRows : isExpenseInvoicePaymentFlow ? [createExpenseTaxRow()] : []);
    setCombineMultipleInvoices(Boolean(metadataExpenseInvoice.combineMultipleInvoices));
    setExpenseActiveTab("ACCOUNTING");
    setBulkCollectAmount(0);
  }, [
    editingVoucherQuery.data,
    form,
    invoiceBased,
    isEditing,
    isExpenseInvoicePaymentFlow,
    open,
    paymentReason,
    voucherType
  ]);

  useEffect(() => {
    if (!isExpenseInvoicePaymentFlow || combineMultipleInvoices) {
      return;
    }

    setExpenseTaxRows((prev) => {
      const prevBySource = new Map(prev.filter((row) => row.sourceEntryKey).map((row) => [row.sourceEntryKey as string, row]));
      return directRows.map((entry) => {
        const existing = prevBySource.get(entry.key);
        if (existing) {
          return {
            ...existing,
            taxDescription: existing.taxDescription || `Thuế GTGT - ${entry.description}`
          };
        }
        return createExpenseTaxRow({ sourceEntryKey: entry.key, description: entry.description });
      });
    });
  }, [combineMultipleInvoices, directRows, isExpenseInvoicePaymentFlow]);

  const partnerMap = useMemo(() => {
    const map = new Map<string, PartnerOption>();
    (partnersQuery.data?.items ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [partnersQuery.data?.items]);

  const partnerOptions = useMemo(
    () => (partnersQuery.data?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
    [partnersQuery.data?.items]
  );

  const selectedPartner = selectedPartnerId ? partnerMap.get(selectedPartnerId) : undefined;

  const partnerModalInitialValues: Partial<PartnerFormValues> | undefined = useMemo(() => {
    if (partnerModalMode !== "edit") {
      if (!supportsPartnerLookup) {
        return undefined;
      }
      return {
        code: "",
        name: String(form.getFieldValue("partnerName") ?? ""),
        partnerType: partnerGroup,
        phone: "",
        taxCode: String(form.getFieldValue("taxCode") ?? ""),
        address: String(form.getFieldValue("address") ?? "")
      };
    }

    if (!selectedPartner) {
      return undefined;
    }

    return {
      code: selectedPartner.code,
      name: selectedPartner.name,
      partnerType: selectedPartner.partnerType,
      phone: selectedPartner.phone ?? "",
      taxCode: selectedPartner.taxCode ?? "",
      address: selectedPartner.address ?? ""
    };
  }, [form, partnerGroup, partnerModalMode, selectedPartner, supportsPartnerLookup]);

  const selectedAllocations = useMemo(
    () =>
      invoiceRows
        .filter((row) => row.checked && row.amountApplied > 0)
        .map((row) => ({
          invoiceId: row.id,
          amountApplied: row.amountApplied
        })) satisfies CashVoucherAllocationInput[],
    [invoiceRows]
  );

  const totalAllocated = useMemo(
    () => selectedAllocations.reduce((sum, row) => sum + row.amountApplied, 0),
    [selectedAllocations]
  );

  const directTotalAmount = useMemo(
    () => directRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [directRows]
  );

  useEffect(() => {
    if (isInvoiceReceiptFlow) {
      setBulkCollectAmount(totalAllocated);
    }
  }, [isInvoiceReceiptFlow, totalAllocated]);

  const filteredInvoiceRows = useMemo(() => {
    const keyword = invoiceSearch.trim().toLowerCase();
    if (!keyword) {
      return invoiceRows;
    }

    return invoiceRows.filter((row) => {
      const voucherNo = (row.voucherNo ?? "").toLowerCase();
      const note = (row.note ?? "").toLowerCase();
      return voucherNo.includes(keyword) || note.includes(keyword);
    });
  }, [invoiceRows, invoiceSearch]);

  const filteredInvoiceSummary = useMemo(
    () =>
      filteredInvoiceRows.reduce(
        (acc, row) => {
          acc.totalNetAmount += row.totalNetAmount;
          acc.totalRemainingAmount += row.remainingAmount;
          acc.totalAppliedAmount += row.amountApplied;
          return acc;
        },
        {
          totalNetAmount: 0,
          totalRemainingAmount: 0,
          totalAppliedAmount: 0
        }
      ),
    [filteredInvoiceRows]
  );

  const applyAutomaticAllocation = (nextTotalAmount: number) => {
    let remaining = Math.max(0, Number(nextTotalAmount) || 0);
    setInvoiceRows((prev) =>
      prev.map((row) => {
        const amountApplied = Math.min(remaining, row.remainingAmount);
        remaining = Math.max(0, remaining - amountApplied);
        return {
          ...row,
          checked: amountApplied > 0,
          amountApplied
        };
      })
    );
  };

  const handleBulkCollectAmountChange = (nextValue: number | null) => {
    const normalized = Math.max(0, Number(nextValue ?? 0));
    setBulkCollectAmount(normalized);
    applyAutomaticAllocation(normalized);
  };

  const handlePartnerChange = (partnerId?: string) => {
    const partner = partnerId ? partnerMap.get(partnerId) : undefined;
    const nextPartnerName = partner?.name ?? "";
    form.setFieldsValue({
      partnerId,
      partnerName: nextPartnerName,
      payerName: nextPartnerName,
      address: partner?.address ?? "",
      taxCode: partner?.taxCode ?? "",
      note: buildDefaultNote(nextPartnerName)
    });

    if (isInvoiceReceiptFlow) {
      setLoadedPartnerId(null);
      setInvoiceRows([]);
      setBulkCollectAmount(0);
    }

    if (!invoiceBased) {
      setDirectRows((prev) =>
        prev.map((row, index) =>
          index === 0
            ? {
                ...row,
                description: isExpenseInvoicePaymentFlow
                  ? createExpenseDirectEntryRow(nextPartnerName).description
                  : getDefaultDescription(voucherType, paymentReason, nextPartnerName)
              }
            : row
        )
      );
    }
  };

  const handleLoadInvoiceData = async () => {
    const values = await form.validateFields(["partnerId", "voucherDate"]);
    const nextPartnerId = values.partnerId as string;
    setLoadedPartnerId(nextPartnerId);

    if (nextPartnerId === loadedPartnerId) {
      await unpaidInvoicesQuery.refetch();
    }
  };

  const openCreatePartnerModal = () => {
    setPartnerModalMode("create");
    setPartnerModalOpen(true);
  };

  const openEditPartnerModal = () => {
    if (!selectedPartnerId) {
      message.warning(`Vui lòng chọn ${partnerEntityLabel} trước khi sửa.`);
      return;
    }
    setPartnerModalMode("edit");
    setPartnerModalOpen(true);
  };

  const persistPartnerDraftIfNeeded = async () => {
    if (!selectedPartnerId) {
      return;
    }

    const currentPartner = partnerMap.get(selectedPartnerId);
    if (!currentPartner) {
      return;
    }

    const nextName = String(form.getFieldValue("partnerName") ?? "").trim();
    const nextTaxCode = String(form.getFieldValue("taxCode") ?? "").trim();
    const nextAddress = String(form.getFieldValue("address") ?? "").trim();
    const payload: Parameters<typeof updatePartner>[1] = {};

    if (nextName && nextName !== currentPartner.name) {
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

    await updatePartnerMutation.mutateAsync({ id: selectedPartnerId, payload });
    await partnersQuery.refetch();
  };

  const updateDirectRow = (rowKey: string, patch: Partial<DirectCashEntryRow>) => {
    setDirectRows((prev) => prev.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  };

  const addDirectRow = () => {
    setDirectRows((prev) => [
      ...prev,
      isExpenseInvoicePaymentFlow
        ? createExpenseDirectEntryRow(String(form.getFieldValue("partnerName") ?? ""))
      : createDirectEntryRow(voucherType, paymentReason, String(form.getFieldValue("partnerName") ?? ""))
    ]);
  };

  const directEditableKeys = ["description", "amount"] as const;
  type DirectEditableKey = (typeof directEditableKeys)[number];

  const buildDirectCellId = (rowKey: string, columnKey: DirectEditableKey) => `cash-direct-${rowKey}-${columnKey}`;

  const focusDirectCellByKey = (rowKey: string, columnKey: DirectEditableKey) => {
    const target = document.getElementById(buildDirectCellId(rowKey, columnKey)) as HTMLInputElement | null;
    if (target) {
      target.focus();
      target.select?.();
    }
  };

  const addDirectRowAndFocus = (columnKey: DirectEditableKey) => {
    const newRow = isExpenseInvoicePaymentFlow
      ? createExpenseDirectEntryRow(String(form.getFieldValue("partnerName") ?? ""))
      : createDirectEntryRow(voucherType, paymentReason, String(form.getFieldValue("partnerName") ?? ""));
    setDirectRows((prev) => [...prev, newRow]);
    requestAnimationFrame(() => focusDirectCellByKey(newRow.key, columnKey));
  };

  const handleDirectCellKeyDown =
    (rowIndex: number, columnKey: DirectEditableKey) => (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex = rowIndex - 1;
        if (prevIndex >= 0 && directRows[prevIndex]) {
          focusDirectCellByKey(directRows[prevIndex].key, columnKey);
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = rowIndex + 1;
        if (nextIndex < directRows.length && directRows[nextIndex]) {
          focusDirectCellByKey(directRows[nextIndex].key, columnKey);
        } else {
          addDirectRowAndFocus(columnKey);
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const currentIndex = directEditableKeys.indexOf(columnKey);
        if (currentIndex > 0) {
          focusDirectCellByKey(directRows[rowIndex].key, directEditableKeys[currentIndex - 1]);
        }
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const currentIndex = directEditableKeys.indexOf(columnKey);
        if (currentIndex >= 0 && currentIndex < directEditableKeys.length - 1) {
          focusDirectCellByKey(directRows[rowIndex].key, directEditableKeys[currentIndex + 1]);
        }
      }
    };

  const clearDirectRows = () => {
    setDirectRows([
      isExpenseInvoicePaymentFlow
        ? createExpenseDirectEntryRow(String(form.getFieldValue("partnerName") ?? ""))
        : createDirectEntryRow(voucherType, paymentReason, String(form.getFieldValue("partnerName") ?? ""))
    ]);
    if (isExpenseInvoicePaymentFlow) {
      setExpenseTaxRows([createExpenseTaxRow()]);
    }
  };

  const deleteDirectRow = (rowKey: string) => {
    setDirectRows((prev) => {
      const nextRows = prev.filter((row) => row.key !== rowKey);
      return nextRows.length > 0
        ? nextRows
        : [
            isExpenseInvoicePaymentFlow
              ? createExpenseDirectEntryRow(String(form.getFieldValue("partnerName") ?? ""))
              : createDirectEntryRow(voucherType, paymentReason, String(form.getFieldValue("partnerName") ?? ""))
          ];
    });
    if (isExpenseInvoicePaymentFlow && combineMultipleInvoices) {
      setExpenseTaxRows((prev) => prev.filter((row) => row.sourceEntryKey !== rowKey));
    }
  };

  const allocationColumns: ColumnsType<InvoiceSelectionRow> = [
    {
      title: "",
      key: "checked",
      width: 48,
      align: "center",
      render: (_value, record) => (
        <input
          type="checkbox"
          checked={record.checked}
          onChange={(event) => {
            const checked = event.target.checked;
            setInvoiceRows((prev) =>
              prev.map((row) =>
                row.id !== record.id
                  ? row
                  : {
                      ...row,
                      checked,
                      amountApplied: checked ? (row.amountApplied > 0 ? row.amountApplied : row.remainingAmount) : 0
                    }
              )
            );
          }}
        />
      )
    },
    {
      title: "Ngày chứng từ",
      dataIndex: "voucherDate",
      key: "voucherDate",
      width: 120,
      render: (value: string) => dayjs(value).format("DD/MM/YYYY")
    },
    {
      title: "Số chứng từ",
      dataIndex: "voucherNo",
      key: "voucherNo",
      width: 120,
      render: (value: string | null, record) => value ?? record.id.slice(0, 8)
    },
    {
      title: "Số hóa đơn",
      key: "invoiceNo",
      width: 120,
      render: (_value, record) => record.voucherNo ?? record.id.slice(0, 8)
    },
    {
      title: "Diễn giải",
      dataIndex: "note",
      key: "note",
      ellipsis: true,
      render: (value: string | null) => value ?? "-"
    },
    {
      title: "Hạn thanh toán",
      key: "dueDate",
      width: 130,
      render: () => "-"
    },
    {
      title: "Số phải thu",
      dataIndex: "totalNetAmount",
      key: "totalNetAmount",
      width: 130,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "Số chưa thu",
      dataIndex: "remainingAmount",
      key: "remainingAmount",
      width: 130,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    {
      title: voucherType === "RECEIPT" ? "Số thu" : "Số trả",
      dataIndex: "amountApplied",
      key: "amountApplied",
      width: 130,
      align: "right",
      render: (value: number, record) => (
        <InputNumber
          value={value}
          min={0}
          max={record.remainingAmount}
          controls={false}
          style={{ width: "100%" }}
          formatter={formatAmountInput}
          parser={parseAmountInput}
          onChange={(nextValue) => {
            const normalized = Math.max(0, Math.min(Number(nextValue ?? 0), record.remainingAmount));
            setInvoiceRows((prev) =>
              prev.map((row) =>
                row.id !== record.id
                  ? row
                  : {
                      ...row,
                      checked: normalized > 0,
                      amountApplied: normalized
                    }
              )
            );
          }}
        />
      )
    }
  ];

  const directColumns = useMemo<ColumnsType<DirectCashEntryRow>>(() => {
    const columns: ColumnsType<DirectCashEntryRow> = [
      {
        title: "#",
        key: "stt",
        width: 56,
        align: "center",
        render: (_value, _record, index) => index + 1
      },
        {
          title: "Diễn giải",
          dataIndex: "description",
          key: "description",
          render: (value: string, record, rowIndex) => (
            <Input
              id={buildDirectCellId(record.key, "description")}
              value={value}
              onKeyDown={handleDirectCellKeyDown(rowIndex, "description")}
              onChange={(event) => updateDirectRow(record.key, { description: event.target.value })}
            />
          )
        },
        {
          title: "Số tiền",
          dataIndex: "amount",
          key: "amount",
          width: 180,
          align: "right",
          render: (value: number, record, rowIndex) => (
            <InputNumber
              id={buildDirectCellId(record.key, "amount")}
              value={value}
              min={0}
              controls={false}
              style={{ width: "100%" }}
              formatter={formatAmountInput}
              parser={parseAmountInput}
              onKeyDown={handleDirectCellKeyDown(rowIndex, "amount")}
              onChange={(nextValue) => updateDirectRow(record.key, { amount: Number(nextValue ?? 0) })}
            />
          )
        }
    ];

    if (isObjectStyleFlow) {
      columns.push(
        {
          title: "Đối tượng",
          key: "partnerCode",
          width: 160,
          render: () => selectedPartner?.code ?? "-"
        },
        {
          title: "Tên đối tượng",
          key: "partnerName",
          width: 240,
          render: () => (String(partnerNameValue ?? "").trim() || selectedPartner?.name || "-")
        }
      );
    }

    columns.push({
      title: "",
      key: "action",
      align: "center",
      width: 56,
      render: (_value, record) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => deleteDirectRow(record.key)} />
      )
    });

    return columns;
  }, [isObjectStyleFlow, partnerNameValue, selectedPartner?.code, selectedPartner?.name]);

  const expenseTaxTotal = useMemo(
    () => expenseTaxRows.reduce((sum, row) => sum + Number(row.vatAmount || 0), 0),
    [expenseTaxRows]
  );

  const updateExpenseTaxRow = (rowKey: string, patch: Partial<ExpenseInvoiceTaxRow>) => {
    setExpenseTaxRows((prev) => prev.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
  };

  const addExpenseTaxRow = () => {
    setExpenseTaxRows((prev) => [...prev, createExpenseTaxRow()]);
  };

  const clearExpenseTaxRows = () => {
    setExpenseTaxRows([createExpenseTaxRow()]);
  };

  const deleteExpenseTaxRow = (rowKey: string) => {
    setExpenseTaxRows((prev) => {
      const nextRows = prev.filter((row) => row.key !== rowKey);
      return nextRows.length ? nextRows : [createExpenseTaxRow()];
    });
  };

  const expenseEditableKeys = [
    "taxDescription",
    "vatRate",
    "vatAmount",
    "vatAccount",
    "invoiceDate",
    "invoiceNo",
    "purchaseGroup"
  ] as const;
  type ExpenseEditableKey = (typeof expenseEditableKeys)[number];

  const buildExpenseCellId = (rowKey: string, columnKey: ExpenseEditableKey) => `cash-expense-${rowKey}-${columnKey}`;

  const focusExpenseCellByKey = (rowKey: string, columnKey: ExpenseEditableKey) => {
    const target = document.getElementById(buildExpenseCellId(rowKey, columnKey)) as HTMLInputElement | null;
    if (target) {
      target.focus();
      target.select?.();
    }
  };

  const addExpenseRowAndFocus = (columnKey: ExpenseEditableKey) => {
    const newRow = createExpenseTaxRow();
    setExpenseTaxRows((prev) => [...prev, newRow]);
    requestAnimationFrame(() => focusExpenseCellByKey(newRow.key, columnKey));
  };

  const handleExpenseCellKeyDown =
    (rowIndex: number, columnKey: ExpenseEditableKey) => (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex = rowIndex - 1;
        if (prevIndex >= 0 && expenseTaxRows[prevIndex]) {
          focusExpenseCellByKey(expenseTaxRows[prevIndex].key, columnKey);
        }
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = rowIndex + 1;
        if (nextIndex < expenseTaxRows.length && expenseTaxRows[nextIndex]) {
          focusExpenseCellByKey(expenseTaxRows[nextIndex].key, columnKey);
        } else {
          addExpenseRowAndFocus(columnKey);
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const currentIndex = expenseEditableKeys.indexOf(columnKey);
        if (currentIndex > 0) {
          focusExpenseCellByKey(expenseTaxRows[rowIndex].key, expenseEditableKeys[currentIndex - 1]);
        }
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const currentIndex = expenseEditableKeys.indexOf(columnKey);
        if (currentIndex >= 0 && currentIndex < expenseEditableKeys.length - 1) {
          focusExpenseCellByKey(expenseTaxRows[rowIndex].key, expenseEditableKeys[currentIndex + 1]);
        }
      }
    };

  const expenseTaxColumns: ColumnsType<ExpenseInvoiceTaxRow> = [
    {
      title: "#",
      key: "stt",
      width: 56,
      align: "center",
      render: (_value, _record, index) => index + 1
    },
      {
        title: "Diễn giải thuế",
        dataIndex: "taxDescription",
        key: "taxDescription",
        render: (value: string, record, rowIndex) => (
          <Input
            id={buildExpenseCellId(record.key, "taxDescription")}
            value={value}
            onKeyDown={handleExpenseCellKeyDown(rowIndex, "taxDescription")}
            onChange={(event) => updateExpenseTaxRow(record.key, { taxDescription: event.target.value })}
          />
        )
      },
    {
      title: "Có hóa đơn",
      dataIndex: "hasInvoice",
      key: "hasInvoice",
      width: 110,
      align: "center",
      render: (value: boolean, record) => (
        <Checkbox checked={value} onChange={(event) => updateExpenseTaxRow(record.key, { hasInvoice: event.target.checked })} />
      )
    },
      {
        title: "% Thuế GTGT",
        dataIndex: "vatRate",
        key: "vatRate",
        width: 120,
        align: "right",
        render: (value: number, record, rowIndex) => (
          <InputNumber
            id={buildExpenseCellId(record.key, "vatRate")}
            value={value}
            min={0}
            max={100}
            controls={false}
            style={{ width: "100%" }}
            onKeyDown={handleExpenseCellKeyDown(rowIndex, "vatRate")}
            onChange={(nextValue) => updateExpenseTaxRow(record.key, { vatRate: Number(nextValue ?? 0) })}
          />
        )
      },
      {
        title: "Tiền thuế GTGT",
        dataIndex: "vatAmount",
        key: "vatAmount",
        width: 150,
        align: "right",
        render: (value: number, record, rowIndex) => (
          <InputNumber
            id={buildExpenseCellId(record.key, "vatAmount")}
            value={value}
            min={0}
            controls={false}
            style={{ width: "100%" }}
            formatter={formatAmountInput}
            parser={parseAmountInput}
            onKeyDown={handleExpenseCellKeyDown(rowIndex, "vatAmount")}
            onChange={(nextValue) => updateExpenseTaxRow(record.key, { vatAmount: Number(nextValue ?? 0) })}
          />
        )
      },
      {
        title: "TK thuế GTGT",
        dataIndex: "vatAccount",
        key: "vatAccount",
        width: 120,
        render: (value: string, record, rowIndex) => (
          <Input
            id={buildExpenseCellId(record.key, "vatAccount")}
            value={value}
            onKeyDown={handleExpenseCellKeyDown(rowIndex, "vatAccount")}
            onChange={(event) => updateExpenseTaxRow(record.key, { vatAccount: event.target.value })}
          />
        )
      },
      {
        title: "Ngày hóa đơn",
        dataIndex: "invoiceDate",
        key: "invoiceDate",
        width: 140,
        render: (value: Dayjs | null, record, rowIndex) => (
          <DatePicker
            id={buildExpenseCellId(record.key, "invoiceDate")}
            value={value}
            format="DD/MM/YYYY"
            style={{ width: "100%" }}
            onKeyDown={handleExpenseCellKeyDown(rowIndex, "invoiceDate")}
            onChange={(nextValue) => updateExpenseTaxRow(record.key, { invoiceDate: nextValue })}
          />
        )
      },
      {
        title: "Số hóa đơn",
        dataIndex: "invoiceNo",
        key: "invoiceNo",
        width: 120,
        render: (value: string, record, rowIndex) => (
          <Input
            id={buildExpenseCellId(record.key, "invoiceNo")}
            value={value}
            onKeyDown={handleExpenseCellKeyDown(rowIndex, "invoiceNo")}
            onChange={(event) => updateExpenseTaxRow(record.key, { invoiceNo: event.target.value })}
          />
        )
      },
      {
        title: "Nhóm HHDV mua vào",
        dataIndex: "purchaseGroup",
        key: "purchaseGroup",
        width: 180,
        render: (value: string, record, rowIndex) => (
          <Input
            id={buildExpenseCellId(record.key, "purchaseGroup")}
            value={value}
            onKeyDown={handleExpenseCellKeyDown(rowIndex, "purchaseGroup")}
            onChange={(event) => updateExpenseTaxRow(record.key, { purchaseGroup: event.target.value })}
          />
        )
      },
    {
      title: "",
      key: "action",
      align: "center",
      width: 56,
      render: (_value, record) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => deleteExpenseTaxRow(record.key)} />
      )
    }
  ];

  const handleToggleCombineInvoices = (checked: boolean) => {
    setCombineMultipleInvoices(checked);
    if (!checked && expenseActiveTab === "INVOICE") {
      setExpenseActiveTab("ACCOUNTING");
    }
  };

  const handlePrintEditingVoucher = async () => {
    if (!voucherId) {
      return;
    }
    const detail = editingVoucherQuery.data;
    if (!detail) {
      message.warning("Đang tải dữ liệu chứng từ, vui lòng thử lại.");
      return;
    }
    await downloadVoucherPdf(detail.id, detail.voucherNo ?? detail.id, detail.type);
  };

  const handleSubmit = async (shouldPrint: boolean) => {
    if (isEditing) {
      message.warning("API cập nhật phiếu thu/chi đang được phát triển. Hiện tại bạn có thể xem, sửa nháp và in chứng từ.");
      return;
    }

    const baseFields = invoiceBased
      ? ["partnerId", "voucherDate", "paymentMethod"]
      : ["accountingDate", "voucherDate", "paymentMethod", ...(requiresMandatoryPartner ? ["partnerId"] : [])];
    const values = await form.validateFields(baseFields);

    if (invoiceBased) {
      if (selectedAllocations.length === 0 || totalAllocated <= 0) {
        message.warning("Vui lòng chọn chứng từ và nhập số thu.");
        return;
      }
      if (isInvoiceReceiptFlow) {
        setBulkCollectAmount(totalAllocated);
      }
    } else {
      if (directTotalAmount <= 0) {
        message.warning("Vui lòng nhập ít nhất một dòng hạch toán có số tiền lớn hơn 0.");
        return;
      }

      const invalidRow = directRows.find(
        (row) =>
          row.amount > 0 &&
          row.description.trim().length === 0
      );
      if (invalidRow) {
        message.warning("Các dòng hạch toán phải có diễn giải và số tiền hợp lệ.");
        return;
      }

      if (supportsPartnerLookup) {
        await persistPartnerDraftIfNeeded();
      }
    }

    const payload = invoiceBased
      ? {
          voucherType,
          paymentReason,
          partnerId: values.partnerId,
          amount: totalAllocated,
          isInvoiceBased: true,
          voucherDate: values.voucherDate?.toISOString(),
          note: values.note,
          paymentMethod: values.paymentMethod,
          allocations: selectedAllocations,
          metadata: {
            currency: values.currency ?? "VND",
            salesEmployee: values.salesEmployee ?? "",
            collectedDate: values.voucherDate?.toISOString()
          }
        }
      : (() => {
          const metadata: Record<string, unknown> = {
            accountingDate: values.accountingDate?.toISOString(),
            voucherDate: values.voucherDate?.toISOString(),
            entries: directRows
              .filter((row) => row.amount > 0)
              .map((row) => ({
                id: row.key,
                description: row.description.trim(),
                amount: Number(row.amount)
              }))
          };

          const partnerName = String(values.partnerName ?? "").trim();
          const payerName = String(values.payerName ?? "").trim();
          const address = String(values.address ?? "").trim();
          const taxCode = String(values.taxCode ?? "").trim();
          const currency = String(values.currency ?? "VND").trim();

          if (partnerName) {
            metadata.partnerName = partnerName;
          }
          if (selectedPartner?.code) {
            metadata.partnerCode = selectedPartner.code;
          }
          if (payerName) {
            metadata.payerName = payerName;
          }
          if (address) {
            metadata.address = address;
          }
          if (taxCode) {
            metadata.taxCode = taxCode;
          }
          if (currency) {
            metadata.currency = currency;
          }
          if (isExpenseInvoicePaymentFlow) {
            metadata.expenseInvoice = {
              combineMultipleInvoices,
              invoiceTabMode: combineMultipleInvoices ? "INVOICE_DECLARATION" : "INVOICE_AND_TAX_ACCOUNTING",
              taxRows: expenseTaxRows.map((row) => ({
                id: row.key,
                sourceEntryKey: row.sourceEntryKey ?? null,
                taxDescription: row.taxDescription,
                hasInvoice: row.hasInvoice,
                vatRate: Number(row.vatRate || 0),
                vatAmount: Number(row.vatAmount || 0),
                vatAccount: row.vatAccount,
                invoiceDate: row.invoiceDate ? row.invoiceDate.toISOString() : null,
                invoiceNo: row.invoiceNo,
                purchaseGroup: row.purchaseGroup
              }))
            };
          }

          return {
            voucherType,
            paymentReason,
            partnerId: values.partnerId,
            amount: directTotalAmount,
            isInvoiceBased: false,
            voucherDate: values.accountingDate?.toISOString(),
            note: values.note,
            paymentMethod: values.paymentMethod,
            allocations: [],
            metadata
          };
        })();

    const result = await createMutation.mutateAsync(payload);
    message.success(voucherType === "RECEIPT" ? "Tạo phiếu thu thành công." : "Tạo phiếu chi thành công.");

    if (shouldPrint) {
      await downloadVoucherPdf(result.voucherId, result.voucherNo ?? result.voucherId, voucherType);
    }

    onSuccess(result);
  };

  const drawerTitle = voucherType === "RECEIPT" ? "Phiếu thu" : "Phiếu chi";
  const screenTotalAmount = invoiceBased ? totalAllocated : directTotalAmount;

  return (
    <>
      <Drawer
        width="100%"
        destroyOnClose
        open={open}
        title={<span className="sales-voucher-drawer-title">{drawerTitle}</span>}
        onClose={onClose}
        rootClassName="sales-voucher-drawer cash-voucher-drawer"
        styles={{ body: { paddingBottom: 12 } }}
        footer={
          <div className="sales-voucher-sticky-footer sales-voucher-sticky-footer-dark">
            <Button className="sales-voucher-footer-button sales-voucher-footer-button-secondary" onClick={onClose}>
              Hủy
            </Button>
            <Space>
              {isEditing ? (
                <>
                  <Button
                    className="sales-voucher-footer-button sales-voucher-footer-button-primary"
                    loading={editingVoucherQuery.isFetching}
                    onClick={() => void handlePrintEditingVoucher()}
                  >
                    In
                  </Button>
                  <Button
                    className="sales-voucher-footer-button sales-voucher-footer-button-primary"
                    onClick={() => void handleSubmit(false)}
                  >
                    Cất
                  </Button>
                </>
              ) : isInvoiceReceiptFlow ? (
                <Button
                  className="sales-voucher-footer-button sales-voucher-footer-button-primary"
                  loading={createMutation.isPending}
                  onClick={() => void handleSubmit(false)}
                >
                  Thu tiền
                </Button>
              ) : invoiceBased ? (
                <Button
                  className="sales-voucher-footer-button sales-voucher-footer-button-primary"
                  loading={createMutation.isPending}
                  onClick={() => void handleSubmit(false)}
                >
                  {voucherType === "RECEIPT" ? "Thu tiền" : "Chi tiền"}
                </Button>
              ) : (
                <>
                  <Button
                    className="sales-voucher-footer-button sales-voucher-footer-button-primary"
                    loading={createMutation.isPending}
                    onClick={() => void handleSubmit(false)}
                  >
                    Cất
                  </Button>
                  <Button
                    className="sales-voucher-footer-button sales-voucher-footer-button-primary"
                    loading={createMutation.isPending}
                    onClick={() => void handleSubmit(true)}
                  >
                    Cất và In
                  </Button>
                </>
              )}
            </Space>
          </div>
        }
      >
        <div className="sales-voucher-screen cash-voucher-screen">
          <div className="sales-voucher-topbar">
            <Space wrap className="sales-voucher-payment-row">
              <div className="cash-voucher-reason-pill">{reasonTitle}</div>
            </Space>
            <div className="sales-voucher-topbar-total">
              <span>{isInvoiceReceiptFlow ? "Số thu" : "Tổng tiền"}</span>
              <strong>{formatCurrency(screenTotalAmount)}</strong>
            </div>
          </div>

          <div className="sales-voucher-mode-tabs">
            <button type="button" className="sales-voucher-mode-tab sales-voucher-mode-tab-active">
              {drawerTitle}
            </button>
          </div>

          <Form<CashVoucherFormValues> form={form} layout="vertical" className="sales-voucher-form">
            {isInvoiceReceiptFlow ? (
              <div className="sales-voucher-meta-layout sales-voucher-meta-layout-misa">
                <div className="sales-voucher-panel sales-voucher-panel-main">
                  <Row gutter={12}>
                    <Col span={24}>
                      <Space wrap className="cash-voucher-param-row">
                        <Form.Item
                          label="Phương thức thanh toán"
                          name="paymentMethod"
                          rules={[{ required: true, message: "Bắt buộc chọn phương thức" }]}
                          style={{ marginBottom: 8 }}
                        >
                          <Radio.Group
                            options={[
                              { label: "Tiền mặt", value: "CASH" },
                              { label: "Tiền gửi", value: "TRANSFER" }
                            ]}
                          />
                        </Form.Item>
                      </Space>
                    </Col>
                    <Col xs={24} lg={8}>
                      <Form.Item label="Khách hàng" name="partnerId" rules={[{ required: true, message: "Bắt buộc chọn khách hàng" }]}>
                        <AppSelect
                          showSearch
                          optionFilterProp="label"
                          placeholder="Chọn khách hàng"
                          loading={partnersQuery.isFetching}
                          options={partnerOptions}
                          onChange={(value) => handlePartnerChange(value as string | undefined)}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={8}>
                      <Form.Item label="Nhân viên bán hàng" name="salesEmployee">
                        <Input placeholder="Nhập tên nhân viên" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={5}>
                      <Form.Item label="Ngày thu tiền" name="voucherDate" rules={[{ required: true, message: "Bắt buộc" }]}>
                        <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={3}>
                      <Form.Item label=" " style={{ marginBottom: 0 }}>
                        <Button onClick={() => void handleLoadInvoiceData()} style={{ marginTop: 4 }}>
                          Lấy dữ liệu
                        </Button>
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item label="Diễn giải" name="note">
                        <Input placeholder="Nhập diễn giải (không bắt buộc)" />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              </div>
            ) : (
              <div className="sales-voucher-meta-layout sales-voucher-meta-layout-misa">
                <div className="sales-voucher-panel sales-voucher-panel-main">
                  <Row gutter={12}>
                    {supportsPartnerLookup ? (
                      <Col xs={24} lg={7}>
                        <Form.Item
                          label={partnerCodeLabel}
                          name="partnerId"
                          rules={requiresMandatoryPartner ? [{ required: true, message: "Bắt buộc chọn đối tượng" }] : undefined}
                        >
                          <Space.Compact style={{ width: "100%" }}>
                            <AppSelect
                              showSearch
                              optionFilterProp="label"
                              placeholder={partnerPlaceholder}
                              loading={partnersQuery.isFetching}
                              options={partnerOptions}
                              onChange={(value) => handlePartnerChange(value as string | undefined)}
                              style={{ flex: 1 }}
                            />
                            <Button icon={<PlusOutlined />} onClick={openCreatePartnerModal} />
                            <Button icon={<EditOutlined />} onClick={openEditPartnerModal} disabled={!selectedPartnerId} />
                          </Space.Compact>
                        </Form.Item>
                      </Col>
                    ) : null}
                    <Col xs={24} lg={supportsPartnerLookup ? 11 : 18}>
                      <Form.Item label={partnerNameLabel} name="partnerName">
                        <Input placeholder={`Nhập ${partnerEntityLabel}`} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                      <Form.Item label="Ngày hạch toán" name="accountingDate" rules={[{ required: true, message: "Bắt buộc" }]}>
                        <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                      <Form.Item label="Phương thức" name="paymentMethod" rules={[{ required: true, message: "Bắt buộc" }]}>
                        <AppSelect
                          options={[
                            { value: "CASH", label: "Tiền mặt" },
                            { value: "TRANSFER", label: "Chuyển khoản" }
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={7}>
                      <Form.Item label={voucherType === "RECEIPT" ? "Người nộp" : "Người nhận"} name="payerName">
                        <Input placeholder={voucherType === "RECEIPT" ? "Nhập người nộp" : "Nhập người nhận"} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={11}>
                      <Form.Item label="Địa chỉ" name="address">
                        <Input placeholder="Nhập địa chỉ" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                      <Form.Item
                        label={voucherType === "RECEIPT" ? "Ngày phiếu thu" : "Ngày phiếu chi"}
                        name="voucherDate"
                        rules={[{ required: true, message: "Bắt buộc" }]}
                      >
                        <DatePicker style={{ width: "100%" }} format="DD/MM/YYYY" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={7}>
                      <Form.Item label="Mã số thuế" name="taxCode">
                        <Input placeholder="Nhập mã số thuế" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={11}>
                      <Form.Item label={voucherType === "RECEIPT" ? "Lý do nộp" : "Lý do chi"} name="note">
                        <Input placeholder="Nhập diễn giải chứng từ" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} lg={6}>
                      <Form.Item label={voucherType === "RECEIPT" ? "Số phiếu thu" : "Số phiếu chi"} name="voucherNo">
                        <Input readOnly />
                      </Form.Item>
                    </Col>
                    {invoiceBased && !isInvoiceReceiptFlow ? (
                      <>
                        <Col xs={24} lg={4}>
                          <Form.Item label="Phương thức" name="paymentMethod" rules={[{ required: true, message: "Bắt buộc" }]}>
                            <AppSelect
                              options={[
                                { value: "CASH", label: "Tiền mặt" },
                                { value: "TRANSFER", label: "Chuyển khoản" }
                              ]}
                            />
                          </Form.Item>
                        </Col>
                      </>
                    ) : null}
                  </Row>
                </div>
              </div>
            )}
          </Form>

          {invoiceBased ? (
            <>
              {isInvoiceReceiptFlow ? (
                <div className="cash-voucher-invoice-toolbar">
                  <Typography.Text strong>Chứng từ công nợ</Typography.Text>
                  <Space>
                    <Input.Search
                      allowClear
                      placeholder="Tìm theo số chứng từ, số hóa đơn"
                      style={{ width: 280 }}
                      value={invoiceSearch}
                      onChange={(event) => setInvoiceSearch(event.target.value)}
                    />
                    <Space>
                      <Typography.Text>Nhập số thu</Typography.Text>
                      <InputNumber
                        min={0}
                        controls={false}
                        style={{ width: 180 }}
                        value={bulkCollectAmount}
                        formatter={formatAmountInput}
                        parser={parseAmountInput}
                        onChange={handleBulkCollectAmountChange}
                      />
                    </Space>
                  </Space>
                </div>
              ) : null}

              <Table<InvoiceSelectionRow>
                rowKey="id"
                bordered
                size="small"
                className="sales-voucher-detail-table"
                pagination={false}
                columns={allocationColumns}
                dataSource={filteredInvoiceRows}
                loading={unpaidInvoicesQuery.isFetching}
                scroll={{ y: 360 }}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={6} align="right">
                      <Typography.Text strong>Cộng</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Typography.Text strong>{formatCurrency(filteredInvoiceSummary.totalNetAmount)}</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Typography.Text strong>{formatCurrency(filteredInvoiceSummary.totalRemainingAmount)}</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <Typography.Text strong>{formatCurrency(filteredInvoiceSummary.totalAppliedAmount)}</Typography.Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />

              <div className="cash-voucher-summary-panel">
                <Typography.Text>{`Tổng số: ${filteredInvoiceRows.length} bản ghi`}</Typography.Text>
                <Typography.Text strong>{`Số thu: ${formatCurrency(totalAllocated)}`}</Typography.Text>
              </div>
            </>
          ) : (
            <>
              {isExpenseInvoicePaymentFlow ? (
                <>
                  <div className="cash-voucher-expense-tabbar">
                    <div className="cash-voucher-expense-tabs">
                      <button
                        type="button"
                        className={`cash-voucher-expense-tab ${expenseActiveTab === "ACCOUNTING" ? "cash-voucher-expense-tab-active" : ""}`}
                        onClick={() => setExpenseActiveTab("ACCOUNTING")}
                      >
                        Hạch toán
                      </button>
                      <button
                        type="button"
                        className={`cash-voucher-expense-tab ${expenseActiveTab === "INVOICE" ? "cash-voucher-expense-tab-active" : ""}`}
                        onClick={() => setExpenseActiveTab("INVOICE")}
                      >
                        {combineMultipleInvoices ? "Kê khai hóa đơn" : "Kê khai hóa đơn và hạch toán thuế"}
                      </button>
                    </div>
                    <Space>
                      <Checkbox checked={combineMultipleInvoices} onChange={(event) => handleToggleCombineInvoices(event.target.checked)}>
                        Hạch toán gộp nhiều hóa đơn
                      </Checkbox>
                    </Space>
                  </div>

                  {expenseActiveTab === "ACCOUNTING" ? (
                    <>
                      <div className="cash-voucher-direct-toolbar">
                        <Typography.Text type="secondary">{`Tổng số: ${directRows.length} bản ghi`}</Typography.Text>
                        <Space>
                          <Button icon={<PlusOutlined />} onClick={addDirectRow}>
                            Thêm dòng
                          </Button>
                          <Button onClick={clearDirectRows}>Xóa hết dòng</Button>
                        </Space>
                      </div>
                      <Table<DirectCashEntryRow>
                        rowKey="key"
                        bordered
                        size="small"
                        className="sales-voucher-detail-table"
                        pagination={false}
                        columns={directColumns}
                        dataSource={directRows}
                        scroll={{ y: 360 }}
                      />
                      <div className="cash-voucher-summary-panel">
                        <Typography.Text strong>{`Tổng tiền: ${formatCurrency(directTotalAmount)}`}</Typography.Text>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="cash-voucher-direct-toolbar">
                        <Typography.Text type="secondary">{`Tổng số: ${expenseTaxRows.length} dòng thuế`}</Typography.Text>
                        <Space>
                          <Button icon={<PlusOutlined />} onClick={addExpenseTaxRow}>
                            Thêm dòng
                          </Button>
                          <Button onClick={clearExpenseTaxRows}>Xóa hết dòng</Button>
                        </Space>
                      </div>
                      <Table<ExpenseInvoiceTaxRow>
                        rowKey="key"
                        bordered
                        size="small"
                        className="sales-voucher-detail-table"
                        pagination={false}
                        columns={expenseTaxColumns}
                        dataSource={expenseTaxRows}
                        scroll={{ y: 360 }}
                      />
                      <div className="cash-voucher-summary-panel">
                        <Typography.Text strong>{`Tổng thuế GTGT: ${formatCurrency(expenseTaxTotal)}`}</Typography.Text>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Typography.Text strong className="cash-voucher-section-title">
                    Hạch toán
                  </Typography.Text>
                  <div className="cash-voucher-direct-toolbar">
                    <Typography.Text type="secondary">{`Tổng số: ${directRows.length} bản ghi`}</Typography.Text>
                    <Space>
                      <Button icon={<PlusOutlined />} onClick={addDirectRow}>
                        Thêm dòng
                      </Button>
                      <Button onClick={clearDirectRows}>Xóa hết dòng</Button>
                    </Space>
                  </div>
                  <Table<DirectCashEntryRow>
                    rowKey="key"
                    bordered
                    size="small"
                    className="sales-voucher-detail-table"
                    pagination={false}
                    columns={directColumns}
                    dataSource={directRows}
                    scroll={{ y: 360 }}
                  />
                  <div className="cash-voucher-summary-panel">
                    <Typography.Text strong>{`Tổng tiền: ${formatCurrency(directTotalAmount)}`}</Typography.Text>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </Drawer>

      <PartnerModal
        open={partnerModalOpen}
        loading={createPartnerMutation.isPending || updatePartnerMutation.isPending}
        mode={partnerModalMode}
        title={
          partnerModalMode === "create"
            ? partnerGroup === "SUPPLIER"
              ? "Thêm nhà cung cấp"
              : "Thêm khách hàng"
            : partnerGroup === "SUPPLIER"
              ? "Cập nhật nhà cung cấp"
              : "Cập nhật khách hàng"
        }
        baseGroup={partnerGroup}
        initialValues={partnerModalInitialValues}
        onCancel={() => setPartnerModalOpen(false)}
        onSubmit={async (values) => {
          if (partnerModalMode === "create") {
            const created = await createPartnerMutation.mutateAsync({
              code: values.code,
              name: values.name,
              phone: values.phone,
              taxCode: values.taxCode,
              address: values.address,
              partnerType: values.partnerType ?? partnerGroup,
              group: partnerGroup
            });
            await partnersQuery.refetch();
            form.setFieldsValue({
              partnerId: created.id,
              partnerName: created.name,
              payerName: created.name,
              taxCode: created.taxCode ?? "",
              address: created.address ?? "",
              note: buildDefaultNote(created.name)
            });
            message.success(partnerGroup === "SUPPLIER" ? "Đã thêm nhà cung cấp." : "Đã thêm khách hàng.");
          } else {
            if (!selectedPartnerId) {
              throw new Error(`Vui lòng chọn ${partnerEntityLabel} trước khi sửa.`);
            }
            const updated = await updatePartnerMutation.mutateAsync({
              id: selectedPartnerId,
              payload: {
                code: values.code,
                name: values.name,
                phone: values.phone,
                taxCode: values.taxCode,
                address: values.address,
                partnerType: values.partnerType ?? partnerGroup,
                group: partnerGroup
              }
            });
            await partnersQuery.refetch();
            form.setFieldsValue({
              partnerId: updated.id,
              partnerName: updated.name,
              payerName: updated.name,
              taxCode: updated.taxCode ?? "",
              address: updated.address ?? "",
              note: buildDefaultNote(updated.name)
            });
            message.success(partnerGroup === "SUPPLIER" ? "Đã cập nhật nhà cung cấp." : "Đã cập nhật khách hàng.");
          }
          setPartnerModalOpen(false);
        }}
      />
    </>
  );
}



