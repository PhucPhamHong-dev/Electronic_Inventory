import { DollarOutlined, EyeOutlined, PrinterOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Input, Modal, Popconfirm, Space, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { downloadVoucherPdf, fetchVouchers, payVoucher } from "../services/voucher.api";
import type { VoucherHistoryItem, VoucherType } from "../types/voucher";
import { formatCurrency } from "../utils/formatters";

type VoucherHistoryTabKey = "ALL" | "SALES" | "PURCHASE" | "OPENING_BALANCE";

interface VoucherTypeMeta {
  label: string;
  color: string;
}

const voucherTypeMetaMap: Record<VoucherType, VoucherTypeMeta> = {
  PURCHASE: { label: "Phiếu nhập", color: "green" },
  SALES: { label: "Phiếu xuất", color: "volcano" },
  CONVERSION: { label: "Chuyển đổi", color: "gold" },
  RECEIPT: { label: "Phiếu thu", color: "cyan" },
  PAYMENT: { label: "Phiếu chi", color: "purple" },
  OPENING_BALANCE: { label: "Số dư đầu kỳ", color: "blue" }
};

const paymentStatusMetaMap = {
  UNPAID: { label: "Chưa thanh toán", color: "red" },
  PARTIAL: { label: "Thanh toán một phần", color: "orange" },
  PAID: { label: "Đã thanh toán", color: "green" }
} as const;

function resolveVoucherTypeByTab(tab: VoucherHistoryTabKey): VoucherType | undefined {
  if (tab === "ALL") {
    return undefined;
  }
  return tab;
}

function toDateString(value: Dayjs): string {
  return value.format("YYYY-MM-DD");
}

function canPrintVoucher(type: VoucherType): boolean {
  return type === "PURCHASE" || type === "SALES";
}

function canQuickPay(voucher: VoucherHistoryItem): boolean {
  if (voucher.paymentStatus !== "UNPAID") {
    return false;
  }
  return voucher.type === "SALES" || voucher.type === "PURCHASE";
}

export function VoucherHistoryPage() {
  const [activeTab, setActiveTab] = useState<VoucherHistoryTabKey>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState(1);
  const [selectedVoucher, setSelectedVoucher] = useState<VoucherHistoryItem | null>(null);
  const pageSize = 20;

  const voucherTypeFilter = resolveVoucherTypeByTab(activeTab);
  const startDate = range ? toDateString(range[0]) : undefined;
  const endDate = range ? toDateString(range[1]) : undefined;

  const vouchersQuery = useQuery({
    queryKey: ["voucher-history", activeTab, page, pageSize, searchKeyword, startDate, endDate],
    queryFn: () =>
      fetchVouchers({
        page,
        pageSize,
        type: voucherTypeFilter,
        search: searchKeyword.trim() || undefined,
        startDate,
        endDate
      })
  });

  const printMutation = useMutation({
    mutationFn: async (voucher: VoucherHistoryItem) => {
      const voucherNo = voucher.voucherNo ?? voucher.id;
      await downloadVoucherPdf(voucher.id, voucherNo, voucher.type);
    }
  });

  const quickPayMutation = useMutation({
    mutationFn: (voucherId: string) => payVoucher(voucherId),
    onSuccess: async () => {
      message.success("Đã thanh toán thành công và tạo phiếu đối ứng.");
      await vouchersQuery.refetch();
    }
  });

  const columns: ColumnsType<VoucherHistoryItem> = useMemo(
    () => [
      {
        title: "Ngày chứng từ",
        dataIndex: "createdAt",
        key: "createdAt",
        align: "center",
        width: 170,
        render: (value: string) => dayjs(value).format("DD/MM/YYYY HH:mm")
      },
      {
        title: "Số phiếu",
        dataIndex: "voucherNo",
        key: "voucherNo",
        width: 160,
        render: (value: string | null, record) => (
          <Button
            type="link"
            style={{ padding: 0, fontWeight: 600 }}
            onClick={() => {
              setSelectedVoucher(record);
            }}
          >
            {value ?? record.id}
          </Button>
        )
      },
      {
        title: "Loại phiếu",
        dataIndex: "type",
        key: "type",
        align: "center",
        width: 160,
        render: (type: VoucherType) => {
          const meta = voucherTypeMetaMap[type];
          return <Tag color={meta.color}>{meta.label}</Tag>;
        }
      },
      {
        title: "Đối tác",
        dataIndex: "partnerName",
        key: "partnerName",
        ellipsis: true,
        render: (value: string | null) => value ?? "-"
      },
      {
        title: "Tổng tiền",
        dataIndex: "totalNetAmount",
        key: "totalNetAmount",
        width: 180,
        align: "right",
        render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
      },
      {
        title: "TT thanh toán",
        dataIndex: "paymentStatus",
        key: "paymentStatus",
        align: "center",
        width: 180,
        render: (status: VoucherHistoryItem["paymentStatus"]) => {
          const meta = paymentStatusMetaMap[status];
          return <Tag color={meta.color}>{meta.label}</Tag>;
        }
      },
      {
        title: "Hành động",
        key: "actions",
        align: "center",
        width: 170,
        render: (_value, record) => (
          <Space size={8}>
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => {
                setSelectedVoucher(record);
              }}
            />
            <Button
              type="text"
              icon={<PrinterOutlined />}
              disabled={!canPrintVoucher(record.type)}
              loading={printMutation.isPending}
              onClick={() => {
                void printMutation.mutateAsync(record);
              }}
            />
            {canQuickPay(record) ? (
              <Popconfirm
                title="Xác nhận thanh toán?"
                description="Bạn có chắc chắn muốn thanh toán toàn bộ số tiền cho phiếu này? Hệ thống sẽ tự động tạo Phiếu Thu/Chi và trừ công nợ."
                okText="Xác nhận"
                cancelText="Hủy"
                onConfirm={() => quickPayMutation.mutateAsync(record.id)}
              >
                <Button
                  type="text"
                  icon={<DollarOutlined style={{ color: "green" }} />}
                  loading={quickPayMutation.isPending}
                />
              </Popconfirm>
            ) : null}
          </Space>
        )
      }
    ],
    [printMutation, quickPayMutation]
  );

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Lịch sử chứng từ
      </Typography.Title>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key as VoucherHistoryTabKey);
          setPage(1);
        }}
        items={[
          { key: "ALL", label: "Tất cả" },
          { key: "SALES", label: "Phiếu Xuất (Bán hàng)" },
          { key: "PURCHASE", label: "Phiếu Nhập (Mua hàng)" },
          { key: "OPENING_BALANCE", label: "Số dư đầu kỳ" }
        ]}
      />

      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
        <Input.Search
          allowClear
          placeholder="Tìm theo số chứng từ hoặc tên khách hàng"
          style={{ width: 360 }}
          value={searchInput}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSearchInput(nextValue);
            if (!nextValue.trim()) {
              setSearchKeyword("");
              setPage(1);
            }
          }}
          onSearch={(value) => {
            setSearchKeyword(value.trim());
            setPage(1);
          }}
        />
        <DatePicker.RangePicker
          allowClear
          format="DD/MM/YYYY"
          value={range}
          onChange={(nextRange) => {
            if (!nextRange || !nextRange[0] || !nextRange[1]) {
              setRange(null);
            } else {
              setRange([nextRange[0].startOf("day"), nextRange[1].endOf("day")]);
            }
            setPage(1);
          }}
        />
      </Space>

      <Table<VoucherHistoryItem>
        rowKey="id"
        bordered
        size="small"
        loading={vouchersQuery.isFetching}
        columns={columns}
        dataSource={vouchersQuery.data?.items ?? []}
        pagination={{
          current: page,
          pageSize,
          total: vouchersQuery.data?.total ?? 0,
          onChange: (nextPage) => {
            setPage(nextPage);
          }
        }}
      />

      <Modal
        open={Boolean(selectedVoucher)}
        title={selectedVoucher ? `Chi tiết ${selectedVoucher.voucherNo ?? selectedVoucher.id}` : "Chi tiết chứng từ"}
        onCancel={() => {
          setSelectedVoucher(null);
        }}
        footer={null}
      >
        {selectedVoucher ? (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text>
              <strong>Ngày chứng từ:</strong> {dayjs(selectedVoucher.voucherDate).format("DD/MM/YYYY")}
            </Typography.Text>
            <Typography.Text>
              <strong>Ngày tạo:</strong> {dayjs(selectedVoucher.createdAt).format("DD/MM/YYYY HH:mm")}
            </Typography.Text>
            <Typography.Text>
              <strong>Loại phiếu:</strong> {voucherTypeMetaMap[selectedVoucher.type].label}
            </Typography.Text>
            <Typography.Text>
              <strong>Đối tác:</strong> {selectedVoucher.partnerName ?? "-"}
            </Typography.Text>
            <Typography.Text>
              <strong>Tổng tiền:</strong> {formatCurrency(selectedVoucher.totalNetAmount)}
            </Typography.Text>
            <Typography.Text>
              <strong>Diễn giải:</strong> {selectedVoucher.note ?? "-"}
            </Typography.Text>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}

