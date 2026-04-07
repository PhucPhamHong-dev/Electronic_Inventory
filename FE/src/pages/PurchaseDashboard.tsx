import { DownOutlined, PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Dropdown, Input, Space, Table, Tag, Typography, message } from "antd";
import type { MenuProps, TableColumnsType } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SalesVoucherDrawer } from "../components/SalesVoucherDrawer";
import { deleteVoucher, downloadVoucherPdf, duplicateVoucher, fetchVoucherById, fetchVouchers, payVoucher, unpostVoucher } from "../services/voucher.api";
import type { VoucherDetail, VoucherHistoryItem } from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";

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

function getTodayRange(): [Dayjs, Dayjs] {
  return [dayjs().startOf("day"), dayjs().endOf("day")];
}

export function PurchaseDashboardPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(null);
  const [selectedVoucherRowKeys, setSelectedVoucherRowKeys] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingVoucherId, setEditingVoucherId] = useState<string | null>(null);

  const pageSize = 20;

  useEffect(() => {
    if (!range) {
      setRange(getTodayRange());
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

  const vouchersQuery = useQuery({
    queryKey: ["purchase-vouchers", pageSize, search, range?.[0]?.toISOString(), range?.[1]?.toISOString()],
    queryFn: () =>
      fetchVouchers({
        page: 1,
        pageSize,
        type: "PURCHASE",
        search: search || undefined,
        startDate: toDateString(range?.[0] ?? getTodayRange()[0]),
        endDate: toDateString(range?.[1] ?? getTodayRange()[1])
      }),
    enabled: Boolean(range)
  });

  useEffect(() => {
    const items = vouchersQuery.data?.items ?? [];
    if (!items.length) {
      setSelectedVoucherId(null);
      return;
    }
    if (!selectedVoucherId || !items.some((item) => item.id === selectedVoucherId)) {
      setSelectedVoucherId(items[0].id);
    }
  }, [selectedVoucherId, vouchersQuery.data?.items]);

  useEffect(() => {
    const validIds = new Set((vouchersQuery.data?.items ?? []).map((item) => item.id));
    setSelectedVoucherRowKeys((prev) => prev.filter((id) => validIds.has(id)));
  }, [vouchersQuery.data?.items]);

  const voucherDetailQuery = useQuery({
    queryKey: ["purchase-voucher-detail", selectedVoucherId],
    queryFn: () => fetchVoucherById(selectedVoucherId as string),
    enabled: Boolean(selectedVoucherId)
  });

  const unpostMutation = useMutation({
    mutationFn: (voucherId: string) => unpostVoucher(voucherId),
    onSuccess: async () => {
      message.success("Bỏ ghi phiếu nhập thành công.");
      await Promise.all([vouchersQuery.refetch(), voucherDetailQuery.refetch()]);
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: (voucherId: string) => duplicateVoucher(voucherId),
    onSuccess: async (result) => {
      message.success("Đã nhân bản phiếu nhập.");
      await vouchersQuery.refetch();
      setEditingVoucherId(result.voucherId);
      setDrawerOpen(true);
    }
  });

  const payMutation = useMutation({
    mutationFn: (voucherId: string) => payVoucher(voucherId),
    onSuccess: async () => {
      message.success("Thanh toán phiếu nhập thành công.");
      await Promise.all([vouchersQuery.refetch(), voucherDetailQuery.refetch()]);
    }
  });
  const deleteVoucherMutation = useMutation({
    mutationFn: (voucherId: string) => deleteVoucher(voucherId),
    onSuccess: async () => {
      message.success("X\u00f3a phi\u1ebfu nh\u1eadp th\u00e0nh c\u00f4ng.");
      await Promise.all([vouchersQuery.refetch(), voucherDetailQuery.refetch()]);
    }
  });
  const tableActionLoading =
    unpostMutation.isPending || duplicateMutation.isPending || payMutation.isPending || deleteVoucherMutation.isPending;

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
        void downloadVoucherPdf(record.id, record.voucherNo ?? record.id, "PURCHASE");
        return;
      }
      if (action === "delete") {
        void deleteVoucherMutation.mutateAsync(record.id);
      }
    },
    [deleteVoucherMutation, duplicateMutation, payMutation, unpostMutation]
  );

  const getVoucherActionItems = useCallback((record: VoucherHistoryItem): MenuProps["items"] => {
    const items: NonNullable<MenuProps["items"]> = [];
    if (record.status === "BOOKED") {
      items.push({ key: "unpost", label: "B\u1ecf ghi" });
      if (record.paymentStatus !== "PAID") {
        items.push({ key: "pay", label: "Thanh to\u00e1n" });
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
        items.push({ key: "pay", label: "Thanh to\u00e1n" });
      }
    }
    items.push({ key: "duplicate", label: "Nh\u00e2n b\u1ea3n" });
    items.push({ key: "print", label: "In" });
    if (record.status === "DRAFT") {
      items.push({ key: "delete", label: "X\u00f3a" });
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
        title: "Số phiếu nhập",
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
        title: "Nhà cung cấp",
        dataIndex: "partnerName",
        key: "partnerName",
        ellipsis: true,
        render: (value: string | null) => value ?? "-"
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
        render: (value: VoucherHistoryItem["paymentMethod"]) => mapPaymentMethodLabel(value)
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

  const detailColumns: TableColumnsType<VoucherDetail["items"][number]> = useMemo(
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

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Mua hàng
      </Typography.Title>

      <div className="sales-split-view">
        <div className="sales-master-pane">
          <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
            <Space>
              <Button onClick={() => setSelectedVoucherRowKeys((vouchersQuery.data?.items ?? []).map((item) => item.id))}>
                Thực hiện hàng loạt
              </Button>
              <Input.Search
                allowClear
                placeholder="Tìm theo số phiếu hoặc nhà cung cấp"
                style={{ width: 360 }}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
              <DatePicker.RangePicker
                allowClear
                format="DD/MM/YYYY"
                value={range}
                onChange={(nextRange) => {
                  if (!nextRange || !nextRange[0] || !nextRange[1]) {
                    setRange(getTodayRange());
                    return;
                  }
                  setRange([nextRange[0].startOf("day"), nextRange[1].endOf("day")]);
                }}
              />
            </Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ background: "#0050b3", borderColor: "#0050b3" }}
              onClick={() => {
                setEditingVoucherId(null);
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
            loading={vouchersQuery.isFetching || tableActionLoading}
            columns={voucherColumns}
            dataSource={vouchersQuery.data?.items ?? []}
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
            summary={() => {
              const summary = vouchersQuery.data?.summary;
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
                    <Typography.Text strong>{`Thanh toán: ${formatCurrency(summary.totalNetAmount)}`}</Typography.Text>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />
        </div>

        <div className="sales-detail-pane">
          <Typography.Text strong>Chi tiết phiếu nhập: {voucherDetailQuery.data?.voucherNo ?? "-"}</Typography.Text>
          <Table<VoucherDetail["items"][number]>
            rowKey="id"
            bordered
            size="small"
            style={{ marginTop: 8 }}
            loading={voucherDetailQuery.isFetching}
            columns={detailColumns}
            dataSource={voucherDetailQuery.data?.items ?? []}
            pagination={false}
            scroll={{ y: 220 }}
          />
        </div>
      </div>

      <SalesVoucherDrawer
        open={drawerOpen}
        voucherId={editingVoucherId}
        mode="purchase"
        onClose={() => {
          setDrawerOpen(false);
          setEditingVoucherId(null);
        }}
        onSuccess={() => {
          void Promise.all([vouchersQuery.refetch(), voucherDetailQuery.refetch()]);
        }}
      />
    </div>
  );
}






