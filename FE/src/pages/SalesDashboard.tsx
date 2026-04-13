import { DownloadOutlined, DownOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Dropdown, Input, Space, Table, Tag, Typography, message } from "antd";
import type { MenuProps, TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { QuotationDrawer } from "../components/QuotationDrawer";
import { SalesDebtTab } from "../components/SalesDebtTab";
import { SalesReportsTab } from "../components/SalesReportsTab";
import { SalesReturnDrawer } from "../components/SalesReturnDrawer";
import { SalesVoucherDrawer } from "../components/SalesVoucherDrawer";
import { PartnerManagementPage } from "./categories/PartnerManagement";
import {
  deleteQuotation,
  fetchQuotationById,
  fetchQuotations
} from "../services/quotation.api";
import { deleteVoucher, downloadVoucherPdf, duplicateVoucher, fetchVoucherById, fetchVouchers, payVoucher, unpostVoucher } from "../services/voucher.api";
import type {
  QuotationDetail,
  QuotationSummary,
  VoucherDetail,
  VoucherHistoryItem
} from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";

type WorkflowTabKey =
  | "QUOTATION"
  | "SALES"
  | "SALES_RETURN"
  | "AR"
  | "CUSTOMERS"
  | "REPORTS";

interface WorkflowTabItem {
  key: WorkflowTabKey;
  label: string;
  badge?: number;
}

const workflowTabs: WorkflowTabItem[] = [
  { key: "QUOTATION", label: "Báo giá", badge: 0 },
  { key: "SALES", label: "Bán hàng", badge: 0 },
  { key: "SALES_RETURN", label: "Trả lại hàng bán", badge: 0 },
  { key: "AR", label: "Công nợ", badge: 0 },
  { key: "CUSTOMERS", label: "Khách hàng", badge: 0 },
  { key: "REPORTS", label: "Báo cáo", badge: 0 }
];

const paymentStatusMeta = {
  UNPAID: { label: "Chưa thanh toán", color: "red" },
  PARTIAL: { label: "Thanh to\u00e1n", color: "orange" },
  PAID: { label: "Đã thanh toán", color: "green" }
} as const;

function mapPaymentMethodLabel(value: VoucherHistoryItem["paymentMethod"]): string {
  if (value === "TRANSFER") {
    return "Chuyển khoản";
  }
  if (value === "CASH") {
    return "Tiền mặt";
  }
  return "-";
}

function toDateString(value: Dayjs): string {
  return value.format("YYYY-MM-DD");
}

function getYearToDateRange(): [Dayjs, Dayjs] {
  return [dayjs().startOf("year"), dayjs().endOf("day")];
}

export function SalesDashboardPage() {
  const [activeWorkflowTab, setActiveWorkflowTab] = useState<WorkflowTabKey>("SALES");

  const [voucherSearchInput, setVoucherSearchInput] = useState("");
  const [voucherSearch, setVoucherSearch] = useState("");
  const [voucherRange, setVoucherRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingVoucherId, setEditingVoucherId] = useState<string | null>(null);
  const [sourceQuotationId, setSourceQuotationId] = useState<string | null>(null);
  const [salesReturnDrawerOpen, setSalesReturnDrawerOpen] = useState(false);
  const [salesReturnSearchInput, setSalesReturnSearchInput] = useState("");
  const [salesReturnSearch, setSalesReturnSearch] = useState("");
  const [salesReturnRange, setSalesReturnRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedSalesReturnId, setSelectedSalesReturnId] = useState<string | null>(null);

  const [quotationSearchInput, setQuotationSearchInput] = useState("");
  const [quotationSearch, setQuotationSearch] = useState("");
  const [quotationRange, setQuotationRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(null);
  const [quotationDrawerOpen, setQuotationDrawerOpen] = useState(false);
  const [editingQuotationId, setEditingQuotationId] = useState<string | null>(null);
  const [selectedSalesRowKeys, setSelectedSalesRowKeys] = useState<string[]>([]);
  const [selectedQuotationRowKeys, setSelectedQuotationRowKeys] = useState<string[]>([]);
  const [selectedSalesReturnRowKeys, setSelectedSalesReturnRowKeys] = useState<string[]>([]);

  const pageSize = 20;

  useEffect(() => {
    if (!voucherRange) {
      setVoucherRange(getYearToDateRange());
    }
    if (!quotationRange) {
      setQuotationRange(getYearToDateRange());
    }
    if (!salesReturnRange) {
      setSalesReturnRange(getYearToDateRange());
    }
  }, [quotationRange, salesReturnRange, voucherRange]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = voucherSearchInput.trim();
      if (next !== voucherSearch) {
        setVoucherSearch(next);
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [voucherSearchInput, voucherSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = quotationSearchInput.trim();
      if (next !== quotationSearch) {
        setQuotationSearch(next);
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [quotationSearchInput, quotationSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = salesReturnSearchInput.trim();
      if (next !== salesReturnSearch) {
        setSalesReturnSearch(next);
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [salesReturnSearch, salesReturnSearchInput]);

  const vouchersQuery = useQuery({
    queryKey: [
      "sales-vouchers",
      pageSize,
      voucherSearch,
      voucherRange?.[0]?.toISOString(),
      voucherRange?.[1]?.toISOString()
    ],
    queryFn: () =>
      fetchVouchers({
        page: 1,
        pageSize,
        type: "SALES",
        search: voucherSearch || undefined,
        startDate: toDateString(voucherRange?.[0] ?? getYearToDateRange()[0]),
        endDate: toDateString(voucherRange?.[1] ?? getYearToDateRange()[1])
      }),
    enabled: activeWorkflowTab === "SALES" && Boolean(voucherRange)
  });

  const quotationsQuery = useQuery({
    queryKey: [
      "sales-quotations",
      pageSize,
      quotationSearch,
      quotationRange?.[0]?.toISOString(),
      quotationRange?.[1]?.toISOString()
    ],
    queryFn: () =>
      fetchQuotations({
        page: 1,
        pageSize,
        search: quotationSearch || undefined,
        startDate: toDateString(quotationRange?.[0] ?? getYearToDateRange()[0]),
        endDate: toDateString(quotationRange?.[1] ?? getYearToDateRange()[1])
      }),
    enabled: activeWorkflowTab === "QUOTATION" && Boolean(quotationRange)
  });

  const salesReturnsQuery = useQuery({
    queryKey: [
      "sales-return-vouchers",
      pageSize,
      salesReturnSearch,
      salesReturnRange?.[0]?.toISOString(),
      salesReturnRange?.[1]?.toISOString()
    ],
    queryFn: () =>
      fetchVouchers({
        page: 1,
        pageSize,
        type: "SALES_RETURN",
        search: salesReturnSearch || undefined,
        startDate: toDateString(salesReturnRange?.[0] ?? getYearToDateRange()[0]),
        endDate: toDateString(salesReturnRange?.[1] ?? getYearToDateRange()[1])
      }),
    enabled: activeWorkflowTab === "SALES_RETURN" && Boolean(salesReturnRange)
  });

  useEffect(() => {
    if (activeWorkflowTab !== "SALES") {
      return;
    }
    const items = vouchersQuery.data?.items ?? [];
    if (!items.length) {
      setSelectedVoucherId(null);
      return;
    }
    if (!selectedVoucherId || !items.some((item) => item.id === selectedVoucherId)) {
      setSelectedVoucherId(items[0].id);
    }
  }, [activeWorkflowTab, selectedVoucherId, vouchersQuery.data?.items]);

  useEffect(() => {
    const validIds = new Set((vouchersQuery.data?.items ?? []).map((item) => item.id));
    setSelectedSalesRowKeys((prev) => prev.filter((id) => validIds.has(id)));
  }, [vouchersQuery.data?.items]);

  useEffect(() => {
    if (activeWorkflowTab !== "QUOTATION") {
      return;
    }
    const items = quotationsQuery.data?.items ?? [];
    if (!items.length) {
      setSelectedQuotationId(null);
      return;
    }
    if (!selectedQuotationId || !items.some((item) => item.id === selectedQuotationId)) {
      setSelectedQuotationId(items[0].id);
    }
  }, [activeWorkflowTab, quotationsQuery.data?.items, selectedQuotationId]);

  useEffect(() => {
    const validIds = new Set((quotationsQuery.data?.items ?? []).map((item) => item.id));
    setSelectedQuotationRowKeys((prev) => prev.filter((id) => validIds.has(id)));
  }, [quotationsQuery.data?.items]);

  useEffect(() => {
    if (activeWorkflowTab !== "SALES_RETURN") {
      return;
    }
    const items = salesReturnsQuery.data?.items ?? [];
    if (!items.length) {
      setSelectedSalesReturnId(null);
      return;
    }
    if (!selectedSalesReturnId || !items.some((item) => item.id === selectedSalesReturnId)) {
      setSelectedSalesReturnId(items[0].id);
    }
  }, [activeWorkflowTab, salesReturnsQuery.data?.items, selectedSalesReturnId]);

  useEffect(() => {
    const validIds = new Set((salesReturnsQuery.data?.items ?? []).map((item) => item.id));
    setSelectedSalesReturnRowKeys((prev) => prev.filter((id) => validIds.has(id)));
  }, [salesReturnsQuery.data?.items]);

  const voucherDetailQuery = useQuery({
    queryKey: ["sales-voucher-detail", selectedVoucherId],
    queryFn: () => fetchVoucherById(selectedVoucherId as string),
    enabled: activeWorkflowTab === "SALES" && Boolean(selectedVoucherId)
  });

  const quotationDetailQuery = useQuery({
    queryKey: ["sales-quotation-detail", selectedQuotationId],
    queryFn: () => fetchQuotationById(selectedQuotationId as string),
    enabled: activeWorkflowTab === "QUOTATION" && Boolean(selectedQuotationId)
  });

  const salesReturnDetailQuery = useQuery({
    queryKey: ["sales-return-detail", selectedSalesReturnId],
    queryFn: () => fetchVoucherById(selectedSalesReturnId as string),
    enabled: activeWorkflowTab === "SALES_RETURN" && Boolean(selectedSalesReturnId)
  });

  const unpostMutation = useMutation({
    mutationFn: (voucherId: string) => unpostVoucher(voucherId),
    onSuccess: async () => {
      message.success("Bỏ ghi chứng từ thành công.");
      await Promise.all([vouchersQuery.refetch(), voucherDetailQuery.refetch()]);
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: (voucherId: string) => duplicateVoucher(voucherId),
    onSuccess: async (result) => {
      message.success("Đã nhân bản chứng từ.");
      await vouchersQuery.refetch();
      setEditingVoucherId(result.voucherId);
      setDrawerOpen(true);
    }
  });

  const payMutation = useMutation({
    mutationFn: (voucherId: string) => payVoucher(voucherId),
    onSuccess: async () => {
      message.success("Thu tiền thành công.");
      await Promise.all([vouchersQuery.refetch(), voucherDetailQuery.refetch()]);
    }
  });

  const deleteVoucherMutation = useMutation({
    mutationFn: (voucherId: string) => deleteVoucher(voucherId),
    onSuccess: async () => {
      message.success("Xóa chứng từ thành công.");
      await Promise.all([vouchersQuery.refetch(), voucherDetailQuery.refetch()]);
    }
  });

  const cancelQuotationMutation = useMutation({
    mutationFn: (quotationId: string) => deleteQuotation(quotationId),
    onSuccess: async () => {
      message.success("Đã hủy báo giá.");
      await Promise.all([quotationsQuery.refetch(), quotationDetailQuery.refetch()]);
    }
  });

  const salesTableActionLoading =
    unpostMutation.isPending || duplicateMutation.isPending || payMutation.isPending || deleteVoucherMutation.isPending;
  const quotationTableActionLoading = cancelQuotationMutation.isPending;

  const handleVoucherMenuAction = useCallback(
    (action: string, record: VoucherHistoryItem) => {
      if (action === "unpost") {
        void unpostMutation.mutateAsync(record.id);
        return;
      }
      if (action === "duplicate") {
        void duplicateMutation.mutateAsync(record.id);
        return;
      }
      if (action === "pay") {
        void payMutation.mutateAsync(record.id);
        return;
      }
      if (action === "print") {
        void downloadVoucherPdf(record.id, record.voucherNo ?? record.id, "SALES");
        return;
      }
      if (action === "delete") {
        void deleteVoucherMutation.mutateAsync(record.id);
      }
    },
    [deleteVoucherMutation, duplicateMutation, payMutation, unpostMutation]
  );

  const handleQuotationMenuAction = useCallback(
    (action: string, record: QuotationSummary) => {
      if (action === "edit") {
        setEditingQuotationId(record.id);
        setQuotationDrawerOpen(true);
        return;
      }
      if (action === "convert") {
        setActiveWorkflowTab("SALES");
        setEditingVoucherId(null);
        setSourceQuotationId(record.id);
        setDrawerOpen(true);
        return;
      }
      if (action === "cancel") {
        void cancelQuotationMutation.mutateAsync(record.id);
      }
    },
    [cancelQuotationMutation]
  );

  const getVoucherActionItems = useCallback((record: VoucherHistoryItem): MenuProps["items"] => {
    const items: NonNullable<MenuProps["items"]> = [];
    if (record.status === "BOOKED") {
      items.push({ key: "unpost", label: "B\u1ecf ghi" });
      if (record.paymentStatus !== "PAID") {
        items.push({ key: "pay", label: "Thu ti\u1ec1n" });
      }
    }
    items.push({ key: "duplicate", label: "Nh\u00e2n b\u1ea3n" });
    return items;
  }, []);

  const getVoucherDropdownItems = useCallback((record: VoucherHistoryItem): MenuProps["items"] => {
    const items: NonNullable<MenuProps["items"]> = [];
    if (record.status === "BOOKED") {
      items.push({ key: "unpost", label: "B\u1ecf ghi" });
      if (record.paymentStatus !== "PAID") {
        items.push({ key: "pay", label: "Thu ti\u1ec1n" });
      }
    }
    items.push({ key: "duplicate", label: "Nh\u00e2n b\u1ea3n" });
    items.push({ key: "print", label: "In" });
    if (record.status === "DRAFT") {
      items.push({ key: "delete", label: "X\u00f3a" });
    }
    return items;
  }, []);

  const getQuotationActionItems = useCallback((record: QuotationSummary): MenuProps["items"] => {
    const items: NonNullable<MenuProps["items"]> = [{ key: "edit", label: "Sửa báo giá" }];
    if (record.status === "PENDING") {
      items.push({ key: "convert", label: "Lập chứng từ bán hàng" });
      items.push({ key: "cancel", label: "Hủy báo giá" });
    }
    return items;
  }, []);

  const voucherColumns: TableColumnsType<VoucherHistoryItem> = useMemo(
    () => [
      {
        title: "Ngày chứng từ",
        dataIndex: "voucherDate",
        key: "voucherDate",
        align: "center",
        width: 130,
        render: (value: string) => dayjs(value).format("DD/MM/YYYY")
      },
      {
        title: "Số phiếu",
        dataIndex: "voucherNo",
        key: "voucherNo",
        width: 150,
        render: (value: string | null, record) => (
          <Typography.Link strong style={{ textDecoration: "underline" }}
            onClick={(event) => {
              event.stopPropagation();
              setEditingVoucherId(record.id);
              setDrawerOpen(true);
            }}
          >
            {value ?? record.id.slice(0, 8)}
          </Typography.Link>
        )
      },
      {
        title: "Khách hàng",
        dataIndex: "partnerName",
        key: "partnerName",
        ellipsis: true,
        render: (value: string | null) => value ?? "-"
      },
      {
        title: "Tổng tiền hàng",
        dataIndex: "totalAmount",
        key: "totalAmount",
        align: "right",
        width: 165,
        render: (_value: number, record) => (
          <Typography.Text strong>{formatCurrency(record.totalNetAmount - record.totalTaxAmount)}</Typography.Text>
        )
      },
      {
        title: "Tiền thuế GTGT",
        dataIndex: "totalTaxAmount",
        key: "totalTaxAmount",
        align: "right",
        width: 165,
        render: (value: number) => <Typography.Text>{formatCurrency(value)}</Typography.Text>
      },
      {
        title: "Tổng thanh toán",
        dataIndex: "totalNetAmount",
        key: "totalNetAmount",
        align: "right",
        width: 170,
        render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
      },
      {
        title: "PTTT",
        dataIndex: "paymentMethod",
        key: "paymentMethod",
        align: "center",
        width: 120,
        render: (value: VoucherHistoryItem["paymentMethod"], record) =>
          record.paymentStatus === "PAID" ? mapPaymentMethodLabel(value) : ""
      },
      {
        title: "Thanh toán",
        dataIndex: "paymentStatus",
        key: "paymentStatus",
        align: "center",
        width: 150,
        render: (value: VoucherHistoryItem["paymentStatus"]) => {
          const meta = paymentStatusMeta[value];
          return <Tag color={meta.color}>{meta.label}</Tag>;
        }
      },
      {
        title: "Người tạo",
        dataIndex: "createdByName",
        key: "createdByName",
        width: 160,
        ellipsis: true,
        render: (value: string | null) => value ?? "-"
      },
      {
        title: "Hành động",
        key: "actions",
        align: "center",
        width: 72,
        render: (_value, record) => (
          <Dropdown
            menu={{
              items: getVoucherDropdownItems(record),
              onClick: ({ key }) => handleVoucherMenuAction(String(key), record)
            }}
            trigger={["click"]}
          >
            <Button type="text" icon={<DownOutlined />} onClick={(event) => event.stopPropagation()} />
          </Dropdown>
        )
      }
    ],
    [getVoucherDropdownItems, handleVoucherMenuAction]
  );

  const quotationColumns: TableColumnsType<QuotationSummary> = useMemo(
    () => [
      {
        title: "Ngày báo giá",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 130,
        align: "center",
        render: (value: string) => dayjs(value).format("DD/MM/YYYY")
      },
      {
        title: "Số báo giá",
        dataIndex: "quotationNo",
        key: "quotationNo",
        width: 140,
        render: (value: string) => <Typography.Link strong style={{ textDecoration: "underline" }}>{value}</Typography.Link>
      },
      {
        title: "Khách hàng",
        dataIndex: "partnerName",
        key: "partnerName",
        ellipsis: true
      },
      {
        title: "Tổng tiền hàng",
        dataIndex: "totalAmount",
        key: "totalAmount",
        align: "right",
        width: 160,
        render: (value: number) => formatCurrency(value)
      },
      {
        title: "Tổng tiền thuế GTGT",
        dataIndex: "totalTax",
        key: "totalTax",
        align: "right",
        width: 170,
        render: (value: number) => formatCurrency(value)
      },
      {
        title: "Tổng tiền thanh toán",
        dataIndex: "totalNetAmount",
        key: "totalNetAmount",
        align: "right",
        width: 180,
        render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
      },
      {
        title: "Người tạo",
        dataIndex: "createdByName",
        key: "createdByName",
        width: 160,
        ellipsis: true,
        render: (value: string | null) => value ?? "-"
      },
      {
        title: "Chức năng",
        key: "actions",
        align: "center",
        width: 230,
        render: (_value, record) => (
          <Space size="small">
            {record.status === "PENDING" ? (
              <Button
                type="link"
                className="quotation-action-link"
                onClick={() => {
                  setActiveWorkflowTab("SALES");
                  setEditingVoucherId(null);
                  setSourceQuotationId(record.id);
                  setDrawerOpen(true);
                }}
              >
                Lập chứng từ bán hàng
              </Button>
            ) : (
              <Button
                type="link"
                className="quotation-action-link"
                onClick={() => {
                  setEditingQuotationId(record.id);
                  setQuotationDrawerOpen(true);
                }}
              >
                Xem báo giá
              </Button>
            )}
            <Dropdown
              menu={{
                items: getQuotationActionItems(record),
                onClick: ({ key }) => handleQuotationMenuAction(String(key), record)
              }}
              trigger={["click"]}
            >
              <Button type="text">
                <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        )
      }
    ],
            [getQuotationActionItems, handleQuotationMenuAction]
  );

  const salesDetailColumns: TableColumnsType<VoucherDetail["items"][number]> = useMemo(
    () => [
      { title: "STT", key: "stt", width: 56, align: "center", render: (_v, _r, index) => index + 1 },
      { title: "Mã hàng", dataIndex: "skuCode", key: "skuCode", width: 130 },
      { title: "Tên hàng", dataIndex: "productName", key: "productName", ellipsis: true },
      { title: "ĐVT", dataIndex: "unitName", key: "unitName", align: "center", width: 80 },
      {
        title: "SL",
        dataIndex: "quantity",
        key: "quantity",
        align: "right",
        width: 110,
        render: (value: number) => formatNumber(value)
      },
      {
        title: "Đơn giá",
        dataIndex: "unitPrice",
        key: "unitPrice",
        align: "right",
        width: 130,
        render: (value: number) => formatCurrency(value)
      },
      {
        title: "Đơn giá sau CK",
        key: "unitPriceAfterDiscount",
        align: "right",
        width: 140,
        render: (_value, record) => {
          const discountedPrice = record.unitPrice * (1 - (record.discountRate || 0) / 100);
          return formatCurrency(discountedPrice);
        }
      },
      {
        title: "CK %",
        dataIndex: "discountRate",
        key: "discountRate",
        align: "right",
        width: 90,
        render: (value: number) => formatNumber(value)
      },
      {
        title: "Thuế %",
        dataIndex: "taxRate",
        key: "taxRate",
        align: "right",
        width: 90,
        render: (value: number) => formatNumber(value)
      },
      {
        title: "Thành tiền",
        dataIndex: "lineNetAmount",
        key: "lineNetAmount",
        align: "right",
        width: 140,
        render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
      }
    ],
    []
  );

  const quotationDetailColumns: TableColumnsType<QuotationDetail["items"][number]> = useMemo(
    () => [
      { title: "#", key: "stt", width: 48, align: "center", render: (_v, _r, index) => index + 1 },
      { title: "Mã hàng", dataIndex: "skuCode", key: "skuCode", width: 130 },
      { title: "Tên hàng", dataIndex: "productName", key: "productName", ellipsis: true },
      {
        title: "Số lượng",
        dataIndex: "quantity",
        key: "quantity",
        width: 120,
        align: "right",
        render: (value: number) => formatNumber(value)
      },
      {
        title: "Đơn giá",
        dataIndex: "price",
        key: "price",
        width: 130,
        align: "right",
        render: (value: number) => formatCurrency(value)
      },
      {
        title: "CK %",
        dataIndex: "discountPercent",
        key: "discountPercent",
        width: 90,
        align: "right",
        render: (value: number) => formatNumber(value)
      },
      {
        title: "Thuế %",
        dataIndex: "taxPercent",
        key: "taxPercent",
        width: 90,
        align: "right",
        render: (value: number) => formatNumber(value)
      },
      {
        title: "Thành tiền",
        dataIndex: "netAmount",
        key: "netAmount",
        width: 140,
        align: "right",
        render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
      }
    ],
    []
  );

  const quotationSummary = useMemo(
    () =>
      (quotationsQuery.data?.items ?? []).reduce(
        (acc, item) => {
          acc.totalAmount += item.totalAmount;
          acc.totalDiscount += item.totalDiscount;
          acc.totalNetAmount += item.totalNetAmount;
          return acc;
        },
        { totalAmount: 0, totalDiscount: 0, totalNetAmount: 0 }
      ),
    [quotationsQuery.data?.items]
  );

  const salesSummary = useMemo(() => {
    const summary = vouchersQuery.data?.summary;
    return {
      totalCount: vouchersQuery.data?.items.length ?? 0,
      totalAmount: summary ? summary.totalNetAmount - summary.totalTaxAmount : 0,
      totalTaxAmount: summary?.totalTaxAmount ?? 0,
      totalNetAmount: summary?.totalNetAmount ?? 0
    };
  }, [vouchersQuery.data?.items, vouchersQuery.data?.summary]);

  const activeTabLabel = workflowTabs.find((item) => item.key === activeWorkflowTab)?.label ?? "";

  const downloadWorkbook = (workbook: XLSX.WorkBook, fileName: string) => {
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName.replace(/[\\/:*?"<>|]/g, "_");
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const fetchAllSalesVouchersForExport = async (): Promise<VoucherHistoryItem[]> => {
    const pageSizeForExport = 200;
    let currentPage = 1;
    let total = 0;
    const allItems: VoucherHistoryItem[] = [];

    do {
      const response = await fetchVouchers({
        page: currentPage,
        pageSize: pageSizeForExport,
        type: "SALES",
        search: voucherSearch || undefined,
        startDate: toDateString(voucherRange?.[0] ?? getYearToDateRange()[0]),
        endDate: toDateString(voucherRange?.[1] ?? getYearToDateRange()[1])
      });
      allItems.push(...response.items);
      total = response.total;
      if (!response.items.length) {
        break;
      }
      currentPage += 1;
    } while (allItems.length < total);

    return allItems;
  };

  const handleExportSalesListExcel = async (): Promise<void> => {
    try {
      const items = await fetchAllSalesVouchersForExport();
      if (!items.length) {
        message.warning("Không có dữ liệu bán hàng để xuất Excel.");
        return;
      }

      const fromText = voucherRange?.[0]?.format("DD/MM/YYYY") ?? dayjs().startOf("day").format("DD/MM/YYYY");
      const toText = voucherRange?.[1]?.format("DD/MM/YYYY") ?? dayjs().endOf("day").format("DD/MM/YYYY");
      const totals = items.reduce(
        (acc, item) => {
          acc.totalAmount += item.totalNetAmount - item.totalTaxAmount;
          acc.totalTaxAmount += item.totalTaxAmount;
          acc.totalNetAmount += item.totalNetAmount;
          return acc;
        },
        { totalAmount: 0, totalTaxAmount: 0, totalNetAmount: 0 }
      );

      const sheetData: Array<Array<string | number>> = [
        ["DANH SÁCH BÁN HÀNG"],
        [`Từ ngày ${fromText} đến ngày ${toText}`],
        [],
        ["Ngày chứng từ", "Số phiếu", "Khách hàng", "Tổng tiền hàng", "Tổng tiền thuế", "Tổng thanh toán", "Thanh toán", "PTTT", "Diễn giải"],
        ...items.map((item) => [
          dayjs(item.voucherDate).format("DD/MM/YYYY"),
          item.voucherNo ?? item.id.slice(0, 8),
          item.partnerName ?? "",
          item.totalNetAmount - item.totalTaxAmount,
          item.totalTaxAmount,
          item.totalNetAmount,
          paymentStatusMeta[item.paymentStatus].label,
          item.paymentStatus === "PAID" ? mapPaymentMethodLabel(item.paymentMethod) : "",
          item.note ?? ""
        ]),
        ["Tổng cộng", "", "", totals.totalAmount, totals.totalTaxAmount, totals.totalNetAmount, "", "", ""]
      ];

      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      ws["!merges"] = [XLSX.utils.decode_range("A1:I1"), XLSX.utils.decode_range("A2:I2")];
      ws["!cols"] = [
        { wch: 14 },
        { wch: 16 },
        { wch: 36 },
        { wch: 16 },
        { wch: 16 },
        { wch: 18 },
        { wch: 16 },
        { wch: 12 },
        { wch: 40 }
      ];

      const headerRow = 4;
      for (let col = 0; col < 9; col += 1) {
        const headerCell = ws[XLSX.utils.encode_cell({ r: headerRow - 1, c: col })] as (XLSX.CellObject & { s?: Record<string, unknown> }) | undefined;
        if (headerCell) {
          headerCell.s = {
            font: { bold: true },
            alignment: { horizontal: "center", vertical: "center" },
            fill: { patternType: "solid", fgColor: { rgb: "D9E1F2" } }
          };
        }
      }

      const moneyCols = new Set([3, 4, 5]);
      for (let row = headerRow + 1; row <= headerRow + items.length + 1; row += 1) {
        for (const col of moneyCols) {
          const cell = ws[XLSX.utils.encode_cell({ r: row - 1, c: col })] as (XLSX.CellObject & { s?: Record<string, unknown> }) | undefined;
          if (cell) {
            cell.s = { alignment: { horizontal: "right" }, numFmt: "#,##0" };
          }
        }
      }
      const summaryRow = headerRow + items.length + 1;
      const summaryCell = ws[XLSX.utils.encode_cell({ r: summaryRow - 1, c: 0 })] as (XLSX.CellObject & { s?: Record<string, unknown> }) | undefined;
      if (summaryCell) {
        summaryCell.s = { font: { bold: true } };
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "DanhSachBanHang");
      downloadWorkbook(wb, `Danh_sach_ban_hang_${dayjs().format("YYYYMMDD-HHmmss")}.xlsx`);
      message.success("Đã xuất Excel danh sách bán hàng.");
    } catch (error) {
      message.error((error as Error).message || "Xuất Excel thất bại.");
    }
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Bán hàng
      </Typography.Title>

      <div className="sales-workflow-bar">
        <div className="sales-workflow-scroll">
          {workflowTabs.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`sales-workflow-tab ${item.key === activeWorkflowTab ? "sales-workflow-tab-active" : ""}`}
              onClick={() => setActiveWorkflowTab(item.key)}
            >
              {typeof item.badge === "number" && item.badge > 0 ? (
                <span className="sales-workflow-badge">{item.badge}</span>
              ) : null}
              <span className="sales-workflow-label">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activeWorkflowTab === "SALES" ? (
        <div className="sales-split-view">
          <div className="sales-master-pane">
            <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
              <Space>
                <Button onClick={() => setSelectedSalesRowKeys((vouchersQuery.data?.items ?? []).map((item) => item.id))}>
                  Thực hiện hàng loạt
                </Button>
                <Input.Search
                  allowClear
                  placeholder="Tìm theo số phiếu hoặc khách hàng"
                  style={{ width: 360 }}
                  value={voucherSearchInput}
                  onChange={(event) => setVoucherSearchInput(event.target.value)}
                />
                <DatePicker.RangePicker
                  allowClear
                  format="DD/MM/YYYY"
                  value={voucherRange}
                  onChange={(nextRange) => {
                    if (!nextRange || !nextRange[0] || !nextRange[1]) {
                      setVoucherRange(getYearToDateRange());
                      return;
                    }
                    setVoucherRange([nextRange[0].startOf("day"), nextRange[1].endOf("day")]);
                  }}
                />
                <Button icon={<DownloadOutlined />} onClick={() => void handleExportSalesListExcel()}>
                  Xuất Excel
                </Button>
              </Space>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ background: "#0050b3", borderColor: "#0050b3" }}
                onClick={() => {
                  setEditingVoucherId(null);
                  setSourceQuotationId(null);
                  setDrawerOpen(true);
                }}
              >
                Thêm mới
              </Button>
            </Space>

            <Table<VoucherHistoryItem>
              rowKey="id"
              bordered
              size="small"
              className="sales-master-table"
              loading={vouchersQuery.isFetching || salesTableActionLoading}
              columns={voucherColumns}
              dataSource={vouchersQuery.data?.items ?? []}
              rowSelection={{
                columnWidth: 44,
                selectedRowKeys: selectedSalesRowKeys,
                onChange: (nextKeys) => setSelectedSalesRowKeys(nextKeys as string[])
              }}
              pagination={false}
              scroll={{ y: 320 }}
              onRow={(record) => ({
                onClick: () => setSelectedVoucherId(record.id)
              })}
              rowClassName={(record) => (record.id === selectedVoucherId ? "sales-master-active-row" : "")}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4} align="right">
                    <Typography.Text strong>Tổng cộng</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Typography.Text>{formatCurrency(salesSummary.totalAmount)}</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <Typography.Text type="secondary">{formatCurrency(salesSummary.totalTaxAmount)}</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">
                    <Typography.Text strong className="sales-summary-net">
                      {formatCurrency(salesSummary.totalNetAmount)}
                    </Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} colSpan={4} />
                </Table.Summary.Row>
              )}
            />
          </div>
        </div>
      ) : activeWorkflowTab === "QUOTATION" ? (
        <div className="sales-split-view">
          <div className="sales-master-pane">
            <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
              <Space>
                <Button onClick={() => setSelectedQuotationRowKeys((quotationsQuery.data?.items ?? []).map((item) => item.id))}>
                  Thực hiện hàng loạt
                </Button>
                <Button>Lọc</Button>
                <Typography.Text type="secondary">Đầu năm tới hiện tại</Typography.Text>
              </Space>
              <Space>
                <Input.Search
                  allowClear
                  placeholder="Tìm theo số báo giá hoặc khách hàng"
                  style={{ width: 360 }}
                  value={quotationSearchInput}
                  onChange={(event) => setQuotationSearchInput(event.target.value)}
                />
                <DatePicker.RangePicker
                  allowClear
                  format="DD/MM/YYYY"
                  value={quotationRange}
                  onChange={(nextRange) => {
                    if (!nextRange || !nextRange[0] || !nextRange[1]) {
                      setQuotationRange(getYearToDateRange());
                      return;
                    }
                    setQuotationRange([nextRange[0].startOf("day"), nextRange[1].endOf("day")]);
                  }}
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  style={{ background: "#0050b3", borderColor: "#0050b3" }}
                  onClick={() => {
                    setEditingQuotationId(null);
                    setQuotationDrawerOpen(true);
                  }}
                >
                  Thêm báo giá
                </Button>
              </Space>
            </Space>

            <Table<QuotationSummary>
              rowKey="id"
              bordered
              size="small"
              className="sales-master-table"
              loading={quotationsQuery.isFetching || quotationTableActionLoading}
              columns={quotationColumns}
              dataSource={quotationsQuery.data?.items ?? []}
              rowSelection={{
                columnWidth: 44,
                selectedRowKeys: selectedQuotationRowKeys,
                onChange: (nextKeys) => setSelectedQuotationRowKeys(nextKeys as string[])
              }}
              pagination={false}
              scroll={{ y: 320 }}
              onRow={(record) => ({
                onClick: () => setSelectedQuotationId(record.id)
              })}
              rowClassName={(record) => (record.id === selectedQuotationId ? "sales-master-active-row" : "")}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4} align="right">
                    <Typography.Text strong>Tổng</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <Typography.Text strong>{formatCurrency(quotationSummary.totalAmount)}</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">
                    <Typography.Text strong>{formatCurrency(quotationSummary.totalDiscount)}</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={3} colSpan={2} align="right">
                    <Typography.Text strong>{`Thanh toán: ${formatCurrency(quotationSummary.totalNetAmount)}`}</Typography.Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </div>

          <div className="sales-detail-pane">
            <Typography.Text strong>Chi tiết báo giá: {quotationDetailQuery.data?.quotationNo ?? "-"}</Typography.Text>
            <Table<QuotationDetail["items"][number]>
              rowKey="id"
              bordered
              size="small"
              style={{ marginTop: 8 }}
              loading={quotationDetailQuery.isFetching}
              columns={quotationDetailColumns}
              dataSource={quotationDetailQuery.data?.items ?? []}
              pagination={false}
              scroll={{ y: 220 }}
            />
          </div>
        </div>
      ) : activeWorkflowTab === "SALES_RETURN" ? (
        <div className="sales-split-view">
          <div className="sales-master-pane">
            <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
              <Space>
                <Button onClick={() => setSelectedSalesReturnRowKeys((salesReturnsQuery.data?.items ?? []).map((item) => item.id))}>
                  Thực hiện hàng loạt
                </Button>
                <Input.Search
                  allowClear
                  placeholder="Tìm theo số phiếu trả lại hoặc khách hàng"
                  style={{ width: 360 }}
                  value={salesReturnSearchInput}
                  onChange={(event) => setSalesReturnSearchInput(event.target.value)}
                />
                <DatePicker.RangePicker
                  allowClear
                  format="DD/MM/YYYY"
                  value={salesReturnRange}
                  onChange={(nextRange) => {
                    if (!nextRange || !nextRange[0] || !nextRange[1]) {
                      setSalesReturnRange(getYearToDateRange());
                      return;
                    }
                    setSalesReturnRange([nextRange[0].startOf("day"), nextRange[1].endOf("day")]);
                  }}
                />
              </Space>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                style={{ background: "#0050b3", borderColor: "#0050b3" }}
                onClick={() => setSalesReturnDrawerOpen(true)}
              >
                Thêm phiếu trả lại
              </Button>
            </Space>

            <Table<VoucherHistoryItem>
              rowKey="id"
              bordered
              size="small"
              className="sales-master-table"
              loading={salesReturnsQuery.isFetching}
              columns={voucherColumns.filter((column) => column.key !== "actions")}
              dataSource={salesReturnsQuery.data?.items ?? []}
              rowSelection={{
                columnWidth: 44,
                selectedRowKeys: selectedSalesReturnRowKeys,
                onChange: (nextKeys) => setSelectedSalesReturnRowKeys(nextKeys as string[])
              }}
              pagination={false}
              scroll={{ y: 320 }}
              onRow={(record) => ({
                onClick: () => setSelectedSalesReturnId(record.id)
              })}
              rowClassName={(record) => (record.id === selectedSalesReturnId ? "sales-master-active-row" : "")}
              summary={() => {
                const summary = salesReturnsQuery.data?.summary;
                if (!summary) {
                  return null;
                }
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} align="right">
                      <Typography.Text strong>Tổng cộng</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Typography.Text>{`Tiền hàng: ${formatCurrency(summary.totalAmount)}`}</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Typography.Text type="secondary">{`Thuế: ${formatCurrency(summary.totalTaxAmount)}`}</Typography.Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} colSpan={2} align="right">
                      <Typography.Text strong>{`Hoàn lại: ${formatCurrency(summary.totalNetAmount)}`}</Typography.Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
          </div>

          <div className="sales-detail-pane">
            <Typography.Text strong>Chi tiết phiếu trả lại: {salesReturnDetailQuery.data?.voucherNo ?? "-"}</Typography.Text>
            <Table<VoucherDetail["items"][number]>
              rowKey="id"
              bordered
              size="small"
              style={{ marginTop: 8 }}
              loading={salesReturnDetailQuery.isFetching}
              columns={salesDetailColumns}
              dataSource={salesReturnDetailQuery.data?.items ?? []}
              pagination={false}
              scroll={{ y: 220 }}
            />
          </div>
        </div>
      ) : activeWorkflowTab === "AR" ? (
        <SalesDebtTab />
      ) : activeWorkflowTab === "CUSTOMERS" ? (
        <PartnerManagementPage />
      ) : activeWorkflowTab === "REPORTS" ? (
        <SalesReportsTab />
      ) : (
        <div className="sales-workflow-placeholder">
          <Typography.Text>{`Chức năng ${activeTabLabel} đang được phát triển, vui lòng quay lại sau`}</Typography.Text>
        </div>
      )}

      <SalesVoucherDrawer
        open={drawerOpen}
        voucherId={editingVoucherId}
        sourceQuotationId={sourceQuotationId}
        onClose={() => {
          setDrawerOpen(false);
          setEditingVoucherId(null);
          setSourceQuotationId(null);
        }}
        onSuccess={() => {
          void Promise.all([vouchersQuery.refetch(), quotationsQuery.refetch()]);
        }}
      />

      <QuotationDrawer
        open={quotationDrawerOpen}
        quotationId={editingQuotationId}
        onClose={() => {
          setQuotationDrawerOpen(false);
          setEditingQuotationId(null);
        }}
        onSuccess={(detail) => {
          setQuotationDrawerOpen(false);
          setEditingQuotationId(null);
          setSelectedQuotationId(detail.id);
          void quotationsQuery.refetch();
        }}
      />

      <SalesReturnDrawer
        open={salesReturnDrawerOpen}
        onClose={() => setSalesReturnDrawerOpen(false)}
        onSuccess={() => {
          setSalesReturnDrawerOpen(false);
          void Promise.all([salesReturnsQuery.refetch(), vouchersQuery.refetch()]);
        }}
      />
    </div>
  );
}
