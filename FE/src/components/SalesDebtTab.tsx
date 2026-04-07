import {
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined
} from "@ant-design/icons";
import { Pie } from "@ant-design/charts";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import { AppSelect } from "./common/AppSelect";
import {
  addDebtCollectionCustomers,
  createDebtCollection,
  fetchDebtCollections,
  fetchDebtSummary,
  removeDebtCollectionCustomer,
  updateDebtCollectionResult
} from "../services/debt.api";
import { fetchPartners } from "../services/masterData.api";
import type {
  DebtCollectionDetailItem,
  DebtCollectionItem,
  DebtCollectionStatus,
  DebtOutstandingInvoice,
  DebtSummaryResponse
} from "../types/debt";
import type { PartnerOption } from "../types/voucher";
import { formatCurrency, formatNumber } from "../utils/formatters";

type DebtSubTab = "SUMMARY" | "COLLECTIONS";
type DetailMode = "PRE_DUE" | "OVERDUE";
type TargetInputMode = "PERCENT" | "AMOUNT";

interface CreateCollectionFormValues {
  name: string;
  description?: string;
  startDate: Dayjs;
  endDate?: Dayjs;
  totalDebtAmount: number;
  targetPercent: number;
  targetAmount: number;
}

interface ResultFormValues {
  actualAmount: number;
  resultText?: string;
  note?: string;
  promisedDate?: Dayjs;
}

interface ResultDraftRow {
  detailId: string;
  partnerName: string;
  expectedAmount: number;
  actualAmount: number;
  note: string;
}

interface RangeRow {
  id: string;
  from: number;
  to: number | null;
}

interface DebtDashboardSettings {
  preDueRanges: RangeRow[];
  overdueRanges: RangeRow[];
  detailMode: DetailMode;
}

interface SegmentItem {
  key: string;
  label: string;
  amount: number;
  color: string;
}

interface PartnerLookupOption {
  value: string;
  label: ReactNode;
  searchText: string;
  debt: number;
}

const SETTINGS_STORAGE_KEY = "sales-debt-dashboard-settings-v1";
const UPCOMING_WINDOW_DAYS = 10;

const defaultSettings: DebtDashboardSettings = {
  preDueRanges: [
    { id: "pre-0", from: 0, to: 30 },
    { id: "pre-1", from: 31, to: 60 },
    { id: "pre-2", from: 61, to: 90 },
    { id: "pre-3", from: 91, to: 120 },
    { id: "pre-4", from: 121, to: null }
  ],
  overdueRanges: [
    { id: "over-0", from: 1, to: 30 },
    { id: "over-1", from: 31, to: 60 },
    { id: "over-2", from: 61, to: 90 },
    { id: "over-3", from: 91, to: 120 },
    { id: "over-4", from: 121, to: null }
  ],
  detailMode: "OVERDUE"
};

const statusMeta: Record<DebtCollectionStatus, { label: string; color: string }> = {
  PENDING: { label: "Đang theo dõi", color: "gold" },
  COMPLETED: { label: "Hoàn thành", color: "green" }
};

const preDueColors = ["#69b1ff", "#95de64", "#36cfc9", "#13c2c2", "#08979c"];
const overdueColors = ["#ffd666", "#faad14", "#fa8c16", "#fa541c", "#cf1322"];

function createRangeRow(prefix: string): RangeRow {
  return {
    id: `${prefix}-${crypto.randomUUID()}`,
    from: 0,
    to: null
  };
}

function loadSettings(): DebtDashboardSettings {
  if (typeof window === "undefined") {
    return defaultSettings;
  }

  const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) {
    return defaultSettings;
  }

  try {
    const parsed = JSON.parse(raw) as DebtDashboardSettings;
    if (!parsed.preDueRanges?.length || !parsed.overdueRanges?.length) {
      return defaultSettings;
    }
    return parsed;
  } catch {
    return defaultSettings;
  }
}

