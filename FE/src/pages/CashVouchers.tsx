import { DownOutlined, PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Dropdown, Input, Space, Table, Typography, message } from "antd";
import type { MenuProps, TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import { CashVoucherDrawer } from "../components/CashVoucherDrawer";
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
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(null);
  const [selectedVoucherRowKeys, setSelectedVoucherRowKeys] = useState<string[]>([]);
  const [drawerConfig, setDrawerConfig] = useState<CashDrawerConfig>(null);

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
    return merged.sort((a, b) => dayjs(b.createdAt).valueOf() - dayjs(a.createdAt).valueOf());
  }, [paymentQuery.data?.items, receiptQuery.data?.items]);

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
    </div>
  );
}

