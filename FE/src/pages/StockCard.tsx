import { DownloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useMemo, useState } from "react";
import { AppSelect } from "../components/common/AppSelect";
import { fetchProducts } from "../services/masterData.api";
import { exportStockCardExcel, fetchStockCard } from "../services/report.api";
import type { ProductOption, StockCardItem } from "../types/voucher";
import { formatNumber } from "../utils/formatters";

function formatDateTime(value: string): string {
  return dayjs(value).format("DD/MM/YYYY HH:mm");
}

function formatDateQuery(value: Dayjs): string {
  return value.format("YYYY-MM-DD");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(new Blob([blob]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function StockCardPage() {
  const [productId, setProductId] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs().startOf("month"),
    dayjs().endOf("day")
  ]);

  const productsQuery = useQuery({
    queryKey: ["stock-card-products", keyword],
    queryFn: () =>
      fetchProducts({
        page: 1,
        pageSize: 200,
        keyword: keyword.trim() || undefined
      })
  });

  const stockCardQuery = useQuery({
    queryKey: [
      "stock-card",
      productId,
      dateRange?.[0]?.format("YYYY-MM-DD"),
      dateRange?.[1]?.format("YYYY-MM-DD")
    ],
    queryFn: () =>
      fetchStockCard({
        productId: productId as string,
        startDate: dateRange ? formatDateQuery(dateRange[0]) : undefined,
        endDate: dateRange ? formatDateQuery(dateRange[1]) : undefined
      }),
    enabled: Boolean(productId)
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      return exportStockCardExcel({
        productId: productId as string,
        startDate: dateRange ? formatDateQuery(dateRange[0]) : undefined,
        endDate: dateRange ? formatDateQuery(dateRange[1]) : undefined
      });
    },
    onSuccess: (blob) => {
      const productSku = stockCardQuery.data?.product.skuCode ?? "VatTu";
      downloadBlob(blob, `The_Kho_${productSku}.xlsx`);
    }
  });

  const columns: ColumnsType<StockCardItem> = useMemo(
    () => [
      {
        title: "Ngày tháng",
        dataIndex: "createdAt",
        key: "createdAt",
        width: 170,
        render: (value: string) => formatDateTime(value)
      },
      {
        title: "Số CT",
        dataIndex: "voucherNo",
        key: "voucherNo",
        width: 130,
        render: (value: string | null) => value ?? "-"
      },
      {
        title: "Diễn giải",
        dataIndex: "description",
        key: "description",
        ellipsis: true
      },
      {
        title: "Nhập",
        dataIndex: "quantityIn",
        key: "quantityIn",
        align: "right",
        width: 140,
        render: (value: number | null) =>
          value && value > 0 ? <Typography.Text style={{ color: "#389e0d" }}>{formatNumber(value)}</Typography.Text> : ""
      },
      {
        title: "Xuất",
        dataIndex: "quantityOut",
        key: "quantityOut",
        align: "right",
        width: 140,
        render: (value: number | null) =>
          value && value > 0 ? <Typography.Text style={{ color: "#cf1322" }}>{formatNumber(value)}</Typography.Text> : ""
      },
      {
        title: "Tồn",
        dataIndex: "quantityAfter",
        key: "quantityAfter",
        align: "right",
        width: 140,
        render: (value: number) => <Typography.Text strong>{formatNumber(value)}</Typography.Text>
      }
    ],
    []
  );

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Thẻ kho
      </Typography.Title>

      <Space style={{ marginBottom: 12 }} wrap>
        <Typography.Text strong>Hàng hóa:</Typography.Text>
        <AppSelect
          showSearch
          filterOption={false}
          style={{ width: 380 }}
          placeholder="Chọn một mặt hàng để xem thẻ kho"
          value={productId}
          onSearch={(text) => setKeyword(text)}
          onChange={(value) => setProductId(value)}
          options={(productsQuery.data?.items ?? []).map((item: ProductOption) => ({
            value: item.id,
            label: `${item.skuCode} - ${item.name}`
          }))}
        />

        <DatePicker.RangePicker
          value={dateRange}
          format="DD/MM/YYYY"
          onChange={(values) => {
            if (!values || !values[0] || !values[1]) {
              setDateRange(null);
              return;
            }
            setDateRange([values[0].startOf("day"), values[1].endOf("day")]);
          }}
        />

        <Button
          type="primary"
          icon={<DownloadOutlined />}
          loading={exportMutation.isPending}
          disabled={!productId}
          onClick={() => {
            void exportMutation.mutateAsync();
          }}
        >
          Xuất Excel
        </Button>
      </Space>

      <Table<StockCardItem>
        rowKey="id"
        bordered
        size="small"
        loading={stockCardQuery.isFetching}
        columns={columns}
        dataSource={stockCardQuery.data?.items ?? []}
        pagination={false}
      />
    </div>
  );
}