function saveSettings(settings: DebtDashboardSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function startOfToday(): dayjs.Dayjs {
  return dayjs().startOf("day");
}

function diffDays(targetDate: string): number {
  return dayjs(targetDate).startOf("day").diff(startOfToday(), "day");
}

function buildRecoveryPercent(summary?: DebtSummaryResponse): number {
  const total = (summary?.collectedAmount ?? 0) + (summary?.outstandingAmount ?? 0);
  if (total <= 0) {
    return 0;
  }
  return Number((((summary?.collectedAmount ?? 0) / total) * 100).toFixed(1));
}

function buildSegmentWidth(amount: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  return `${Math.max((amount / total) * 100, 1)}%`;
}

function sumAmounts(items: Array<{ amount: number }>): number {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function buildTotalDebtSegments(
  invoices: DebtOutstandingInvoice[],
  settings: DebtDashboardSettings
): {
  segments: SegmentItem[];
  currentTotal: number;
  overdueTotal: number;
  noDueTotal: number;
} {
  const preDueTotals = settings.preDueRanges.map((range, index) => ({
    key: range.id,
    label: range.to === null ? `Trước hạn từ ${range.from} ngày` : `Trước hạn ${range.from}-${range.to} ngày`,
    amount: 0,
    color: preDueColors[index % preDueColors.length]
  }));

  const overdueTotals = settings.overdueRanges.map((range, index) => ({
    key: range.id,
    label: range.to === null ? `Quá hạn trên ${range.from} ngày` : `Quá hạn ${range.from}-${range.to} ngày`,
    amount: 0,
    color: overdueColors[index % overdueColors.length]
  }));

  let noDueTotal = 0;

  invoices.forEach((invoice) => {
    if (!invoice.dueDate) {
      noDueTotal += invoice.remainingAmount;
      return;
    }

    const delta = diffDays(invoice.dueDate);
    if (delta >= 0) {
      const matchedIndex = settings.preDueRanges.findIndex(
        (range) => delta >= range.from && (range.to === null || delta <= range.to)
      );
      if (matchedIndex >= 0) {
        preDueTotals[matchedIndex].amount += invoice.remainingAmount;
      } else if (preDueTotals.length > 0) {
        preDueTotals[preDueTotals.length - 1].amount += invoice.remainingAmount;
      }
      return;
    }

    const overdueDays = Math.abs(delta);
    const matchedIndex = settings.overdueRanges.findIndex(
      (range) => overdueDays >= range.from && (range.to === null || overdueDays <= range.to)
    );
    if (matchedIndex >= 0) {
      overdueTotals[matchedIndex].amount += invoice.remainingAmount;
    } else if (overdueTotals.length > 0) {
      overdueTotals[overdueTotals.length - 1].amount += invoice.remainingAmount;
    }
  });

  const currentTotal = sumAmounts(preDueTotals);
  const overdueTotal = sumAmounts(overdueTotals);

  const segments =
    settings.detailMode === "PRE_DUE"
      ? [
          ...preDueTotals,
          { key: "overdue-total", label: "Quá hạn", amount: overdueTotal, color: "#fa8c16" },
          { key: "no-due", label: "Không có hạn", amount: noDueTotal, color: "#13c2c2" }
        ]
      : [
          { key: "current-total", label: "Chưa quá hạn", amount: currentTotal, color: "#69b1ff" },
          ...overdueTotals,
          { key: "no-due", label: "Không có hạn", amount: noDueTotal, color: "#13c2c2" }
        ];

  return { segments, currentTotal, overdueTotal, noDueTotal };
}

function buildUpcomingInvoices(invoices: DebtOutstandingInvoice[]): DebtOutstandingInvoice[] {
  return invoices
    .filter((invoice) => invoice.dueDate && diffDays(invoice.dueDate) >= 0 && diffDays(invoice.dueDate) <= UPCOMING_WINDOW_DAYS)
    .sort((left, right) => dayjs(left.dueDate).valueOf() - dayjs(right.dueDate).valueOf())
    .slice(0, 8);
}

function buildTargetAmount(totalDebtAmount: number, targetPercent: number): number {
  return Number(((totalDebtAmount * targetPercent) / 100).toFixed(0));
}

function buildTargetPercent(totalDebtAmount: number, targetAmount: number): number {
  if (totalDebtAmount <= 0) {
    return 0;
  }
  return Number(((targetAmount / totalDebtAmount) * 100).toFixed(2));
}

function downloadCollectionDetailsExcel(collection: DebtCollectionItem): void {
  const rows = collection.details.map((detail, index) => ({
    STT: index + 1,
    "Mã khách hàng": detail.partnerCode,
    "Tên khách hàng": detail.partnerName,
    "Số còn phải thu": detail.expectedAmount,
    "Địa chỉ": detail.partnerAddress ?? "",
    "Mã số thuế": detail.partnerTaxCode ?? "",
    "Điện thoại": detail.partnerPhone ?? "",
    "Đã thu": detail.actualAmount,
    "Kết quả thu nợ": detail.resultText ?? "",
    "Ghi chú": detail.note ?? "",
    "Ngày hẹn trả": detail.promisedDate ? dayjs(detail.promisedDate).format("DD/MM/YYYY") : ""
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Đợt thu nợ");
  XLSX.writeFile(workbook, `${collection.name.replace(/[\\/:*?\"<>|]/g, "_")}.xlsx`);
}

export function SalesDebtTab() {
  const [createForm] = Form.useForm<CreateCollectionFormValues>();
  const [subTab, setSubTab] = useState<DebtSubTab>("SUMMARY");
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState<DebtCollectionItem | null>(null);
  const [selectedPartnerIds, setSelectedPartnerIds] = useState<Array<string | number | bigint>>([]);
  const [selectedLookupPartnerId, setSelectedLookupPartnerId] = useState<string>();
  const [partnerKeyword, setPartnerKeyword] = useState("");
  const [collectionKeyword, setCollectionKeyword] = useState("");
  const [resultDrafts, setResultDrafts] = useState<ResultDraftRow[]>([]);
  const [settingsDraft, setSettingsDraft] = useState<DebtDashboardSettings>(loadSettings);
  const [settings, setSettings] = useState<DebtDashboardSettings>(loadSettings);
  const [targetInputMode, setTargetInputMode] = useState<TargetInputMode>("PERCENT");

  const summaryQuery = useQuery({
    queryKey: ["debt-summary"],
    queryFn: fetchDebtSummary
  });

  const collectionsQuery = useQuery({
    queryKey: ["debt-collections"],
    queryFn: fetchDebtCollections
  });

  const partnersQuery = useQuery({
    queryKey: ["debt-partners"],
    queryFn: () => fetchPartners({ page: 1, pageSize: 200, group: "CUSTOMER" })
  });

  const selectedPartners = useMemo(
    () => (partnersQuery.data?.items ?? []).filter((partner) => selectedPartnerIds.includes(partner.id)),
    [partnersQuery.data?.items, selectedPartnerIds]
  );

  const totalDebtAmount = useMemo(
    () => selectedPartners.reduce((sum, partner) => sum + partner.currentDebt, 0),
    [selectedPartners]
  );

  const targetPercent = Form.useWatch("targetPercent", createForm) ?? 70;
  const targetAmount = Form.useWatch("targetAmount", createForm) ?? 0;

  const createMutation = useMutation({
    mutationFn: createDebtCollection,
    onSuccess: async () => {
      message.success("Đã tạo đợt thu nợ.");
      setCreateOpen(false);
      setSelectedPartnerIds([]);
      createForm.resetFields();
      await Promise.all([collectionsQuery.refetch(), summaryQuery.refetch()]);
    }
  });

  const updateResultMutation = useMutation({
    mutationFn: (payload: { id: string; details: ResultDraftRow[] }) =>
      updateDebtCollectionResult(payload.id, {
        details: payload.details.map((detail) => ({
          detailId: detail.detailId,
          actualAmount: detail.actualAmount,
          note: detail.note,
          collectedAt: dayjs().toISOString()
        })),
        markCompleted: true
      }),
    onSuccess: async () => {
      message.success("Đã cập nhật kết quả thu nợ.");
      setResultOpen(false);
      setSelectedCollection(null);
      setResultDrafts([]);
      await Promise.all([collectionsQuery.refetch(), summaryQuery.refetch(), partnersQuery.refetch()]);
    }
  });

  useEffect(() => {
    if (!createOpen) {
      createForm.resetFields();
      setSelectedPartnerIds([]);
      setSelectedLookupPartnerId(undefined);
      setPartnerKeyword("");
      setTargetInputMode("PERCENT");
      return;
    }

    createForm.setFieldsValue({
      startDate: dayjs(),
      endDate: dayjs().endOf("month"),
      totalDebtAmount: 0,
      targetPercent: 70,
      targetAmount: 0
    });
  }, [createForm, createOpen]);

  useEffect(() => {
    if (!createOpen) {
      return;
    }

    if (targetInputMode === "AMOUNT") {
      createForm.setFieldsValue({
        totalDebtAmount,
        targetPercent: buildTargetPercent(totalDebtAmount, Number(targetAmount))
      });
      return;
    }

    createForm.setFieldsValue({
      totalDebtAmount,
      targetAmount: buildTargetAmount(totalDebtAmount, Number(targetPercent))
    });
  }, [createForm, createOpen, targetAmount, targetInputMode, targetPercent, totalDebtAmount]);

  useEffect(() => {
    if (!selectedCollection || !resultOpen) {
      setResultDrafts([]);
      return;
    }

    setResultDrafts(
      selectedCollection.details.map((detail) => ({
        detailId: detail.id,
        partnerName: detail.partnerName,
        expectedAmount: detail.expectedAmount,
        actualAmount: detail.actualAmount,
        note: detail.note ?? ""
      }))
    );
  }, [resultOpen, selectedCollection]);

  const summary = summaryQuery.data;
  const outstandingInvoices = summary?.outstandingInvoices ?? [];
  const { segments } = useMemo(() => buildTotalDebtSegments(outstandingInvoices, settings), [outstandingInvoices, settings]);
  const recoveryPercent = buildRecoveryPercent(summary);
  const upcomingInvoices = useMemo(() => buildUpcomingInvoices(outstandingInvoices), [outstandingInvoices]);
  const upcomingTotal = useMemo(() => upcomingInvoices.reduce((sum, item) => sum + item.remainingAmount, 0), [upcomingInvoices]);
  const topDebtors = summary?.topDebtors ?? [];
  const topDebtorsTotal = topDebtors.reduce((sum, item) => sum + item.amount, 0);

  const partnerLookupOptions = useMemo<PartnerLookupOption[]>(
    () =>
      (partnersQuery.data?.items ?? [])
        .filter((partner) => partner.currentDebt > 0)
        .sort((left, right) => right.currentDebt - left.currentDebt)
        .map((partner) => ({
          value: partner.id,
          label: (
            <span>
              {`${partner.name} `}
              <span style={{ color: "#cf1322", fontWeight: 600 }}>
                {`(Công nợ: ${formatCurrency(partner.currentDebt)})`}
              </span>
            </span>
          ),
          searchText: `${partner.code} ${partner.name}`.toLowerCase(),
          debt: partner.currentDebt
        })),
    [partnersQuery.data?.items]
  );

  const selectedPartnerRows = useMemo(
    () =>
      selectedPartners
        .filter((partner) => partner.currentDebt > 0)
        .filter((partner) =>
          `${partner.code} ${partner.name}`.toLowerCase().includes(partnerKeyword.trim().toLowerCase())
        )
        .sort((left, right) => right.currentDebt - left.currentDebt),
    [partnerKeyword, selectedPartners]
  );

  const filteredCollections = useMemo(
    () =>
      (collectionsQuery.data?.items ?? []).filter((item) =>
        `${item.name} ${item.description ?? ""}`.toLowerCase().includes(collectionKeyword.trim().toLowerCase())
      ),
    [collectionKeyword, collectionsQuery.data?.items]
  );

  const collectionColumns: ColumnsType<DebtCollectionItem> = [
    {
      title: "Tên đợt thu nợ",
      dataIndex: "name",
      key: "name",
      width: 220,
      render: (value: string, record) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          {record.description ? <div className="sales-debt-subtext">{record.description}</div> : null}
        </div>
      )
    },
    {
      title: "Thời gian",
      key: "dateRange",
      width: 180,
      render: (_value, record) => (
        <Typography.Text>
          {dayjs(record.startDate).format("DD/MM/YYYY")}
          {record.endDate ? ` - ${dayjs(record.endDate).format("DD/MM/YYYY")}` : ""}
        </Typography.Text>
      )
    },
    {
      title: "Trạng thái",
      dataIndex: "status",
      key: "status",
      width: 130,
      align: "center",
      render: (value: DebtCollectionStatus) => <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag>
    },
    { title: "Khách hàng", dataIndex: "customerCount", key: "customerCount", width: 100, align: "center" },
    {
      title: "Nợ dự kiến",
      dataIndex: "expectedAmount",
      key: "expectedAmount",
      width: 170,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "Đã thu",
      dataIndex: "actualAmount",
      key: "actualAmount",
      width: 170,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    },
    {
      title: "Ngày tạo",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 130,
      align: "center",
      render: (value: string) => dayjs(value).format("DD/MM/YYYY")
    },
    {
      title: "Chức năng",
      key: "actions",
      width: 120,
      align: "center",
      render: (_value, record) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => {
            setSelectedCollection(record);
            setResultOpen(true);
          }}
        >
          Xem
        </Button>
      )
    }
  ];

  const partnerColumns: ColumnsType<PartnerOption> = [
    { title: "Mã khách hàng", dataIndex: "code", key: "code", width: 160 },
    { title: "Tên khách hàng", dataIndex: "name", key: "name" },
    {
      title: "Điện thoại",
      dataIndex: "phone",
      key: "phone",
      width: 140,
      render: (value: string | null | undefined) => value || "-"
    },
    {
      title: "Công nợ hiện tại",
      dataIndex: "currentDebt",
      key: "currentDebt",
      width: 170,
      align: "right",
      render: (value: number) => <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
    }
  ];

  const resultColumns: ColumnsType<ResultDraftRow> = [
    { title: "Khách hàng", dataIndex: "partnerName", key: "partnerName" },
    {
      title: "Nợ dự kiến",
      dataIndex: "expectedAmount",
      key: "expectedAmount",
      width: 170,
      align: "right",
      render: (value: number) => formatCurrency(value)
    },
    {
      title: "Thực tế đã thu",
      dataIndex: "actualAmount",
      key: "actualAmount",
      width: 170,
      align: "right",
      render: (value: number, record) => (
        <InputNumber
          min={0}
          value={value}
          style={{ width: "100%" }}
          formatter={(next) => {
            if (next === undefined || next === null) {
              return "";
            }
            return formatNumber(Number(String(next).replace(/\./g, "").replace(/,/g, ".")));
          }}
          parser={(next) => Number(String(next ?? "").replace(/\./g, "").replace(/,/g, "."))}
          onChange={(next) =>
            setResultDrafts((prev) =>
              prev.map((item) => (item.detailId === record.detailId ? { ...item, actualAmount: Number(next ?? 0) } : item))
            )
          }
        />
      )
    },
    {
      title: "Ghi chú",
      dataIndex: "note",
      key: "note",
      width: 260,
      render: (value: string, record) => (
        <Input
          value={value}
          onChange={(event) =>
            setResultDrafts((prev) =>
              prev.map((item) => (item.detailId === record.detailId ? { ...item, note: event.target.value } : item))
            )
          }
        />
      )
    }
  ];

  const pieConfig = useMemo(
    () => ({
      data: [
        { type: "Đã thu", value: summary?.collectedAmount ?? 0 },
        { type: "Còn phải thu", value: summary?.outstandingAmount ?? 0 }
      ],
      height: 220,
      angleField: "value",
      colorField: "type",
      radius: 0.9,
      innerRadius: 0.68,
      appendPadding: 0,
      legend: false,
      label: false,
      color: ({ type }: { type: string }) => (type === "Đã thu" ? "#13c2c2" : "#fa8c16")
    }),
    [summary?.collectedAmount, summary?.outstandingAmount]
  );

  const renderRangeEditor = (title: string, rows: RangeRow[], keyName: "preDueRanges" | "overdueRanges") => (
    <div className="sales-debt-settings-block">
      <Typography.Text strong>{title}</Typography.Text>
      <div className="sales-debt-settings-table">
        <div className="sales-debt-settings-head">
          <span>Từ</span>
          <span>Đến</span>
          <span />
        </div>
        {rows.map((row) => (
          <div className="sales-debt-settings-row" key={row.id}>
            <InputNumber
              min={0}
              value={row.from}
              style={{ width: "100%" }}
              onChange={(value) =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  [keyName]: prev[keyName].map((item) => (item.id === row.id ? { ...item, from: Number(value ?? 0) } : item))
                }))
              }
            />
            <InputNumber
              min={0}
              value={row.to ?? undefined}
              placeholder="∞"
              style={{ width: "100%" }}
              onChange={(value) =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  [keyName]: prev[keyName].map((item) =>
                    item.id === row.id ? { ...item, to: value === null ? null : Number(value) } : item
                  )
                }))
              }
            />
            <Button
              type="text"
              icon={<DeleteOutlined />}
              onClick={() =>
                setSettingsDraft((prev) => ({
                  ...prev,
                  [keyName]: prev[keyName].length > 1 ? prev[keyName].filter((item) => item.id !== row.id) : prev[keyName]
                }))
              }
            />
          </div>
        ))}
        <Button
          onClick={() =>
            setSettingsDraft((prev) => ({
              ...prev,
              [keyName]: [...prev[keyName], createRangeRow(keyName === "preDueRanges" ? "pre" : "over")]
            }))
          }
        >
          Thêm dòng
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <div className="sales-debt-shell">
        <div className="sales-debt-subtabs">
          <button type="button" className={`sales-debt-subtab ${subTab === "SUMMARY" ? "sales-debt-subtab-active" : ""}`} onClick={() => setSubTab("SUMMARY")}>
            Tổng hợp
          </button>
          <button type="button" className={`sales-debt-subtab ${subTab === "COLLECTIONS" ? "sales-debt-subtab-active" : ""}`} onClick={() => setSubTab("COLLECTIONS")}>
            Đợt thu nợ
          </button>
        </div>

        {subTab === "SUMMARY" ? (
          <div className="sales-debt-summary-page">
            <div className="sales-debt-top-grid">
              <Card className="sales-debt-card sales-debt-card-total">
                <div className="sales-debt-card-header">
                  <Typography.Text strong>Tổng công nợ</Typography.Text>
                  <Space>
                    <Button type="text" icon={<ReloadOutlined />} onClick={() => void summaryQuery.refetch()} />
                    <Button type="text" icon={<SettingOutlined />} onClick={() => { setSettingsDraft(settings); setSettingsOpen(true); }} />
                  </Space>
                </div>
                <div className="sales-debt-total-value">{formatCurrency(summary?.totalDebt ?? 0)}</div>
                <div className="sales-debt-stacked-bar">
                  {segments.filter((segment) => segment.amount > 0).map((segment) => (
                    <span key={segment.key} className="sales-debt-stacked-segment" style={{ width: buildSegmentWidth(segment.amount, summary?.totalDebt ?? 0), background: segment.color }} title={`${segment.label}: ${formatCurrency(segment.amount)}`} />
                  ))}
                </div>
                <div className="sales-debt-segment-list">
                  {segments.filter((segment) => segment.amount > 0).map((segment) => (
                    <div className="sales-debt-segment-item" key={segment.key}>
                      <span className="sales-debt-segment-label"><i className="sales-debt-segment-dot" style={{ background: segment.color }} />{segment.label}</span>
                      <span className="sales-debt-segment-amount">{formatCurrency(segment.amount)}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="sales-debt-card sales-debt-card-recovery">
                <div className="sales-debt-card-header">
                  <Typography.Text strong>Tỷ lệ thu hồi nợ</Typography.Text>
                  <Button type="text" icon={<ReloadOutlined />} onClick={() => void summaryQuery.refetch()} />
                </div>
                <div className="sales-debt-recovery-layout">
                  <div className="sales-debt-recovery-chart">
                    <Pie {...pieConfig} />
                    <div className="sales-debt-recovery-percent">{`${recoveryPercent}%`}</div>
                  </div>
                  <div className="sales-debt-recovery-metrics">
                    <div className="sales-debt-metric-row"><span>Tổng công nợ</span><strong>{formatCurrency(summary?.totalDebt ?? 0)}</strong></div>
                    <div className="sales-debt-metric-row sales-debt-metric-row-green"><span>Đã thu</span><strong>{formatCurrency(summary?.collectedAmount ?? 0)}</strong></div>
                    <div className="sales-debt-metric-row sales-debt-metric-row-orange"><span>Còn phải thu</span><strong>{formatCurrency(summary?.outstandingAmount ?? 0)}</strong></div>
                  </div>
                </div>
              </Card>

              <Card className="sales-debt-card sales-debt-card-average">
                <div className="sales-debt-card-header">
                  <Typography.Text strong>Số ngày thu nợ bình quân</Typography.Text>
                  <Button type="text" icon={<ReloadOutlined />} onClick={() => void summaryQuery.refetch()} />
                </div>
                <div className="sales-debt-average-value">{Math.round(summary?.averageCollectionDays ?? 0)}</div>
                <div className="sales-debt-average-unit">NGÀY</div>
              </Card>
            </div>

            <div className="sales-debt-bottom-grid">
              <Card className="sales-debt-card">
                <div className="sales-debt-card-header">
                  <Typography.Text strong>Khách hàng có công nợ lớn</Typography.Text>
                  <Button type="text" icon={<ReloadOutlined />} onClick={() => void summaryQuery.refetch()} />
                </div>
                <div className="sales-debt-card-total-inline"><strong>{formatCurrency(topDebtorsTotal)}</strong><span>Tổng</span></div>
                <Table rowKey="partnerId" size="small" pagination={false} columns={[
                  { title: "Mã KH", dataIndex: "partnerCode", key: "partnerCode", width: 100 },
                  { title: "Khách hàng", dataIndex: "partnerName", key: "partnerName" },
                  { title: "Số tiền", dataIndex: "amount", key: "amount", width: 170, align: "right", render: (value: number) => formatCurrency(value) }
                ]} dataSource={topDebtors} />
              </Card>

              <Card className="sales-debt-card">
                <div className="sales-debt-card-header">
                  <Typography.Text strong>{`Nợ phải thu sắp đến hạn trong ${UPCOMING_WINDOW_DAYS} ngày`}</Typography.Text>
                  <Space>
                    <Button type="text" icon={<ReloadOutlined />} onClick={() => void summaryQuery.refetch()} />
                    <Button type="text" icon={<SettingOutlined />} onClick={() => { setSettingsDraft(settings); setSettingsOpen(true); }} />
                  </Space>
                </div>
                <div className="sales-debt-card-total-inline"><strong>{formatCurrency(upcomingTotal)}</strong><span>Tổng</span></div>
                <Table rowKey="id" size="small" pagination={false} columns={[
                  { title: "Số chứng từ", dataIndex: "voucherNo", key: "voucherNo", width: 120 },
                  { title: "Hạn thanh toán", dataIndex: "dueDate", key: "dueDate", width: 130, render: (value: string | null) => (value ? dayjs(value).format("DD/MM/YYYY") : "-") },
                  { title: "Khách hàng", dataIndex: "partnerName", key: "partnerName" },
                  { title: "Số tiền", dataIndex: "remainingAmount", key: "remainingAmount", width: 160, align: "right", render: (value: number) => formatCurrency(value) }
                ]} dataSource={upcomingInvoices} />
              </Card>
            </div>
          </div>
        ) : (
          <div className="sales-debt-collections-page">
            <div className="sales-debt-table-panel">
              <div className="sales-debt-table-header">
                <Space>
                  <Input.Search allowClear placeholder="Tìm theo tên đợt thu nợ" style={{ width: 320 }} value={collectionKeyword} onChange={(event) => setCollectionKeyword(event.target.value)} />
                  <Typography.Text type="secondary">Danh sách đợt thu nợ và kết quả cập nhật</Typography.Text>
                </Space>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>Thêm đợt thu nợ</Button>
              </div>
              <Table<DebtCollectionItem> rowKey="id" bordered size="small" className="sales-master-table sales-debt-collection-table" loading={collectionsQuery.isFetching} columns={collectionColumns} dataSource={filteredCollections} pagination={false} scroll={{ y: 420 }} />
            </div>
          </div>
        )}
      </div>

      <Modal open={settingsOpen} onCancel={() => setSettingsOpen(false)} width={920} title="Tùy chọn" footer={<Space><Button onClick={() => setSettingsOpen(false)}>Hủy</Button><Button type="primary" onClick={() => { setSettings(settingsDraft); saveSettings(settingsDraft); setSettingsOpen(false); }}>Đồng ý</Button></Space>}>
        <div className="sales-debt-settings-layout">
          {renderRangeEditor("Mốc trước hạn (ngày)", settingsDraft.preDueRanges, "preDueRanges")}
          {renderRangeEditor("Mốc quá hạn (ngày)", settingsDraft.overdueRanges, "overdueRanges")}
          <div className="sales-debt-settings-side">
            <Typography.Text strong>Hiển thị khoảng nợ chi tiết</Typography.Text>
            <Radio.Group value={settingsDraft.detailMode} onChange={(event) => setSettingsDraft((prev) => ({ ...prev, detailMode: event.target.value as DetailMode }))}>
              <Space direction="vertical" style={{ marginTop: 12 }}>
                <Radio value="PRE_DUE">Công nợ trước hạn</Radio>
                <Radio value="OVERDUE">Công nợ quá hạn</Radio>
              </Space>
            </Radio.Group>
          </div>
        </div>
      </Modal>

      <Modal open={createOpen} onCancel={() => setCreateOpen(false)} width="100vw" style={{ top: 0, paddingBottom: 0 }} rootClassName="sales-debt-fullscreen-modal" title="Đợt thu nợ" footer={<div className="sales-voucher-sticky-footer sales-voucher-sticky-footer-dark"><Button className="sales-voucher-footer-button sales-voucher-footer-button-secondary" onClick={() => setCreateOpen(false)}>Hủy</Button><Button className="sales-voucher-footer-button sales-voucher-footer-button-primary" loading={createMutation.isPending} onClick={() => { void createForm.submit(); }}>Cất</Button></div>}>
        <div className="sales-debt-create-screen">
          <Form<CreateCollectionFormValues> form={createForm} layout="vertical" onFinish={async (values) => {
            if (selectedPartnerIds.length === 0) {
              message.warning("Vui lòng chọn ít nhất một khách hàng.");
              return;
            }
            await createMutation.mutateAsync({ name: values.name, description: values.description, startDate: values.startDate.toISOString(), endDate: values.endDate?.toISOString(), targetPercent: values.targetPercent, targetAmount: values.targetAmount, partnerIds: selectedPartnerIds.map(String) });
          }}>
            <div className="sales-debt-create-header">
              <Form.Item label="Tên đợt thu nợ" name="name" rules={[{ required: true, message: "Bắt buộc nhập tên đợt" }]}><Input placeholder="Ví dụ: Thu nợ đầu tháng 4" /></Form.Item>
              <Form.Item label="Từ ngày" name="startDate" rules={[{ required: true, message: "Bắt buộc" }]}><DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} /></Form.Item>
              <Form.Item label="Đến ngày" name="endDate"><DatePicker format="DD/MM/YYYY" style={{ width: "100%" }} /></Form.Item>
              <Form.Item label="Tổng công nợ" name="totalDebtAmount"><InputNumber disabled controls={false} style={{ width: "100%" }} formatter={(value) => formatCurrency(Number(value ?? 0))} /></Form.Item>
              <Form.Item label="Mục tiêu thu nợ" name="targetPercent"><InputNumber min={0} max={100} addonAfter="%" style={{ width: "100%" }} onChange={(value) => { setTargetInputMode("PERCENT"); createForm.setFieldsValue({ targetPercent: Number(value ?? 0), targetAmount: buildTargetAmount(totalDebtAmount, Number(value ?? 0)) }); }} /></Form.Item>
              <Form.Item label=" " name="targetAmount"><InputNumber min={0} controls={false} style={{ width: "100%" }} formatter={(value) => String(Number(value ?? 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} parser={(value) => Number(String(value ?? "").replace(/\./g, "")) as 0} onChange={(value) => { const nextAmount = Number(value ?? 0); setTargetInputMode("AMOUNT"); createForm.setFieldsValue({ targetAmount: nextAmount, targetPercent: buildTargetPercent(totalDebtAmount, nextAmount) }); }} /></Form.Item>
            </div>
            <Form.Item label="Mô tả" name="description"><Input placeholder="Ghi chú cho đợt thu nợ" /></Form.Item>
          </Form>
          <div className="sales-debt-create-table-wrap">
            <div className="sales-debt-create-toolbar">
              <Space wrap size={10}>
                <AppSelect
                  allowClear
                  showSearch
                  placeholder="Chọn khách hàng theo mã hoặc tên"
                  style={{ width: 500 }}
                  value={selectedLookupPartnerId}
                  options={partnerLookupOptions}
                  filterOption={(input, option) =>
                    ((option as PartnerLookupOption | undefined)?.searchText ?? "").includes(input.toLowerCase())
                  }
                  onChange={(value) => {
                    const partnerId = value as string | undefined;
                    setSelectedLookupPartnerId(partnerId);
                    if (!partnerId) {
                      return;
                    }
                    setSelectedPartnerIds((prev) => (prev.includes(partnerId) ? prev : [...prev, partnerId]));
                  }}
                />
                <Input.Search
                  allowClear
                  placeholder="Lọc nhanh trong bảng khách hàng"
                  style={{ width: 300 }}
                  value={partnerKeyword}
                  onChange={(event) => setPartnerKeyword(event.target.value)}
                />
              </Space>
              <Typography.Text strong>{`Đã chọn ${selectedPartnerIds.length} khách hàng`}</Typography.Text>
            </div>
            <Table<PartnerOption> rowKey="id" bordered size="small" pagination={false} loading={partnersQuery.isFetching} rowSelection={{ selectedRowKeys: selectedPartnerIds, onChange: (nextKeys) => setSelectedPartnerIds(nextKeys) }} columns={partnerColumns} dataSource={selectedPartnerRows} scroll={{ y: 420 }} />
          </div>
        </div>
      </Modal>

      <Modal open={resultOpen} onCancel={() => { setResultOpen(false); setSelectedCollection(null); }} width={980} title={selectedCollection ? `Đợt thu nợ: ${selectedCollection.name}` : "Đợt thu nợ"} footer={<Space><Button icon={<DownloadOutlined />} onClick={() => { if (selectedCollection) { downloadCollectionDetailsExcel(selectedCollection); } }}>Xuất khẩu Excel</Button><Button onClick={() => { setResultOpen(false); setSelectedCollection(null); }}>Hủy</Button><Button type="primary" loading={updateResultMutation.isPending} onClick={() => { if (!selectedCollection) { return; } void updateResultMutation.mutateAsync({ id: selectedCollection.id, details: resultDrafts }); }}>Cất</Button></Space>}>
        <div className="sales-debt-result-meta"><Typography.Text type="secondary">Chi tiết đợt thu nợ. Bạn có thể xem danh sách khách hàng, cập nhật số tiền đã thu và xuất danh sách ra Excel.</Typography.Text></div>
        <Table<ResultDraftRow> rowKey="detailId" bordered size="small" pagination={false} columns={resultColumns} dataSource={resultDrafts} scroll={{ y: 360 }} />
      </Modal>
    </>
  );
}
