import {
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfigProvider, Input, Popconfirm, Space, Table, Typography, notification } from "antd";
import type { ColumnsType } from "antd/es/table";
import debounce from "lodash.debounce";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
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
import type { PartnerGroupValue } from "../../types";
import type { PartnerOption } from "../../types/voucher";

const moneyFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

function formatDebt(value: number): string {
  return moneyFormatter.format(value);
}

function resolveGroup(search: string): PartnerGroupValue {
  const query = new URLSearchParams(search);
  return query.get("group") === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER";
}

export function PartnerManagementPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const activeGroup = resolveGroup(location.search);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [selectedPartnerRowKeys, setSelectedPartnerRowKeys] = useState<string[]>([]);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerOption | null>(null);
  const [openImportModal, setOpenImportModal] = useState(false);

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
    setSelectedPartnerRowKeys([]);
    setActiveRowId(null);
  }, [activeGroup]);

  const partnersQuery = useQuery({
    queryKey: ["partners", activeGroup, page, pageSize, keyword],
    queryFn: () =>
      fetchPartners({
        page,
        pageSize,
        keyword,
        group: activeGroup
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
    {
      title: "Công nợ",
      dataIndex: "currentDebt",
      key: "currentDebt",
      align: "right",
      width: 150,
      render: (value: number) => <span style={{ color: value > 0 ? "#cf1322" : "#237804", fontWeight: 500 }}>{formatDebt(value)}</span>
    },
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
  const pageTitle = activeGroup === "SUPPLIER" ? "Danh sách nhà cung cấp" : "Danh sách khách hàng";
  const addButtonLabel = activeGroup === "SUPPLIER" ? "Thêm nhà cung cấp" : "Thêm khách hàng";

  return (
    <ConfigProvider
      theme={{
        token: {
          fontSize: 14
        }
      }}
    >
      <div className="partner-page">
        <Typography.Title level={2} className="partner-page-title">
          {pageTitle}
        </Typography.Title>
        <Typography.Text className="partner-page-backlink">Tất cả danh mục</Typography.Text>

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
            <Button>
              Lọc <DownOutlined />
            </Button>
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
      </div>
    </ConfigProvider>
  );
}
