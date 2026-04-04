import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Modal, Space, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import debounce from "lodash.debounce";
import { MTable } from "../components/m-Table";
import { createProduct, fetchProducts } from "../services/masterData.api";
import type { ProductOption } from "../types/voucher";
import { formatNumber } from "../utils/formatters";

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [createForm] = Form.useForm<{ skuCode: string; name: string; costPrice?: number }>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [openCreateModal, setOpenCreateModal] = useState(false);

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

  const createProductMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: async () => {
      setOpenCreateModal(false);
      createForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    }
  });

  const columns: ColumnsType<ProductOption> = [
    { title: "Mã hàng", dataIndex: "skuCode", key: "skuCode", align: "left", width: 160 },
    { title: "Tên hàng", dataIndex: "name", key: "name", align: "left" },
    {
      title: "Giá vốn",
      dataIndex: "costPrice",
      key: "costPrice",
      align: "right",
      width: 160,
      render: (value: number) => formatNumber(value)
    }
  ];

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Danh mục hàng hóa
        </Typography.Title>
        <Button type="primary" onClick={() => setOpenCreateModal(true)}>
          Thêm mới
        </Button>
      </Space>
      <Input.Search
        placeholder="Tìm theo mã hoặc tên hàng"
        allowClear
        value={keywordInput}
        onChange={(event) => {
          const value = event.target.value;
          setKeywordInput(value);
          debouncedSearch(value);
        }}
        style={{ marginBottom: 12 }}
      />
      <MTable<ProductOption>
        rowKey="id"
        loading={productsQuery.isFetching}
        columns={columns}
        dataSource={productsQuery.data?.items ?? []}
        pagination={{
          current: page,
          pageSize,
          total: productsQuery.data?.total ?? 0,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }
        }}
      />
      <Modal
        title="Thêm hàng hóa"
        open={openCreateModal}
        onCancel={() => setOpenCreateModal(false)}
        confirmLoading={createProductMutation.isPending}
        onOk={async () => {
          const values = await createForm.validateFields();
          await createProductMutation.mutateAsync(values);
        }}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item label="Mã hàng" name="skuCode" rules={[{ required: true, message: "Bắt buộc nhập mã hàng" }]}>
            <Input placeholder="Nhập mã hàng" />
          </Form.Item>
          <Form.Item label="Tên hàng" name="name" rules={[{ required: true, message: "Bắt buộc nhập tên hàng" }]}>
            <Input placeholder="Nhập tên hàng" />
          </Form.Item>
          <Form.Item label="Giá vốn" name="costPrice">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
