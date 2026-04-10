import { DownloadOutlined, DownOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Dropdown, Input, Space, Table, Typography, message } from "antd";
import type { MenuProps, TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { CashVoucherDrawer } from "../components/CashVoucherDrawer";
import { ImportWizardModal } from "../components/ImportWizardModal";
import { commitImportData, validateImportData } from "../services/import.api";
import { downloadVoucherPdf, fetchVoucherById, fetchVouchers } from "../services/voucher.api";
import type { PaymentReason, VoucherDetail, VoucherHistoryItem } from "../types/voucher";
import { formatCurrency } from "../utils/formatters";

type CashDrawerConfig =
  | {
      voucherType: "RECEIPT" | "PAYMENT";
      paymentReason: PaymentReason;
      invoiceBased: boolean;
      entryMode?: "STANDARD" | "EXPENSE_INVOICE";
      voucherId?: string;
    }
  | null;

interface CashAccountingEntryRow {
  id: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
}

interface CashVoucherImportMappedData extends Record<string, string | number | boolean | null> {
  voucherDate: string;
  voucherNo: string;
  voucherType: "RECEIPT" | "PAYMENT";
  note: string;
  partnerCode: string;
  partnerName: string;
  paymentReason: "CUSTOMER_PAYMENT" | "SUPPLIER_PAYMENT" | "BANK_WITHDRAWAL" | "BANK_DEPOSIT" | "OTHER";
  paymentMethod: "CASH" | "TRANSFER";
  amount: number;
}

function toDateString(value: Dayjs): string {
  return value.format("YYYY-MM-DD");
}

function getYearToDateRange(): [Dayjs, Dayjs] {
  return [dayjs().startOf("year"), dayjs().endOf("day")];
}

const paymentReasonLabelMap: Record<PaymentReason, string> = {
  CUSTOMER_PAYMENT: "Thu tiền khách hàng",
  SUPPLIER_PAYMENT: "Trả tiền nhà cung cấp",
  BANK_WITHDRAWAL: "Thu rút tiền gửi",
  BANK_DEPOSIT: "Nộp tiền ngân hàng",
  OTHER: "Khác"
};

function mapPaymentMethodLabel(value: VoucherHistoryItem["paymentMethod"]): string {
  if (value === "TRANSFER") {
    return "Tiền gửi";
  }
  if (value === "CASH") {
    return "Tiền mặt";
  }
  return "-";
}

function getCashAccountingEntries(detail: VoucherDetail | undefined): CashAccountingEntryRow[] {
  const entries = detail?.metadata?.entries;
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      return {
        id: String(record.id ?? `entry-${index + 1}`),
        description: typeof record.description === "string" ? record.description : "-",
        debitAccount: typeof record.debitAccount === "string" ? record.debitAccount : "-",
        creditAccount: typeof record.creditAccount === "string" ? record.creditAccount : "-",
        amount: typeof record.amount === "number" ? record.amount : 0
      };
    })
    .filter((item): item is CashAccountingEntryRow => item !== null);
}

