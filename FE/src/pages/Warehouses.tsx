import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Select, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import {
  createWarehouse,
  deleteWarehouse,
  fetchWarehouseProducts,
  fetchWarehouses,
  type WarehouseProductRow,
  type WarehouseSummary,
  updateProduct,
  updateWarehouse
} from "../services/masterData.api";
import { formatNumber } from "../utils/formatters";

function WarehouseProductsTable({
  warehouseKey,
  warehouses
}: {
  warehouseKey: string;
  warehouses: WarehouseSummary[];
}) {
  const queryClient = useQueryClient();
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [targetWarehouseId, setTargetWarehouseId] = useState<string | null>(null);
  const productsQuery = useQuery({
    queryKey: ["warehouse-products", warehouseKey],
    queryFn: () => fetchWarehouseProducts({ warehouseKey })
  });

  const moveMutation = useMutation({
    mutationFn: async (payload: { productIds: string[]; warehouseId: string }) => {
      await Promise.all(payload.productIds.map((id) => updateProduct(id, { warehouseId: payload.warehouseId })));
    },
    onSuccess: async () => {
      message.success("Đã chuyển kho.");
      setSelectedRowKeys([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["warehouses"] }),
        queryClient.invalidateQueries({ queryKey: ["warehouse-products", warehouseKey] }),
        targetWarehouseId
          ? queryClient.invalidateQueries({ queryKey: ["warehouse-products", targetWarehouseId] })
          : Promise.resolve()
      ]);
    }
  });

  const targetOptions = useMemo(
    () =>
      warehouses
        .filter((item) => item.warehouseKey !== warehouseKey && item.warehouseKey !== "DEFAULT")
        .map((item) => ({ value: item.warehouseKey, label: item.warehouseName })),
    [warehouseKey, warehouses]
  );

  const columns: ColumnsType<WarehouseProductRow> = useMemo(
    () => [
      { title: "Mã hàng", dataIndex: "skuCode", key: "skuCode", width: 160 },
      {
        title: "Tên hàng",
        dataIndex: "name",
        key: "name",
        render: (value: string) => <span style={{ fontWeight: 500 }}>{value}</span>
      },
      { title: "ĐVT", dataIndex: "unitName", key: "unitName", width: 90, align: "center" },
      {
        title: "Tồn kho",
        dataIndex: "stockQuantity",
        key: "stockQuantity",
        align: "right",
        width: 140,
        render: (value: number) => <span style={{ fontWeight: 500 }}>{formatNumber(value)}</span>
      },
      {
        title: "Giá vốn",
        dataIndex: "costPrice",
        key: "costPrice",
        align: "right",
        width: 140,
        render: (value: number) => formatNumber(value)
      }
    ],
    []
  );

  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Select
          placeholder="Chọn kho cần chuyển"
          style={{ width: 260 }}
          options={targetOptions}
          value={targetWarehouseId ?? undefined}
          onChange={(value) => setTargetWarehouseId(value)}
          disabled={targetOptions.length === 0}
        />
        <Button
          type="primary"
          disabled={selectedRowKeys.length === 0 || !targetWarehouseId}
          loading={moveMutation.isPending}
          onClick={() => {
            if (!targetWarehouseId) {
              message.warning("Vui lòng chọn kho nhận.");
              return;
            }
            void moveMutation.mutateAsync({
              productIds: selectedRowKeys.map(String),
              warehouseId: targetWarehouseId
            });
          }}
        >
          Chuyển kho
        </Button>
        {targetOptions.length === 0 ? (
          <Typography.Text type="secondary">Chưa có kho khác để chuyển.</Typography.Text>
        ) : null}
      </Space>

      <Table<WarehouseProductRow>
        rowKey="id"
        size="small"
        bordered
        loading={productsQuery.isFetching}
        columns={columns}
        dataSource={productsQuery.data ?? []}
        pagination={false}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys.map(String))
        }}
      />
    </div>
  );
}

