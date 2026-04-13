import {
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfigProvider, Dropdown, Input, Popconfirm, Space, Table, Typography, notification } from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import debounce from "lodash.debounce";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import * as XLSX from "xlsx-js-style";
import { ImportWizardModal } from "../../components/ImportWizardModal";
import { PartnerModal, type PartnerFormValues } from "../../components/PartnerModal";
import {
  commitPartnerImport,
  createPartner,
  deletePartner,
  fetchPartners,
  type PartnerImportMappedData,
  updatePartner,
  validatePartnerImport
} from "../../services/masterData.api";
import { commitImportData, validateImportData } from "../../services/import.api";
import type { PartnerGroupValue } from "../../types";
import type { PartnerOption } from "../../types/voucher";

const moneyFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

function formatDebt(value: number): string {
  return moneyFormatter.format(value);
}

function getSupplierPayable(currentDebt: number): number {
  return Math.max(currentDebt, 0);
}

function getSupplierResidualDebt(currentDebt: number): number {
  return Math.abs(Math.min(currentDebt, 0));
}

function resolveGroup(search: string): PartnerGroupValue {
  const query = new URLSearchParams(search);
  return query.get("group") === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
}

interface SupplierDebtImportMappedData extends Record<string, string | number | boolean | null> {
  code: string;
  name: string;
  address: string;
  debtAmount: number;
  taxCode: string;
  phone: string;
}

