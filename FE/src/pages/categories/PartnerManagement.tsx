import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  ConfigProvider,
  Input,
  Popconfirm,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  notification
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import debounce from "lodash.debounce";
import { PartnerModal, type PartnerFormValues } from "../../components/PartnerModal";
import { QuickAddPartnerModal } from "../../components/QuickAddPartnerModal";
import { createPartner, deletePartner, fetchPartners, updatePartner } from "../../services/masterData.api";
import type { PartnerTypeValue } from "../../types";
import type { PartnerOption } from "../../types/voucher";

type TabType = "CUSTOMER" | "SUPPLIER";

const moneyFormatter = new Intl.NumberFormat("vi-VN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

function formatDebt(value: number): string {
  return moneyFormatter.format(value);
}

function getPartnerTypeLabel(type: PartnerTypeValue): string {
  if (type === "CUSTOMER") {
    return "Khách hàng";
  }
  if (type === "SUPPLIER") {
    return "Nhà cung cấp";
  }
  return "Khách hàng & NCC";
}

export function PartnerManagementPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>("CUSTOMER");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<PartnerOption | null>(null);

  const debouncedSearch = useMemo(
    () =>
      debounce((value: string) => {
        setPage(1);
        setKeyword(value);
      }, 300),
    []
  );

  const partnersQuery = useQuery({
    queryKey: ["partners", activeTab, page, pageSize, keyword],
    queryFn: () =>
      fetchPartners({
        page,
        pageSize,
        keyword,
        type: activeTab
      })
  });

  const createPartnerMutation = useMutation({
    mutationFn: createPartner,
    onSuccess: async () => {
      setOpenModal(false);
      setEditingPartner(null);
      await queryClient.invalidateQueries({ queryKey: ["partners"] });
      notification.success({
        message: "Thêm đối tác thành công"
      });
    }
  });

  const updatePartnerMutation = useMutation({
    mutationFn: async (input: { id: string; payload: Partial<PartnerFormValues> }) => {
      return updatePartner(input.id, input.payload);
    },
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

  const columns: ColumnsType<PartnerOption> = [
    {
      title: "Mã ĐT",
      dataIndex: "code",
      key: "code",
      width: 100
    },
    {
      title: "Tên đối tác",
      dataIndex: "name",
      key: "name",
      render: (value: string) => <span style={{ fontWeight: 500 }}>{value}</span>
    },
    {
      title: "Mã số thuế",
      dataIndex: "taxCode",
      key: "taxCode",
      width: 120,
      render: (value?: string | null) => value || "-"
    },
    {
      title: "Điện thoại",
      dataIndex: "phone",
      key: "phone",
      width: 120,
      align: "center",
      render: (value?: string | null) => value || "-"
    },
    {
      title: "Loại đối tác",
      dataIndex: "partnerType",
      key: "partnerType",
      width: 160,
      render: (value: PartnerTypeValue) => <Tag>{getPartnerTypeLabel(value)}</Tag>
    },
    {
      title: "Địa chỉ",
      dataIndex: "address",
      key: "address",
      ellipsis: true,
      render: (value?: string | null) => value || "-"
    },
    {
      title: "Công nợ hiện tại",
      dataIndex: "currentDebt",
      key: "currentDebt",
      align: "right",
      width: 150,
      render: (value: number) => (
        <span style={{ color: value > 0 ? "#cf1322" : "#237804" }}>{formatDebt(value)}</span>
      )
    },
    {
      title: "Hành động",
      key: "actions",
      align: "center",
      width: 110,
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingPartner(record);
              setOpenModal(true);
            }}
          />
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

  return (
    <ConfigProvider
      theme={{
        token: {
          fontSize: 14
        }
      }}
    >
      <div>
        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 12 }}>
          Danh mục đối tác
        </Typography.Title>

        <Tabs
          activeKey={activeTab}
          onChange={(value) => {
            setActiveTab(value as TabType);
            setPage(1);
            setActiveRowId(null);
          }}
          items={[
            { key: "CUSTOMER", label: "Khách hàng" },
            { key: "SUPPLIER", label: "Nhà cung cấp" }
          ]}
        />

        <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
          <Input.Search
            style={{ width: 360 }}
            placeholder="Tìm kiếm theo tên/SĐT/MST"
            allowClear
            value={keywordInput}
            onChange={(event) => {
              const value = event.target.value;
              setKeywordInput(value);
              debouncedSearch(value);
            }}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingPartner(null);
              setOpenModal(true);
            }}
          >
            Thêm mới
          </Button>
        </Space>

        <Table<PartnerOption>
          className="partner-management-table"
          size="small"
          bordered
          rowKey="id"
          loading={partnersQuery.isFetching}
          columns={columns}
          dataSource={partnersQuery.data?.items ?? []}
          pagination={{
            current: page,
            pageSize,
            total: partnersQuery.data?.total ?? 0,
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

        {editingPartner ? (
          <PartnerModal
            open={openModal}
            loading={modalLoading}
            mode="edit"
            title={`Cập nhật đối tác: ${editingPartner.name}`}
            initialValues={{
              name: editingPartner.name,
              partnerType: editingPartner.partnerType,
              phone: editingPartner.phone ?? "",
              taxCode: editingPartner.taxCode ?? "",
              address: editingPartner.address ?? ""
            }}
            onCancel={() => {
              setOpenModal(false);
              setEditingPartner(null);
            }}
            onSubmit={async (values) => {
              await updatePartnerMutation.mutateAsync({
                id: editingPartner.id,
                payload: values
              });
            }}
          />
        ) : (
          <QuickAddPartnerModal
            open={openModal}
            loading={modalLoading}
            title="Thêm đối tác mới"
            initialPartnerType={activeTab}
            onCancel={() => {
              setOpenModal(false);
              setEditingPartner(null);
            }}
            onSubmit={async (values) => {
              await createPartnerMutation.mutateAsync({
                ...values,
                partnerType: values.partnerType || activeTab
              });
            }}
          />
        )}
      </div>
    </ConfigProvider>
  );
}
