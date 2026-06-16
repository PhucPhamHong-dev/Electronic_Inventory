import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Segmented, Space, Table, Typography, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { AppSelect } from "./common/AppSelect";
import { fetchPartners } from "../services/masterData.api";
import { exportDebtPdf, fetchArLedger } from "../services/report.api";
import type { ArLedgerItem, PartnerOption } from "../types/voucher";
import { formatCurrency } from "../utils/formatters";

interface ArLedgerRow extends ArLedgerItem {
  key: string;
}

export type LedgerPartnerType = "CUSTOMER" | "SUPPLIER";

interface ArLedgerPanelProps {
  initialPartnerType?: LedgerPartnerType;
  allowedPartnerTypes?: LedgerPartnerType[];
  showTitle?: boolean;
}

function formatDateQuery(value: Dayjs): string {
  return value.format("YYYY-MM-DD");
}

function triggerFileDownload(blob: Blob, fileName: string): void {
  const blobUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(blobUrl);
}

function formatMoneyPlain(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(value));
}

export function ArLedgerPanel({
  initialPartnerType = "CUSTOMER",
  allowedPartnerTypes = ["CUSTOMER", "SUPPLIER"],
  showTitle = true
}: ArLedgerPanelProps) {
  const [partnerType, setPartnerType] = useState<LedgerPartnerType>(initialPartnerType);
  const [partnerId, setPartnerId] = useState<string>();
  const [page, setPage] = useState(1);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Dayjs>(dayjs().startOf("month"));
  const [endDate, setEndDate] = useState<Dayjs>(dayjs().endOf("day"));
  const pageSize = 20;
  const canSwitchPartnerType = allowedPartnerTypes.length > 1;

  useEffect(() => {
    setPartnerType(initialPartnerType);
    setPartnerId(undefined);
    setActiveRowId(null);
    setPage(1);
  }, [initialPartnerType]);

  const partnersQuery = useQuery({
    queryKey: ["ar-ledger-partners", partnerType],
    queryFn: () => fetchPartners({ page: 1, pageSize: 200, type: partnerType })
  });

  const ledgerQuery = useQuery({
    queryKey: ["ar-ledger", partnerType, partnerId, page, pageSize, startDate.format("YYYY-MM-DD"), endDate.format("YYYY-MM-DD")],
    queryFn: () =>
      fetchArLedger({
        partnerId: partnerId as string,
        page,
        pageSize,
        startDate: formatDateQuery(startDate),
        endDate: formatDateQuery(endDate)
      }),
    enabled: Boolean(partnerId)
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!partnerId) {
        throw new Error(partnerType === "SUPPLIER" ? "Vui lòng chọn nhà cung cấp" : "Vui lòng chọn khách hàng");
      }
      return exportDebtPdf({
        partnerId,
        startDate: formatDateQuery(startDate),
        endDate: formatDateQuery(endDate)
      });
    },
    onSuccess: (blob) => {
      const dateLabel = dayjs().format("YYYYMMDD");
      const filePrefix = partnerType === "SUPPLIER" ? "so-cong-no-nha-cung-cap" : "so-cong-no-khach-hang";
      triggerFileDownload(blob, `${filePrefix}-${dateLabel}.pdf`);
      notification.success({
        message: "Xuất PDF thành công"
      });
    }
  });

  const partnerLabel = partnerType === "SUPPLIER" ? "Nhà cung cấp" : "Khách hàng";
  const ledgerTitle = partnerType === "SUPPLIER" ? "Sổ chi tiết công nợ nhà cung cấp" : "Sổ chi tiết công nợ khách hàng";
  const balanceLabel = partnerType === "SUPPLIER" ? "Công nợ phải trả hiện tại" : "Dư nợ hiện tại";

  const columns: ColumnsType<ArLedgerRow> = useMemo(
    () => [
      {
        title: "Ngày",
        dataIndex: "voucherDate",
        key: "voucherDate",
        align: "center",
        width: 130,
        render: (value: string) => dayjs(value).format("DD/MM/YYYY")
      },
      {
        title: "Số chứng từ",
        dataIndex: "voucherNo",
        key: "voucherNo",
        align: "center",
        width: 170,
        render: (value: string | null) => value ?? "-"
      },
      {
        title: "Diễn giải",
        dataIndex: "description",
        key: "description",
        align: "left",
        render: (value: string | null | undefined) => value ?? "-"
      },
      {
        title: partnerType === "SUPPLIER" ? "Tăng phải trả" : "Tăng phải thu",
        dataIndex: "debit",
        key: "debit",
        align: "right",
        width: 170,
        render: (value: number) => (value > 0 ? <Typography.Text>{formatMoneyPlain(value)}</Typography.Text> : "-")
      },
      {
        title: partnerType === "SUPPLIER" ? "Giảm phải trả" : "Giảm phải thu",
        dataIndex: "credit",
        key: "credit",
        align: "right",
        width: 170,
        render: (value: number) =>
          value > 0 ? <Typography.Text style={{ color: "#f5222d" }}>{formatMoneyPlain(value)}</Typography.Text> : "-"
      },
      {
        title: "Số dư cuối",
        dataIndex: "balanceAfter",
        key: "balanceAfter",
        align: "right",
        width: 190,
        render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
      }
    ],
    [partnerType]
  );

  const rows: ArLedgerRow[] = (ledgerQuery.data?.items ?? []).map((item) => ({
    ...item,
    key: item.id
  }));

  return (
    <div className="flex flex-col">
      {showTitle ? (
        <Typography.Title level={4} className="!mt-0">
          {ledgerTitle}
        </Typography.Title>
      ) : null}

      <Space className="mb-3 flex flex-wrap" size={12}>
        {canSwitchPartnerType ? (
          <Segmented
            value={partnerType}
            options={[
              { label: "Khách hàng", value: "CUSTOMER" },
              { label: "Nhà cung cấp", value: "SUPPLIER" }
            ].filter((item) => allowedPartnerTypes.includes(item.value as LedgerPartnerType))}
            onChange={(value) => {
              setPartnerType(value as LedgerPartnerType);
              setPartnerId(undefined);
              setActiveRowId(null);
              setPage(1);
            }}
          />
        ) : null}

        <Typography.Text strong>{partnerLabel}:</Typography.Text>
        <AppSelect
          showSearch
          style={{ width: 360 }}
          placeholder={`Chọn ${partnerType === "SUPPLIER" ? "nhà cung cấp" : "khách hàng"} để xem sổ công nợ`}
          optionFilterProp="label"
          value={partnerId}
          onChange={(value) => {
            setPartnerId(value);
            setPage(1);
          }}
          options={(partnersQuery.data?.items ?? []).map((partner: PartnerOption) => ({
            value: partner.id,
            label: partner.name
          }))}
        />

        <Typography.Text strong>Từ ngày:</Typography.Text>
        <DatePicker
          allowClear={false}
          format="DD/MM/YYYY"
          value={startDate}
          onChange={(value) => {
            if (value) {
              setStartDate(value.startOf("day"));
              setPage(1);
            }
          }}
        />

        <Typography.Text strong>Đến ngày:</Typography.Text>
        <DatePicker
          allowClear={false}
          format="DD/MM/YYYY"
          value={endDate}
          onChange={(value) => {
            if (value) {
              setEndDate(value.endOf("day"));
              setPage(1);
            }
          }}
        />

        <Button
          type="primary"
          loading={exportMutation.isPending}
          disabled={!partnerId}
          onClick={() => {
            void exportMutation.mutateAsync();
          }}
        >
          Xuất PDF Công Nợ
        </Button>

        {ledgerQuery.data?.partner ? (
          <Typography.Text type="secondary">
            {balanceLabel}: {formatCurrency(ledgerQuery.data.partner.currentDebt)}
          </Typography.Text>
        ) : null}
      </Space>

      <Table<ArLedgerRow>
        className="debt-ledger-table"
        size="small"
        bordered
        rowKey="key"
        loading={ledgerQuery.isFetching}
        columns={columns}
        dataSource={rows}
        onRow={(record) => ({
          onClick: () => {
            setActiveRowId(record.id);
          }
        })}
        rowClassName={(record) => (record.id === activeRowId ? "active-row" : "")}
        pagination={{
          current: page,
          pageSize,
          total: ledgerQuery.data?.total ?? 0,
          onChange: (nextPage) => {
            setPage(nextPage);
          }
        }}
      />
    </div>
  );
}
