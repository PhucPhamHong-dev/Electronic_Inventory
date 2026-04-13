import { EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Modal, Select, Space, Table, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import debounce from "lodash.debounce";
import { useEffect, useMemo, useState } from "react";
import { ImportWizardModal } from "../components/ImportWizardModal";
import {
  commitProductImport,
  createProduct,
  fetchWarehouses,
  fetchProducts,
  type ProductImportMappedData,
  updateProduct,
  validateProductImport
} from "../services/masterData.api";
import type { ProductOption } from "../types/voucher";
import { formatNumber } from "../utils/formatters";

interface ProductFormValues {
  skuCode: string;
  name: string;
  unitName?: string;
  warehouseId?: string;
  costPrice?: number;
  sellingPrice?: number;
}

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [productForm] = Form.useForm<ProductFormValues>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [selectedProductRowKeys, setSelectedProductRowKeys] = useState<string[]>([]);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [openProductModal, setOpenProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductOption | null>(null);
  const [openImportModal, setOpenImportModal] = useState(false);

  const debouncedSearch = useMemo(
    () =>
      debounce((nextKeyword: string) => {
        setPage(1);
        setKeyword(nextKeyword);
      }, 300),
    []
  );

  const productsQuery = useQuery({
    queryKey: ["products", page, pageSize, keyword],
    queryFn: () => fetchProducts({ page, pageSize, keyword })
  });

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => fetchWarehouses()
  });

  useEffect(() => {
    const validIds = new Set((productsQuery.data?.items ?? []).map((item) => item.id));
    setSelectedProductRowKeys((prev) => prev.filter((id) => validIds.has(id)));
  }, [productsQuery.data?.items]);

  const createProductMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: async () => {
      setOpenProductModal(false);
      setEditingProduct(null);
      productForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      message.success("Thêm hàng hóa thành công.");
    }
  });

  const updateProductMutation = useMutation({
    mutationFn: (input: { id: string; payload: Partial<ProductFormValues> }) => updateProduct(input.id, input.payload),
    onSuccess: async () => {
      setOpenProductModal(false);
      setEditingProduct(null);
      productForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      message.success("Cập nhật hàng hóa thành công.");
    }
  });

  const summary = useMemo(() => {
    const items = productsQuery.data?.items ?? [];
    return {
      totalProducts: items.length,
      totalStock: items.reduce((sum, item) => sum + item.stockQuantity, 0),
      totalValue: items.reduce((sum, item) => sum + item.stockQuantity * item.costPrice, 0)
    };
  }, [productsQuery.data?.items]);

  const columns: ColumnsType<ProductOption> = [
    { title: "Mã hàng", dataIndex: "skuCode", key: "skuCode", width: 150 },
    {
      title: "Tên hàng",
      dataIndex: "name",
      key: "name",
      render: (value: string) => <span style={{ fontWeight: 500 }}>{value}</span>
    },
    {
      title: "ĐVT",
      dataIndex: "unitName",
      key: "unitName",
      align: "center",
      width: 90,
      render: (value?: string) => value || "-"
    },
    {
      title: "Kho",
      dataIndex: "warehouseName",
      key: "warehouseName",
      width: 160,
      render: (value?: string | null) => value || "-"
    },
    {
      title: "Giá vốn",
      dataIndex: "costPrice",
      key: "costPrice",
      align: "right",
      width: 140,
      render: (value: number) => formatNumber(value)
    },
    {
      title: "Giá bán",
      dataIndex: "sellingPrice",
      key: "sellingPrice",
      align: "right",
      width: 140,
      render: (value: number) => formatNumber(value)
    },
    {
      title: "Tồn kho",
      dataIndex: "stockQuantity",
      key: "stockQuantity",
      align: "right",
      width: 130,
      render: (value: number) => <span style={{ fontWeight: 500 }}>{formatNumber(value)}</span>
    },
    {
      title: "Chức năng",
      key: "action",
      align: "center",
      width: 110,
      render: (_, record) => (
        <Button
          type="text"
          icon={<EditOutlined />}
          onClick={() => {
            setEditingProduct(record);
            setOpenProductModal(true);
            productForm.setFieldsValue({
              skuCode: record.skuCode,
              name: record.name,
              unitName: record.unitName,
              warehouseId: record.warehouseId ?? undefined,
              costPrice: record.costPrice,
              sellingPrice: record.sellingPrice
            });
          }}
        />
      )
    }
  ];

  const saveProduct = async () => {
    const values = await productForm.validateFields();
    if (editingProduct) {
      await updateProductMutation.mutateAsync({
        id: editingProduct.id,
        payload: values
      });
      return;
    }
    await createProductMutation.mutateAsync(values);
  };

  return (
    <div className="partner-page">
      <Typography.Title level={2} className="partner-page-title">
        Danh sách hàng hóa
      </Typography.Title>
      <Typography.Text className="partner-page-backlink">Kho / Danh mục hàng hóa</Typography.Text>

      <div className="partner-page-summary">
        <div className="partner-summary-card partner-summary-card-accent">
          <div className="partner-summary-value">{formatNumber(summary.totalProducts)}</div>
          <div className="partner-summary-label">Số mã hàng đang theo dõi</div>
        </div>
        <div className="partner-summary-card">
          <div className="partner-summary-value">{formatNumber(summary.totalStock)}</div>
          <div className="partner-summary-label">Tổng tồn kho hiện tại</div>
        </div>
        <div className="partner-summary-card partner-summary-card-success">
          <div className="partner-summary-value">{formatNumber(summary.totalValue)}</div>
          <div className="partner-summary-label">Tổng giá trị theo giá vốn</div>
        </div>
      </div>

      <div className="partner-page-toolbar">
        <Space>
          <Button onClick={() => setSelectedProductRowKeys((productsQuery.data?.items ?? []).map((item) => item.id))}>
            Thực hiện hàng loạt
          </Button>
          <Button>Lọc</Button>
        </Space>
        <Space>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Tìm theo mã hoặc tên hàng"
            style={{ width: 240 }}
            allowClear
            value={keywordInput}
            onChange={(event) => {
              const value = event.target.value;
              setKeywordInput(value);
              debouncedSearch(value);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void productsQuery.refetch()} />
          <Button icon={<UploadOutlined />} onClick={() => setOpenImportModal(true)}>
            Nhập từ Excel
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            className="partner-add-button"
            onClick={() => {
              setEditingProduct(null);
              productForm.resetFields();
              setOpenProductModal(true);
            }}
          >
            Thêm mới
          </Button>
        </Space>
      </div>

      <Table<ProductOption>
        className="partner-management-table"
        size="small"
        bordered
        rowKey="id"
        loading={productsQuery.isFetching}
        columns={columns}
        dataSource={productsQuery.data?.items ?? []}
        rowSelection={{
          columnWidth: 44,
          selectedRowKeys: selectedProductRowKeys,
          onChange: (nextKeys) => setSelectedProductRowKeys(nextKeys as string[])
        }}
        pagination={{
          current: page,
          pageSize,
          total: productsQuery.data?.total ?? 0,
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

      <Modal
        title={editingProduct ? `Cập nhật hàng hóa: ${editingProduct.name}` : "Thêm hàng hóa"}
        open={openProductModal}
        onCancel={() => {
          setOpenProductModal(false);
          setEditingProduct(null);
        }}
        confirmLoading={createProductMutation.isPending || updateProductMutation.isPending}
        onOk={() => {
          void saveProduct();
        }}
      >
        <Form form={productForm} layout="vertical">
          <Form.Item label="Mã hàng" name="skuCode" rules={[{ required: true, message: "Bắt buộc nhập mã hàng" }]}>
            <Input placeholder="Nhập mã hàng" />
          </Form.Item>
          <Form.Item label="Tên hàng" name="name" rules={[{ required: true, message: "Bắt buộc nhập tên hàng" }]}>
            <Input placeholder="Nhập tên hàng" />
          </Form.Item>
          <Form.Item label="Đơn vị tính" name="unitName">
            <Input placeholder="Ví dụ: Cái, Mét, Cuộn..." />
          </Form.Item>
          <Form.Item label="Kho" name="warehouseId">
            <Select
              allowClear
              placeholder="Kho ngầm định"
              loading={warehousesQuery.isFetching}
              options={(warehousesQuery.data ?? [])
                .filter((item) => item.warehouseKey !== "DEFAULT")
                .map((item) => ({ label: item.warehouseName, value: item.warehouseKey }))}
            />
          </Form.Item>
          <Form.Item label="Giá vốn" name="costPrice">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Giá bán" name="sellingPrice">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <ImportWizardModal<ProductImportMappedData>
        open={openImportModal}
        title="Nhập hàng hóa từ Excel"
        entityLabel="Hàng hóa"
        showSourceSummary
        sourceSummaryLabel="Hàng hóa"
        systemFields={[
          {
            key: "skuCode",
            label: "Mã hàng",
            required: true,
            aliases: ["ma hang", "ma sp", "sku", "ma san pham", "ma (*)"]
          },
          {
            key: "name",
            label: "Tên hàng",
            required: true,
            aliases: ["ten hang", "ten vat tu", "ten san pham", "ten (*)"]
          },
          {
            key: "unitName",
            label: "Đơn vị tính",
            aliases: ["don vi", "don vi tinh chinh", "dvt"]
          },
          {
            key: "warehouseName",
            label: "Kho",
            aliases: ["kho", "kho ngam dinh"]
          },
          {
            key: "sellingPrice",
            label: "Giá bán",
            aliases: ["gia ban", "don gia ban"],
            renderValue: (value) => formatNumber((value as number | null) ?? 0)
          }
        ]}
        onCancel={() => setOpenImportModal(false)}
        onValidate={validateProductImport}
        onCommit={commitProductImport}
        onCompleted={async () => {
          await queryClient.invalidateQueries({ queryKey: ["products"] });
        }}
      />
    </div>
  );
}