export function CashVouchersPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<"ALL" | "CASH" | "TRANSFER">("ALL");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(null);
  const [selectedVoucherRowKeys, setSelectedVoucherRowKeys] = useState<string[]>([]);
  const [drawerConfig, setDrawerConfig] = useState<CashDrawerConfig>(null);
  const [openImportModal, setOpenImportModal] = useState(false);

  const openExistingVoucherDrawer = async (voucherId: string) => {
    try {
      const detail = await fetchVoucherById(voucherId);
      if (detail.type !== "RECEIPT" && detail.type !== "PAYMENT") {
        message.warning("Chỉ hỗ trợ mở phiếu thu/chi.");
        return;
      }

      const metadata = (detail.metadata ?? {}) as Record<string, unknown>;
      const isInvoiceBased = Boolean(detail.allocations?.length) || Boolean(metadata.isInvoiceBased);
      const isExpenseInvoiceMode =
        detail.type === "PAYMENT" &&
        detail.paymentReason === "OTHER" &&
        !isInvoiceBased &&
        typeof metadata.expenseInvoice === "object" &&
        metadata.expenseInvoice !== null;

      setSelectedVoucherId(detail.id);
      setDrawerConfig({
        voucherType: detail.type,
        paymentReason: detail.paymentReason ?? "OTHER",
        invoiceBased: isInvoiceBased,
        entryMode: isExpenseInvoiceMode ? "EXPENSE_INVOICE" : "STANDARD",
        voucherId: detail.id
      });
    } catch (_error) {
      message.error("Không mở được chứng từ.");
    }
  };

  useEffect(() => {
    if (!range) {
      setRange(getYearToDateRange());
    }
  }, [range]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const next = searchInput.trim();
      if (next !== search) {
        setSearch(next);
      }
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search, searchInput]);

  const receiptQuery = useQuery({
    queryKey: ["cash-vouchers", "receipt", search, range?.[0]?.toISOString(), range?.[1]?.toISOString()],
    queryFn: () =>
      fetchVouchers({
        page: 1,
        pageSize: 100,
        type: "RECEIPT",
        search: search || undefined,
        startDate: toDateString(range?.[0] ?? getYearToDateRange()[0]),
        endDate: toDateString(range?.[1] ?? getYearToDateRange()[1])
      }),
    enabled: Boolean(range)
  });

  const paymentQuery = useQuery({
    queryKey: ["cash-vouchers", "payment", search, range?.[0]?.toISOString(), range?.[1]?.toISOString()],
    queryFn: () =>
      fetchVouchers({
        page: 1,
        pageSize: 100,
        type: "PAYMENT",
        search: search || undefined,
        startDate: toDateString(range?.[0] ?? getYearToDateRange()[0]),
        endDate: toDateString(range?.[1] ?? getYearToDateRange()[1])
      }),
    enabled: Boolean(range)
  });

  const cashVouchers = useMemo(() => {
    const merged = [...(receiptQuery.data?.items ?? []), ...(paymentQuery.data?.items ?? [])];
    const sorted = merged.sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf());
    if (paymentMethodFilter === "ALL") {
      return sorted;
    }
    return sorted.filter((item) => {
      const isBankByReason = item.paymentReason === "BANK_WITHDRAWAL" || item.paymentReason === "BANK_DEPOSIT";
      const isTransfer = item.paymentMethod === "TRANSFER";
      if (paymentMethodFilter === "TRANSFER") {
        return isTransfer || isBankByReason;
      }
      return !isTransfer && !isBankByReason;
    });
  }, [paymentMethodFilter, paymentQuery.data?.items, receiptQuery.data?.items]);

  useEffect(() => {
    if (!cashVouchers.length) {
      setSelectedVoucherId(null);
      return;
    }
    if (!selectedVoucherId || !cashVouchers.some((item) => item.id === selectedVoucherId)) {
      setSelectedVoucherId(cashVouchers[0].id);
    }
  }, [cashVouchers, selectedVoucherId]);

  useEffect(() => {
    const validIds = new Set(cashVouchers.map((item) => item.id));
    setSelectedVoucherRowKeys((prev) => prev.filter((id) => validIds.has(id)));
  }, [cashVouchers]);

  const detailQuery = useQuery({
    queryKey: ["cash-voucher-detail", selectedVoucherId],
    queryFn: () => fetchVoucherById(selectedVoucherId as string),
    enabled: Boolean(selectedVoucherId)
  });

  const summary = useMemo(() => {
    const totalReceipt = (receiptQuery.data?.items ?? []).reduce((sum, item) => sum + item.totalNetAmount, 0);
    const totalPayment = (paymentQuery.data?.items ?? []).reduce((sum, item) => sum + item.totalNetAmount, 0);
    return {
      totalReceipt,
      totalPayment,
      currentFund: totalReceipt - totalPayment
    };
  }, [paymentQuery.data?.items, receiptQuery.data?.items]);

  const downloadWorkbook = (workbook: XLSX.WorkBook, fileName: string) => {
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName.replace(/[\\/:*?"<>|]/g, "_");
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const fetchAllVoucherByType = async (type: "RECEIPT" | "PAYMENT"): Promise<VoucherHistoryItem[]> => {
    const pageSizeForExport = 200;
    let currentPage = 1;
    let total = 0;
    const allItems: VoucherHistoryItem[] = [];

    do {
      const response = await fetchVouchers({
        page: currentPage,
        pageSize: pageSizeForExport,
        type,
        search: search || undefined,
        startDate: toDateString(range?.[0] ?? getYearToDateRange()[0]),
        endDate: toDateString(range?.[1] ?? getYearToDateRange()[1])
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

  const exportCashBookExcel = async (bookType: "CASH" | "BANK"): Promise<void> => {
    try {
      const [allReceipts, allPayments] = await Promise.all([fetchAllVoucherByType("RECEIPT"), fetchAllVoucherByType("PAYMENT")]);
      const merged = [...allReceipts, ...allPayments].sort((left, right) => dayjs(left.voucherDate).valueOf() - dayjs(right.voucherDate).valueOf());
      const filtered = merged.filter((item) => {
        const isBankByReason = item.paymentReason === "BANK_WITHDRAWAL" || item.paymentReason === "BANK_DEPOSIT";
        const isTransfer = item.paymentMethod === "TRANSFER";
        if (bookType === "BANK") {
          return isTransfer || isBankByReason;
        }
        return !isTransfer && !isBankByReason;
      });

      if (!filtered.length) {
        message.warning(bookType === "BANK" ? "Không có dữ liệu thu chi tiền gửi." : "Không có dữ liệu thu chi tiền mặt.");
        return;
      }

      const dateFromText = range?.[0]?.format("DD/MM/YYYY") ?? dayjs().startOf("year").format("DD/MM/YYYY");
      const dateToText = range?.[1]?.format("DD/MM/YYYY") ?? dayjs().endOf("day").format("DD/MM/YYYY");
      const title = bookType === "BANK" ? "THU CHI TIỀN GỬI" : "THU CHI TIỀN MẶT";
      const header = ["Ngày hạch toán", "Số chứng từ", "Diễn giải", "Đối tượng", "Lý do thu/chi", "Loại chứng từ", "Phương thức", "Số tiền"];

      const worksheet = XLSX.utils.aoa_to_sheet([
        [title],
        [`Từ ngày ${dateFromText} đến ngày ${dateToText}`],
        [],
        header,
        ...filtered.map((item) => [
          dayjs(item.voucherDate).format("DD/MM/YYYY"),
          item.voucherNo ?? item.id.slice(0, 8),
          item.note ?? "",
          item.partnerName ?? "",
          item.paymentReason ? paymentReasonLabelMap[item.paymentReason] : "-",
          item.type === "RECEIPT" ? "Phiếu thu" : "Phiếu chi",
          mapPaymentMethodLabel(item.paymentMethod),
          item.totalNetAmount
        ])
      ]);

      worksheet["!merges"] = [XLSX.utils.decode_range("A1:H1"), XLSX.utils.decode_range("A2:H2")];
      worksheet["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 36 }, { wch: 28 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];

      const headerRow = 4;
      for (let col = 0; col < header.length; col += 1) {
        const headerCell = worksheet[XLSX.utils.encode_cell({ r: headerRow - 1, c: col })] as (XLSX.CellObject & { s?: Record<string, unknown> }) | undefined;
        if (headerCell) {
          headerCell.s = {
            font: { bold: true },
            alignment: { horizontal: "center", vertical: "center" },
            fill: { patternType: "solid", fgColor: { rgb: "D9E1F2" } }
          };
        }
      }

      for (let row = headerRow + 1; row <= headerRow + filtered.length; row += 1) {
        const amountCell = worksheet[XLSX.utils.encode_cell({ r: row - 1, c: 7 })] as (XLSX.CellObject & { s?: Record<string, unknown> }) | undefined;
        if (amountCell) {
          amountCell.s = { alignment: { horizontal: "right" }, numFmt: "#,##0" };
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, bookType === "BANK" ? "ThuChiTienGui" : "ThuChiTienMat");
      const stamp = dayjs().format("YYYYMMDD-HHmmss");
      const fileName = bookType === "BANK" ? `Thu_chi_tien_gui_${stamp}.xlsx` : `Thu_chi_tien_mat_${stamp}.xlsx`;
      downloadWorkbook(workbook, fileName);
      message.success(bookType === "BANK" ? "Đã xuất Excel thu chi tiền gửi." : "Đã xuất Excel thu chi tiền mặt.");
    } catch (error) {
      message.error((error as Error).message || "Xuất Excel thất bại.");
    }
  };

  const voucherColumns: TableColumnsType<VoucherHistoryItem> = [
    {
      title: "Ngày hạch toán",
      dataIndex: "voucherDate",
      key: "voucherDate",
      width: 130,
      align: "center",
      render: (value: string) => dayjs(value).format("DD/MM/YYYY")
    },
    {
      title: "Số chứng từ",
      dataIndex: "voucherNo",
      key: "voucherNo",
      width: 160,
      render: (value: string | null, record) => (
        <Typography.Link
          strong
          style={{ textDecoration: "underline" }}
          onClick={(event) => {
            event.stopPropagation();
            void openExistingVoucherDrawer(record.id);
          }}
        >
          {value ?? record.id.slice(0, 8)}
        </Typography.Link>
      )
    },
    {
      title: "Diễn giải",
      dataIndex: "note",
      key: "note",
      ellipsis: true,
      render: (value: string | null) => value ?? "-"
    },
    {
      title: "Số tiền",
      dataIndex: "totalNetAmount",
      key: "totalNetAmount",
      width: 170,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    },
    {
      title: "Đối tượng",
      dataIndex: "partnerName",
      key: "partnerName",
      width: 220,
      ellipsis: true,
      render: (value: string | null) => value ?? "-"
    },
    {
      title: "Lý do thu/chi",
      dataIndex: "paymentReason",
      key: "paymentReason",
      width: 190,
      render: (value: VoucherHistoryItem["paymentReason"]) => (value ? paymentReasonLabelMap[value] : "-")
    },
    {
      title: "Người tạo",
      dataIndex: "createdByName",
      key: "createdByName",
      width: 160,
      ellipsis: true,
      render: (value: string | null) => value ?? "-"
    }
  ];

  const allocationDetailColumns: TableColumnsType<NonNullable<VoucherDetail["allocations"]>[number]> = [
    {
      title: "Ngày hóa đơn",
      dataIndex: "invoiceVoucherDate",
      key: "invoiceVoucherDate",
      width: 140,
      render: (value: string) => dayjs(value).format("DD/MM/YYYY")
    },
    {
      title: "Số hóa đơn",
      dataIndex: "invoiceVoucherNo",
      key: "invoiceVoucherNo",
      width: 160,
      render: (value: string | null, record) => value ?? record.invoiceVoucherId.slice(0, 8)
    },
    {
      title: "Loại",
      dataIndex: "invoiceVoucherType",
      key: "invoiceVoucherType",
      width: 120,
      render: (value: "SALES" | "PURCHASE") => (value === "SALES" ? "Bán hàng" : "Mua hàng")
    },
    {
      title: "Số tiền phân bổ",
      dataIndex: "amountApplied",
      key: "amountApplied",
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    }
  ];

  const accountingDetailColumns: TableColumnsType<CashAccountingEntryRow> = [
    {
      title: "Diễn giải",
      dataIndex: "description",
      key: "description",
      ellipsis: true
    },
    {
      title: "TK Nợ",
      dataIndex: "debitAccount",
      key: "debitAccount",
      width: 120,
      align: "center"
    },
    {
      title: "TK Có",
      dataIndex: "creditAccount",
      key: "creditAccount",
      width: 120,
      align: "center"
    },
    {
      title: "Số tiền",
      dataIndex: "amount",
      key: "amount",
      width: 180,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    }
  ];

  const detailAccountingRows = useMemo(() => getCashAccountingEntries(detailQuery.data), [detailQuery.data]);
  const hasAllocations = Boolean(detailQuery.data?.allocations?.length);

  const handlePrintSelectedVoucher = async () => {
    if (!detailQuery.data) {
      return;
    }
    try {
      await downloadVoucherPdf(
        detailQuery.data.id,
        detailQuery.data.voucherNo ?? detailQuery.data.id,
        detailQuery.data.type
      );
    } catch (_error) {
      message.error("In chứng từ thất bại.");
    }
  };

  const receiptMenuItems: MenuProps["items"] = [
    { key: "CUSTOMER_PAYMENT_DIRECT", label: "Thu tiền khách hàng (không theo hóa đơn)" },
    { key: "CUSTOMER_PAYMENT_INVOICE", label: "Thu tiền khách hàng (theo hóa đơn)" },
    { key: "BANK_WITHDRAWAL", label: "Thu rút tiền gửi" },
    { key: "OTHER", label: "Thu khác" }
  ];

  const paymentMenuItems: MenuProps["items"] = [
    { key: "SUPPLIER_PAYMENT", label: "Trả tiền nhà cung cấp (theo hóa đơn)" },
    { key: "OTHER", label: "Phiếu chi (khác)" }
  ];

  const openReceiptDrawer = (key: string) => {
    if (key === "CUSTOMER_PAYMENT_DIRECT") {
      setDrawerConfig({
        voucherType: "RECEIPT",
        paymentReason: "CUSTOMER_PAYMENT",
        invoiceBased: false,
        entryMode: "STANDARD",
        voucherId: undefined
      });
      return;
    }

    if (key === "CUSTOMER_PAYMENT_INVOICE") {
      setDrawerConfig({
        voucherType: "RECEIPT",
        paymentReason: "CUSTOMER_PAYMENT",
        invoiceBased: true,
        entryMode: "STANDARD",
        voucherId: undefined
      });
      return;
    }

    setDrawerConfig({
      voucherType: "RECEIPT",
      paymentReason: key as PaymentReason,
      invoiceBased: false,
      entryMode: "STANDARD",
      voucherId: undefined
    });
  };

  const openPaymentDrawer = (key: string) => {
    setDrawerConfig({
      voucherType: "PAYMENT",
      paymentReason: key as PaymentReason,
      invoiceBased: key === "SUPPLIER_PAYMENT",
      voucherId: undefined
    });
  };

  const paymentMenuItemsMisa: MenuProps["items"] = [
    { key: "PURCHASE_EXPENSE_INVOICE", label: "Chi mua ngoài có hóa đơn" },
    { key: "SUPPLIER_PAYMENT_DIRECT", label: "Trả tiền nhà cung cấp (không theo hóa đơn)" },
    { key: "SUPPLIER_PAYMENT_INVOICE", label: "Trả tiền nhà cung cấp (theo hóa đơn)" },
    { key: "OTHER", label: "Phiếu chi (khác)" }
  ];

  const exportMenuItems: MenuProps["items"] = [
    { key: "CASH", label: "Xuất Excel thu chi tiền mặt" },
    { key: "BANK", label: "Xuất Excel thu chi tiền gửi" }
  ];

  const openPaymentDrawerMisa = (key: string) => {
    if (key === "PURCHASE_EXPENSE_INVOICE") {
      setDrawerConfig({
        voucherType: "PAYMENT",
        paymentReason: "OTHER",
        invoiceBased: false,
        entryMode: "EXPENSE_INVOICE",
        voucherId: undefined
      });
      return;
    }

    if (key === "SUPPLIER_PAYMENT_DIRECT") {
      setDrawerConfig({
        voucherType: "PAYMENT",
        paymentReason: "SUPPLIER_PAYMENT",
        invoiceBased: false,
        entryMode: "STANDARD",
        voucherId: undefined
      });
      return;
    }

    if (key === "SUPPLIER_PAYMENT_INVOICE") {
      setDrawerConfig({
        voucherType: "PAYMENT",
        paymentReason: "SUPPLIER_PAYMENT",
        invoiceBased: true,
        entryMode: "STANDARD",
        voucherId: undefined
      });
      return;
    }

    setDrawerConfig({
      voucherType: "PAYMENT",
      paymentReason: key as PaymentReason,
      invoiceBased: false,
      entryMode: "STANDARD",
      voucherId: undefined
    });
  };

  return (
    <div className="cash-management-page">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Thu, chi tiền
      </Typography.Title>

      <div className="cash-summary-grid">
        <div className="cash-summary-card">
          <Typography.Text type="secondary">Tổng thu đầu năm đến hiện tại</Typography.Text>
          <Typography.Title level={4}>{formatCurrency(summary.totalReceipt)}</Typography.Title>
        </div>
        <div className="cash-summary-card">
          <Typography.Text type="secondary">Tổng chi đầu năm đến hiện tại</Typography.Text>
          <Typography.Title level={4}>{formatCurrency(summary.totalPayment)}</Typography.Title>
        </div>
        <div className="cash-summary-card">
          <Typography.Text type="secondary">Tồn quỹ hiện tại</Typography.Text>
          <Typography.Title level={4}>{formatCurrency(summary.currentFund)}</Typography.Title>
        </div>
      </div>

      <div className="sales-split-view">
        <div className="sales-master-pane">
          <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
            <Space>
              <Button onClick={() => setSelectedVoucherRowKeys(cashVouchers.map((item) => item.id))}>
                Thực hiện hàng loạt
              </Button>
              <Button>Lọc</Button>
              <Typography.Text type="secondary">Đầu năm tới hiện tại</Typography.Text>
            </Space>
            <Space>
              <Input.Search
                allowClear
                placeholder="Tìm theo số chứng từ hoặc đối tượng"
                style={{ width: 320 }}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <Space.Compact>
                <Button
                  type={paymentMethodFilter === "CASH" ? "primary" : "default"}
                  onClick={() =>
                    setPaymentMethodFilter((current) => (current === "CASH" ? "ALL" : "CASH"))
                  }
                >
                  Tiền mặt
                </Button>
                <Button
                  type={paymentMethodFilter === "TRANSFER" ? "primary" : "default"}
                  onClick={() =>
                    setPaymentMethodFilter((current) => (current === "TRANSFER" ? "ALL" : "TRANSFER"))
                  }
                >
                  Chuyển khoản
                </Button>
              </Space.Compact>
              <DatePicker.RangePicker
                allowClear
                format="DD/MM/YYYY"
                value={range}
                onChange={(nextRange) => {
                  if (!nextRange || !nextRange[0] || !nextRange[1]) {
                    setRange(getYearToDateRange());
                    return;
                  }
                  setRange([nextRange[0].startOf("day"), nextRange[1].endOf("day")]);
                }}
              />
              <Dropdown
                menu={{
                  items: exportMenuItems,
                  onClick: ({ key }) => {
                    if (String(key) === "BANK") {
                      void exportCashBookExcel("BANK");
                      return;
                    }
                    void exportCashBookExcel("CASH");
                  }
                }}
              >
                <Button icon={<DownloadOutlined />}>
                  Xuất Excel <DownOutlined />
                </Button>
              </Dropdown>
              <Button icon={<UploadOutlined />} onClick={() => setOpenImportModal(true)}>
                Nhập từ Excel
              </Button>
              <Dropdown
                menu={{
                  items: receiptMenuItems,
                  onClick: ({ key }) => openReceiptDrawer(String(key))
                }}
              >
                <Button type="primary" icon={<PlusOutlined />}>
                  Thu tiền <DownOutlined />
                </Button>
              </Dropdown>
              <Dropdown
                menu={{
                  items: paymentMenuItemsMisa,
                  onClick: ({ key }) => openPaymentDrawerMisa(String(key))
                }}
              >
                <Button type="primary">
                  Chi tiền <DownOutlined />
                </Button>
              </Dropdown>
            </Space>
          </Space>

          <Table<VoucherHistoryItem>
            rowKey="id"
            bordered
            size="small"
            className="sales-master-table"
            loading={receiptQuery.isFetching || paymentQuery.isFetching}
            columns={voucherColumns}
            dataSource={cashVouchers}
            rowSelection={{
              columnWidth: 44,
              selectedRowKeys: selectedVoucherRowKeys,
              onChange: (nextKeys) => setSelectedVoucherRowKeys(nextKeys as string[])
            }}
            pagination={false}
            scroll={{ y: 320 }}
            onRow={(record) => ({
              onClick: () => setSelectedVoucherId(record.id)
            })}
            rowClassName={(record) => (record.id === selectedVoucherId ? "sales-master-active-row" : "")}
          />
        </div>

        <div className="sales-detail-pane">
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <Typography.Text strong>Chi tiết chứng từ: {detailQuery.data?.voucherNo ?? "-"}</Typography.Text>
            <Button onClick={() => void handlePrintSelectedVoucher()} disabled={!detailQuery.data}>
              In
            </Button>
          </Space>
          <div className="cash-detail-meta">
            <Typography.Text>{`Đối tượng: ${detailQuery.data?.partnerName ?? "-"}`}</Typography.Text>
            <Typography.Text>{`Lý do: ${
              detailQuery.data?.paymentReason ? paymentReasonLabelMap[detailQuery.data.paymentReason] : "-"
            }`}</Typography.Text>
            <Typography.Text strong>{`Tổng tiền: ${formatCurrency(detailQuery.data?.totalNetAmount ?? 0)}`}</Typography.Text>
          </div>
          {hasAllocations ? (
            <Table<NonNullable<VoucherDetail["allocations"]>[number]>
              rowKey="id"
              bordered
              size="small"
              style={{ marginTop: 8 }}
              loading={detailQuery.isFetching}
              columns={allocationDetailColumns}
              dataSource={detailQuery.data?.allocations ?? []}
              pagination={false}
              locale={{ emptyText: "Không có dữ liệu chi tiết" }}
              scroll={{ y: 220 }}
            />
          ) : (
            <Table<CashAccountingEntryRow>
              rowKey="id"
              bordered
              size="small"
              style={{ marginTop: 8 }}
              loading={detailQuery.isFetching}
              columns={accountingDetailColumns}
              dataSource={detailAccountingRows}
              pagination={false}
              locale={{ emptyText: "Không có dữ liệu chi tiết" }}
              scroll={{ y: 220 }}
            />
          )}
        </div>
      </div>

      {drawerConfig ? (
        <CashVoucherDrawer
          open={Boolean(drawerConfig)}
          voucherType={drawerConfig.voucherType}
          paymentReason={drawerConfig.paymentReason}
          invoiceBased={drawerConfig.invoiceBased}
          entryMode={drawerConfig.entryMode}
          voucherId={drawerConfig.voucherId}
          onClose={() => setDrawerConfig(null)}
          onSuccess={(result) => {
            setDrawerConfig(null);
            void Promise.all([receiptQuery.refetch(), paymentQuery.refetch()]).then(() => {
              setSelectedVoucherId(result.voucherId);
            });
          }}
        />
      ) : null}

      <ImportWizardModal<CashVoucherImportMappedData>
        open={openImportModal}
        title="Nhập thu chi từ Excel"
        entityLabel="Phiếu thu chi"
        systemFields={[
          {
            key: "voucherDate",
            label: "Ngày chứng từ",
            required: true,
            aliases: ["ngay chung tu", "ngay hach toan", "date", "voucher date"]
          },
          {
            key: "voucherNo",
            label: "Số chứng từ",
            aliases: ["so chung tu", "so phieu", "voucher no", "voucher number"]
          },
          {
            key: "voucherType",
            label: "Loại phiếu",
            required: true,
            aliases: ["loai phieu", "loai thu chi", "type", "voucher type"]
          },
          {
            key: "note",
            label: "Diễn giải",
            aliases: ["dien giai", "ly do", "ghi chu", "note"]
          },
          {
            key: "partnerCode",
            label: "Mã đối tượng",
            aliases: ["ma doi tuong", "ma khach hang", "ma nha cung cap", "partner code"]
          },
          {
            key: "partnerName",
            label: "Tên đối tượng",
            aliases: ["ten doi tuong", "ten khach hang", "ten nha cung cap", "partner name"]
          },
          {
            key: "paymentReason",
            label: "Lý do thu chi",
            aliases: ["ly do thu chi", "payment reason", "reason"]
          },
          {
            key: "paymentMethod",
            label: "Phương thức thanh toán",
            aliases: ["phuong thuc thanh toan", "hinh thuc thanh toan", "payment method", "method"]
          },
          {
            key: "amount",
            label: "Số tiền",
            required: true,
            aliases: ["so tien", "thanh tien", "amount"],
            renderValue: (value) => formatCurrency(Number(value ?? 0))
          }
        ]}
        onCancel={() => setOpenImportModal(false)}
        onValidate={(payload) =>
          validateImportData<CashVoucherImportMappedData>({
            domain: "CASH_VOUCHERS",
            jsonData: payload.jsonData,
            mappingObject: payload.mappingObject as Record<string, string>,
            importMode: payload.importMode
          })
        }
        onCommit={(payload) =>
          commitImportData<CashVoucherImportMappedData>({
            domain: "CASH_VOUCHERS",
            rows: payload.rows,
            importMode: payload.importMode
          })
        }
        onCompleted={async () => {
          setOpenImportModal(false);
          await Promise.all([receiptQuery.refetch(), paymentQuery.refetch()]);
        }}
      />
    </div>
  );
}