export function PartnerManagementPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const activeGroup = resolveGroup(location.search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [debtStatus, setDebtStatus] = useState<"HAS_DEBT" | "NO_DEBT" | "ALL">("ALL");
  const [selectedPartnerRowKeys, setSelectedPartnerRowKeys] = useState<string[]>([]);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerOption | null>(null);
  const [openImportModal, setOpenImportModal] = useState(false);
  const [openSupplierDebtImportModal, setOpenSupplierDebtImportModal] = useState(false);

  const debouncedSearch = useMemo(
    () =>
      debounce((value: string) => {
        setPage(1);
        setKeyword(value);
      }, 300),
    []
  );

  useEffect(() => {
    setPage(1);
    setKeyword("");
    setKeywordInput("");
    setDebtStatus("ALL");
    setSelectedPartnerRowKeys([]);
    setActiveRowId(null);
  }, [activeGroup]);

  const partnersQuery = useQuery({
    queryKey: ["partners", activeGroup, page, pageSize, keyword, debtStatus],
    queryFn: () =>
      fetchPartners({
        page,
        pageSize,
        keyword,
        group: activeGroup,
        debtStatus: debtStatus === "ALL" ? undefined : debtStatus
      })
  });

  useEffect(() => {
    const validIds = new Set((partnersQuery.data?.items ?? []).map((item) => item.id));
    setSelectedPartnerRowKeys((prev) => prev.filter((id) => validIds.has(id)));
  }, [partnersQuery.data?.items]);

  const createPartnerMutation = useMutation({
    mutationFn: createPartner,
    onSuccess: async () => {
      setOpenModal(false);
      setEditingPartner(null);
      await queryClient.invalidateQueries({ queryKey: ["partners"] });
      notification.success({
        message: activeGroup === "SUPPLIER" ? "Thêm nhà cung cấp thành công" : "Thêm khách hàng thành công"
      });
    }
  });

  const updatePartnerMutation = useMutation({
    mutationFn: async (input: { id: string; payload: Partial<PartnerFormValues> }) => updatePartner(input.id, input.payload),
    onSuccess: async () => {
      setOpenModal(false);
      setEditingPartner(null);
      await queryClient.invalidateQueries({ queryKey: ["partners"] });
      notification.success({
        message: "Cập nhật đối tác thành công"
      });
    }
  });

  const deletePartnerMutation = useMutation({
    mutationFn: deletePartner,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["partners"] });
      notification.success({
        message: "Xóa đối tác thành công"
      });
    }
  });

  const summary = useMemo(() => {
    const items = partnersQuery.data?.items ?? [];
    const totalDebt = items.reduce((sum, item) => sum + Math.max(item.currentDebt, 0), 0);
    const settledCount = items.filter((item) => item.currentDebt <= 0).length;

    return {
      overdue: 0,
      totalDebt,
      settledCount
    };
  }, [partnersQuery.data?.items]);

  const columns: ColumnsType<PartnerOption> = [
    {
      title: activeGroup === "SUPPLIER" ? "Mã nhà cung cấp" : "Mã khách hàng",
      dataIndex: "code",
      key: "code",
      width: 170
    },
    {
      title: activeGroup === "SUPPLIER" ? "Tên nhà cung cấp" : "Tên khách hàng",
      dataIndex: "name",
      key: "name",
      width: 280,
      render: (value: string) => <span style={{ fontWeight: 500 }}>{value}</span>
    },
    {
      title: "Địa chỉ",
      dataIndex: "address",
      key: "address",
      ellipsis: true,
      render: (value?: string | null) => value || "-"
    },
    ...(activeGroup === "SUPPLIER"
      ? [
          {
            title: "Nợ nhà cung cấp",
            key: "supplierPayable",
            align: "right" as const,
            width: 180,
            render: (_value: unknown, record: PartnerOption) => {
              const payable = getSupplierPayable(record.currentDebt);
              return <span style={{ color: payable > 0 ? "#cf1322" : "#8c8c8c", fontWeight: 500 }}>{formatDebt(payable)}</span>;
            }
          },
          {
            title: "Dự nợ còn lại",
            key: "supplierResidual",
            align: "right" as const,
            width: 170,
            render: (_value: unknown, record: PartnerOption) => {
              const residual = getSupplierResidualDebt(record.currentDebt);
              return <span style={{ color: residual > 0 ? "#d46b08" : "#8c8c8c", fontWeight: 500 }}>{formatDebt(residual)}</span>;
            }
          }
        ]
      : [
          {
            title: "Công nợ",
            dataIndex: "currentDebt",
            key: "currentDebt",
            align: "right" as const,
            width: 150,
            render: (value: number) => (
              <span style={{ color: value > 0 ? "#cf1322" : "#237804", fontWeight: 500 }}>{formatDebt(value)}</span>
            )
          }
        ]),
    {
      title: "Mã số thuế",
      dataIndex: "taxCode",
      key: "taxCode",
      width: 140,
      render: (value?: string | null) => value || "-"
    },
    {
      title: "Chức năng",
      key: "actions",
      align: "center",
      width: 160,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            onClick={() => {
              setEditingPartner(record);
              setOpenModal(true);
            }}
          >
            Sửa
          </Button>
          <Popconfirm
            title="Xóa đối tác"
            description="Bạn có chắc muốn xóa đối tác này?"
            okText="Xóa"
            cancelText="Hủy"
            onConfirm={() => void deletePartnerMutation.mutateAsync(record.id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} loading={deletePartnerMutation.isPending} />
          </Popconfirm>
        </Space>
      )
    }
  ];

  const modalLoading = createPartnerMutation.isPending || updatePartnerMutation.isPending;
  const addButtonLabel = activeGroup === "SUPPLIER" ? "Thêm nhà cung cấp" : "Thêm khách hàng";

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

  const fetchAllPartnersForExport = async (): Promise<PartnerOption[]> => {
    const pageSizeForExport = 200;
    let currentPage = 1;
    let total = 0;
    const allItems: PartnerOption[] = [];

    do {
      const response = await fetchPartners({
        page: currentPage,
        pageSize: pageSizeForExport,
        keyword,
        group: activeGroup
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

  const handleExportPartnersExcel = async (): Promise<void> => {
    try {
      const rows = await fetchAllPartnersForExport();
      if (!rows.length) {
        notification.warning({
          message: "Không có dữ liệu để xuất Excel"
        });
        return;
      }

      const title = activeGroup === "SUPPLIER" ? "DANH SÁCH NHÀ CUNG CẤP" : "DANH SÁCH KHÁCH HÀNG";
      const nowLabel = new Date().toLocaleString("vi-VN");
      const sheetData: Array<Array<string | number>> = [
        [title],
        [`Ngày xuất: ${nowLabel}`],
        [],
        ["STT", activeGroup === "SUPPLIER" ? "Mã nhà cung cấp" : "Mã khách hàng", "Tên đối tượng", "Điện thoại", "Mã số thuế", "Địa chỉ", "Công nợ hiện tại"],
        ...rows.map((item, index) => [
          index + 1,
          item.code,
          item.name,
          item.phone ?? "",
          item.taxCode ?? "",
          item.address ?? "",
          item.currentDebt
        ])
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
      worksheet["!merges"] = [XLSX.utils.decode_range("A1:G1"), XLSX.utils.decode_range("A2:G2")];
      worksheet["!cols"] = [
        { wch: 8 },
        { wch: 20 },
        { wch: 34 },
        { wch: 16 },
        { wch: 18 },
        { wch: 40 },
        { wch: 18 }
      ];

      const headerRowIndex = 4;
      for (let col = 0; col < 7; col += 1) {
        const ref = XLSX.utils.encode_cell({ r: headerRowIndex - 1, c: col });
        const cell = worksheet[ref] as (XLSX.CellObject & { s?: Record<string, unknown> }) | undefined;
        if (!cell) {
          continue;
        }
        cell.s = {
          font: { bold: true },
          alignment: { horizontal: "center", vertical: "center" },
          fill: { patternType: "solid", fgColor: { rgb: "D9E1F2" } },
          border: {
            top: { style: "thin", color: { rgb: "BFBFBF" } },
            right: { style: "thin", color: { rgb: "BFBFBF" } },
            bottom: { style: "thin", color: { rgb: "BFBFBF" } },
            left: { style: "thin", color: { rgb: "BFBFBF" } }
          }
        };
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, activeGroup === "SUPPLIER" ? "NhaCungCap" : "KhachHang");
      const filePrefix = activeGroup === "SUPPLIER" ? "Danh_sach_nha_cung_cap" : "Danh_sach_khach_hang";
      const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      downloadWorkbook(workbook, `${filePrefix}_${stamp}.xlsx`);
      notification.success({ message: "Đã xuất Excel danh sách đối tác" });
    } catch (error) {
      notification.error({
        message: "Xuất Excel thất bại",
        description: (error as Error).message
      });
    }
  };

  const handleExportSupplierDebtExcel = async (mode: "ALL" | "PAYABLE_ONLY"): Promise<void> => {
    try {
      const rows = await fetchAllPartnersForExport();
      const exportRows = mode === "PAYABLE_ONLY" ? rows.filter((item) => getSupplierPayable(item.currentDebt) > 0) : rows;
      if (!exportRows.length) {
        notification.warning({
          message: mode === "PAYABLE_ONLY" ? "Không có nhà cung cấp đang nợ để xuất Excel" : "Không có dữ liệu để xuất Excel"
        });
        return;
      }

      const sheetData: Array<Array<string | number>> = [
        ["Danh sách nhà cung cấp"],
        [],
        [
          "STT",
          "Mã nhà cung cấp",
          "Tên nhà cung cấp",
          "Địa chỉ",
          "Số tiền nợ",
          "Mã số thuế/CCCD chủ hộ",
          "Rủi ro về hóa đơn",
          "Văn bản tham chiếu",
          "Điện thoại",
          "Là Đối tượng nội bộ",
          "Là Tổng công ty/chi nhánh"
        ],
        ...exportRows.map((item, index) => [
          index + 1,
          item.code,
          item.name,
          item.address ?? "",
          getSupplierPayable(item.currentDebt),
          item.taxCode ?? "",
          "",
          "",
          item.phone ?? "",
          "",
          ""
        ])
      ];

      const totalDebt = exportRows.reduce((sum, item) => sum + getSupplierPayable(item.currentDebt), 0);
      sheetData.push(["", "Tổng", "", "", totalDebt, "", "", "", "", "", ""]);

      const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
      worksheet["!merges"] = [XLSX.utils.decode_range("A1:K1")];
      worksheet["!cols"] = [
        { wch: 8 },
        { wch: 24 },
        { wch: 34 },
        { wch: 28 },
        { wch: 16 },
        { wch: 24 },
        { wch: 18 },
        { wch: 20 },
        { wch: 16 },
        { wch: 18 },
        { wch: 24 }
      ];

      const titleCell = worksheet.A1 as (XLSX.CellObject & { s?: Record<string, unknown> }) | undefined;
      if (titleCell) {
        titleCell.s = {
          font: { bold: true, sz: 14 },
          alignment: { horizontal: "left", vertical: "center" }
        };
      }

      const headerRowIndex = 3;
      for (let col = 0; col < 11; col += 1) {
        const ref = XLSX.utils.encode_cell({ r: headerRowIndex - 1, c: col });
        const cell = worksheet[ref] as (XLSX.CellObject & { s?: Record<string, unknown> }) | undefined;
        if (!cell) {
          continue;
        }
        cell.s = {
          font: { bold: true },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          fill: { patternType: "solid", fgColor: { rgb: "D9D9D9" } },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } }
          }
        };
      }

      const firstDataRow = 4;
      const totalRow = firstDataRow + exportRows.length;
      for (let row = firstDataRow; row <= totalRow; row += 1) {
        for (let col = 0; col < 11; col += 1) {
          const ref = XLSX.utils.encode_cell({ r: row - 1, c: col });
          const cell = worksheet[ref] as (XLSX.CellObject & { s?: Record<string, unknown>; z?: string }) | undefined;
          if (!cell) {
            continue;
          }

          const isTotalRow = row === totalRow;
          cell.s = {
            font: { bold: isTotalRow },
            alignment: {
              horizontal: col === 0 ? "center" : col === 4 ? "right" : "left",
              vertical: "center"
            },
            border: {
              top: { style: "thin", color: { rgb: "000000" } },
              right: { style: "thin", color: { rgb: "000000" } },
              bottom: { style: "thin", color: { rgb: "000000" } },
              left: { style: "thin", color: { rgb: "000000" } }
            }
          };
          if (col === 4) {
            cell.z = "#,##0_);[Red](#,##0)";
          }
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, mode === "PAYABLE_ONLY" ? "NCC_Dang_No" : "NCC_Tat_Ca");
      const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
      const suffix = mode === "PAYABLE_ONLY" ? "dang_no" : "tat_ca";
      downloadWorkbook(workbook, `Danh_sach_no_nha_cung_cap_${suffix}_${stamp}.xlsx`);
      notification.success({
        message: mode === "PAYABLE_ONLY" ? "Đã xuất Excel NCC công ty đang nợ" : "Đã xuất Excel toàn bộ công nợ NCC"
      });
    } catch (error) {
      notification.error({
        message: "Xuất Excel công nợ NCC thất bại",
        description: (error as Error).message
      });
    }
  };

  const supplierExcelMenu: MenuProps = {
    items: [
      { key: "ALL", label: "Xuất tất cả NCC" },
      { key: "PAYABLE_ONLY", label: "Xuất NCC công ty đang nợ" }
    ],
    onClick: ({ key }) => {
      if (key === "PAYABLE_ONLY") {
        void handleExportSupplierDebtExcel("PAYABLE_ONLY");
        return;
      }
      void handleExportSupplierDebtExcel("ALL");
    }
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          fontSize: 14
        }
      }}
    >
      <div className="partner-page">
        <div className="partner-page-summary">
          <div className="partner-summary-card partner-summary-card-boxed partner-summary-card-accent">
            <div className="partner-summary-value">{formatDebt(summary.overdue)}</div>
            <div className="partner-summary-label">Nợ quá hạn</div>
          </div>
          <div className="partner-summary-card partner-summary-card-boxed partner-summary-card-neutral">
            <div className="partner-summary-value">{formatDebt(summary.totalDebt)}</div>
            <div className="partner-summary-label">{activeGroup === "SUPPLIER" ? "Tổng nợ phải trả" : "Tổng nợ phải thu"}</div>
          </div>
          <div className="partner-summary-card partner-summary-card-boxed partner-summary-card-success">
            <div className="partner-summary-value">{summary.settledCount}</div>
            <div className="partner-summary-label">Đã thanh toán / không nợ</div>
          </div>
        </div>

        <div className="partner-page-toolbar">
          <Space>
            <Button onClick={() => setSelectedPartnerRowKeys((partnersQuery.data?.items ?? []).map((item) => item.id))}>
              Thực hiện hàng loạt
            </Button>
            <Dropdown
              menu={{
                items: [
                  { key: "ALL", label: "Tất cả" },
                  { key: "HAS_DEBT", label: "Có nợ" },
                  { key: "NO_DEBT", label: "Hết nợ" }
                ],
                onClick: ({ key }) => {
                  setDebtStatus(key as "HAS_DEBT" | "NO_DEBT" | "ALL");
                  setPage(1);
                }
              }}
              trigger={["click"]}
            >
              <Button>
                Lọc <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
          <Space>
            <Input
              prefix={<SearchOutlined />}
              placeholder="Tìm kiếm"
              style={{ width: 240 }}
              allowClear
              value={keywordInput}
              onChange={(event) => {
                const value = event.target.value;
                setKeywordInput(value);
                debouncedSearch(value);
              }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void partnersQuery.refetch()} />
            <Button icon={<UploadOutlined />} onClick={() => setOpenImportModal(true)}>
              Nhập từ Excel
            </Button>
            {activeGroup === "SUPPLIER" ? (
              <Button icon={<UploadOutlined />} onClick={() => setOpenSupplierDebtImportModal(true)}>
                Nháº­p cÃ´ng ná»£ NCC
              </Button>
            ) : null}
            {activeGroup === "SUPPLIER" ? (
              <Dropdown menu={supplierExcelMenu} trigger={["click"]}>
                <Button>
                  Xuất Excel <DownOutlined />
                </Button>
              </Dropdown>
            ) : (
              <Button onClick={() => void handleExportPartnersExcel()}>Xuất Excel</Button>
            )}
            <Button>
              Tiện ích <DownOutlined />
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              className="partner-add-button"
              onClick={() => {
                setEditingPartner(null);
                setOpenModal(true);
              }}
            >
              {addButtonLabel}
            </Button>
          </Space>
        </div>

        <Table<PartnerOption>
          className="partner-management-table"
          size="small"
          bordered
          rowKey="id"
          loading={partnersQuery.isFetching}
          columns={columns}
          dataSource={partnersQuery.data?.items ?? []}
          rowSelection={{
            columnWidth: 44,
            selectedRowKeys: selectedPartnerRowKeys,
            onChange: (nextKeys) => setSelectedPartnerRowKeys(nextKeys as string[])
          }}
          pagination={{
            current: page,
            pageSize,
            total: partnersQuery.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [20, 50, 100],
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              setPageSize(nextPageSize);
            }
          }}
          onRow={(record) => ({
            onClick: () => setActiveRowId(record.id)
          })}
          rowClassName={(record) => (record.id === activeRowId ? "active-row" : "")}
        />

        <PartnerModal
          open={openModal}
          loading={modalLoading}
          mode={editingPartner ? "edit" : "create"}
          baseGroup={activeGroup}
          title={editingPartner ? (activeGroup === "SUPPLIER" ? "Thông tin nhà cung cấp" : "Thông tin khách hàng") : undefined}
          initialValues={
            editingPartner
              ? {
                  code: editingPartner.code,
                  name: editingPartner.name,
                  partnerType: editingPartner.partnerType,
                  phone: editingPartner.phone ?? "",
                  taxCode: editingPartner.taxCode ?? "",
                  address: editingPartner.address ?? ""
                }
              : {
                  partnerType: activeGroup
                }
          }
          onCancel={() => {
            setOpenModal(false);
            setEditingPartner(null);
          }}
          onSubmit={async (values) => {
            if (editingPartner) {
              await updatePartnerMutation.mutateAsync({
                id: editingPartner.id,
                payload: values
              });
              return;
            }

            await createPartnerMutation.mutateAsync({
              ...values,
              group: activeGroup,
              partnerType: values.partnerType || activeGroup
            });
          }}
        />

        <ImportWizardModal<PartnerImportMappedData>
          open={openImportModal}
          title={activeGroup === "SUPPLIER" ? "Nhập nhà cung cấp từ Excel" : "Nhập khách hàng từ Excel"}
          entityLabel={activeGroup === "SUPPLIER" ? "Nhà cung cấp" : "Khách hàng"}
          systemFields={[
            {
              key: "code",
              label: activeGroup === "SUPPLIER" ? "Mã nhà cung cấp" : "Mã khách hàng",
              aliases: ["ma khach hang", "ma nha cung cap", "ma doi tac", "ma"]
            },
            {
              key: "name",
              label: activeGroup === "SUPPLIER" ? "Tên nhà cung cấp" : "Tên khách hàng",
              required: true,
              aliases: ["ten khach hang", "ten nha cung cap", "ten doi tac", "ten cong ty", "ten"]
            },
            {
              key: "phone",
              label: "Điện thoại",
              aliases: ["dien thoai", "so dien thoai", "phone"]
            },
            {
              key: "taxCode",
              label: "Mã số thuế",
              aliases: ["ma so thue", "mst", "tax code"]
            },
            {
              key: "address",
              label: "Địa chỉ",
              aliases: ["dia chi", "address"]
            }
          ]}
          onCancel={() => setOpenImportModal(false)}
          onValidate={(payload) =>
            validatePartnerImport({
              ...payload,
              group: activeGroup
            })
          }
          onCommit={(payload) =>
            commitPartnerImport({
              ...payload,
              group: activeGroup
            })
          }
          onCompleted={async () => {
            await queryClient.invalidateQueries({ queryKey: ["partners"] });
          }}
        />
        <ImportWizardModal<SupplierDebtImportMappedData>
          open={openSupplierDebtImportModal}
          title="Nháº­p danh sÃ¡ch ná»£ nhÃ  cung cáº¥p tá»« Excel"
          entityLabel="CÃ´ng ná»£ nhÃ  cung cáº¥p"
          systemFields={[
            {
              key: "code",
              label: "MÃ£ nhÃ  cung cáº¥p",
              aliases: ["ma nha cung cap", "ma doi tac", "ma"]
            },
            {
              key: "name",
              label: "TÃªn nhÃ  cung cáº¥p",
              required: true,
              aliases: ["ten nha cung cap", "ten doi tac", "ten cong ty", "ten"]
            },
            {
              key: "address",
              label: "Äá»‹a chá»‰",
              aliases: ["dia chi", "address"]
            },
            {
              key: "debtAmount",
              label: "Sá»‘ tiá»n ná»£",
              required: true,
              aliases: ["so tien no", "cong no", "so no", "debt"]
            },
            {
              key: "taxCode",
              label: "MÃ£ sá»‘ thuáº¿/CCCD chá»§ há»™",
              aliases: ["ma so thue", "mst", "cccd", "tax code"]
            },
            {
              key: "phone",
              label: "Äiá»‡n thoáº¡i",
              aliases: ["dien thoai", "so dien thoai", "phone"]
            }
          ]}
          onCancel={() => setOpenSupplierDebtImportModal(false)}
          onValidate={(payload) =>
            validateImportData<SupplierDebtImportMappedData>({
              domain: "SUPPLIER_DEBT_LIST",
              jsonData: payload.jsonData,
              mappingObject: payload.mappingObject as Record<string, string>,
              importMode: payload.importMode
            })
          }
          onCommit={(payload) =>
            commitImportData<SupplierDebtImportMappedData>({
              domain: "SUPPLIER_DEBT_LIST",
              rows: payload.rows,
              importMode: payload.importMode
            })
          }
          onCompleted={async () => {
            await queryClient.invalidateQueries({ queryKey: ["partners"] });
          }}
        />
      </div>
    </ConfigProvider>
  );
}