export function WarehousesPage() {
  const queryClient = useQueryClient();
  const [warehouseForm] = Form.useForm<{ name: string }>();
  const [openWarehouseModal, setOpenWarehouseModal] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<{ id: string; name: string } | null>(null);

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => fetchWarehouses()
  });

  const createWarehouseMutation = useMutation({
    mutationFn: createWarehouse,
    onSuccess: async () => {
      message.success("Thêm kho thành công.");
      setOpenWarehouseModal(false);
      setEditingWarehouse(null);
      warehouseForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    }
  });

  const updateWarehouseMutation = useMutation({
    mutationFn: (payload: { id: string; name: string }) => updateWarehouse(payload.id, { name: payload.name }),
    onSuccess: async () => {
      message.success("Cập nhật kho thành công.");
      setOpenWarehouseModal(false);
      setEditingWarehouse(null);
      warehouseForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    }
  });

  const deleteWarehouseMutation = useMutation({
    mutationFn: (id: string) => deleteWarehouse(id),
    onSuccess: async () => {
      message.success("Đã xóa kho.");
      await queryClient.invalidateQueries({ queryKey: ["warehouses"] });
    }
  });

  const columns: ColumnsType<WarehouseSummary> = useMemo(
    () => [
      {
        title: "Kho",
        dataIndex: "warehouseName",
        key: "warehouseName",
        render: (value: string) => <Typography.Text strong>{value}</Typography.Text>
      },
      {
        title: "Số sản phẩm",
        dataIndex: "productCount",
        key: "productCount",
        align: "right",
        width: 160,
        render: (value: number) => formatNumber(value)
      },
      {
        title: "Chức năng",
        key: "actions",
        align: "center",
        width: 120,
        render: (_, record) => {
          const isDefault = record.warehouseKey === "DEFAULT";
          return (
            <Space>
              <Button
                type="text"
                icon={<EditOutlined />}
                disabled={isDefault}
                onClick={() => {
                  setEditingWarehouse({ id: record.warehouseKey, name: record.warehouseName });
                  warehouseForm.setFieldsValue({ name: record.warehouseName });
                  setOpenWarehouseModal(true);
                }}
              />
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={isDefault}
                loading={deleteWarehouseMutation.isPending && deleteWarehouseMutation.variables === record.warehouseKey}
                onClick={() => {
                  Modal.confirm({
                    title: "Xóa kho",
                    content: "Bạn có chắc chắn muốn xóa kho này? Sản phẩm sẽ về Kho ngầm định.",
                    okText: "Xóa",
                    cancelText: "Hủy",
                    onOk: () => deleteWarehouseMutation.mutateAsync(record.warehouseKey)
                  });
                }}
              />
            </Space>
          );
        }
      }
    ],
    [deleteWarehouseMutation, warehouseForm]
  );

  return (
    <div>
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Kho
        </Typography.Title>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingWarehouse(null);
              warehouseForm.resetFields();
              setOpenWarehouseModal(true);
            }}
          >
            Thêm kho
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => warehousesQuery.refetch()}>
            Tải lại
          </Button>
        </Space>
      </Space>

      <Table<WarehouseSummary>
        rowKey="warehouseKey"
        bordered
        size="small"
        loading={warehousesQuery.isFetching}
        columns={columns}
        dataSource={warehousesQuery.data ?? []}
        pagination={false}
        expandable={{
          expandedRowRender: (record) => (
            <WarehouseProductsTable warehouseKey={record.warehouseKey} warehouses={warehousesQuery.data ?? []} />
          )
        }}
      />

      <Modal
        title={editingWarehouse ? "Cập nhật kho" : "Thêm kho"}
        open={openWarehouseModal}
        onCancel={() => {
          setOpenWarehouseModal(false);
          setEditingWarehouse(null);
        }}
        onOk={() => warehouseForm.submit()}
        okText={editingWarehouse ? "Lưu" : "Thêm"}
        cancelText="Hủy"
        confirmLoading={createWarehouseMutation.isPending || updateWarehouseMutation.isPending}
      >
        <Form
          form={warehouseForm}
          layout="vertical"
          onFinish={(values) => {
            if (editingWarehouse) {
              void updateWarehouseMutation.mutateAsync({ id: editingWarehouse.id, name: values.name });
              return;
            }
            void createWarehouseMutation.mutateAsync({ name: values.name });
          }}
        >
          <Form.Item
            label="Tên kho"
            name="name"
            rules={[{ required: true, message: "Vui lòng nhập tên kho" }]}
          >
            <Input placeholder="Ví dụ: Kho tổng" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
