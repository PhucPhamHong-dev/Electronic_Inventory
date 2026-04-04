import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Space, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import debounce from "lodash.debounce";
import { AppSelect } from "../components/common/AppSelect";
import { MTable } from "../components/m-Table";
import { createPartner, fetchPartners } from "../services/masterData.api";
import type { PartnerOption } from "../types/voucher";

type PartnerTypeValue = "SUPPLIER" | "CUSTOMER" | "BOTH";
type CreatePartnerFormValues = {
  code?: string;
  name: string;
  phone: string;
  partnerType?: PartnerTypeValue;
};

export function PartnersPage() {
  const queryClient = useQueryClient();
  const [createForm] = Form.useForm<CreatePartnerFormValues>();
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

  const partnersQuery = useQuery({
    queryKey: ["partners", page, pageSize, keyword],
    queryFn: () => fetchPartners({ page, pageSize, keyword })
  });

  const createPartnerMutation = useMutation({
    mutationFn: createPartner,
    onSuccess: async () => {
      setOpenCreateModal(false);
      createForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["partners"] });
    }
  });

  const columns: ColumnsType<PartnerOption> = [
    { title: "Mã đối tác", dataIndex: "code", key: "code", align: "left", width: 180 },
    { title: "Tên đối tác", dataIndex: "name", key: "name", align: "left" },
    { title: "Điện thoại", dataIndex: "phone", key: "phone", align: "left", width: 180 }
  ];

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Khách hàng / Nhà cung cấp
        </Typography.Title>
        <Button type="primary" onClick={() => setOpenCreateModal(true)}>
          Thêm mới
        </Button>
      </Space>

      <Input.Search
        placeholder="Tìm theo mã hoặc tên đối tác"
        allowClear
        value={keywordInput}
        onChange={(event) => {
          const value = event.target.value;
          setKeywordInput(value);
          debouncedSearch(value);
        }}
        style={{ marginBottom: 12 }}
      />

      <MTable<PartnerOption>
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
      />

      <Modal
        title="Thêm đối tác"
        open={openCreateModal}
        onCancel={() => setOpenCreateModal(false)}
        confirmLoading={createPartnerMutation.isPending}
        onOk={async () => {
          const values = await createForm.validateFields();
          await createPartnerMutation.mutateAsync(values);
        }}
      >
        <Form form={createForm} layout="vertical" initialValues={{ partnerType: "BOTH" }}>
          <Form.Item label="Mã đối tác" name="code">
            <Input placeholder="Để trống để hệ thống tự sinh mã" />
          </Form.Item>

          <Form.Item label="Tên đối tác" name="name" rules={[{ required: true, message: "Bắt buộc nhập tên đối tác" }]}>
            <Input placeholder="Nhập tên đối tác" />
          </Form.Item>

          <Form.Item
            label="Số điện thoại"
            name="phone"
            rules={[{ required: true, message: "Bắt buộc nhập số điện thoại" }]}
          >
            <Input placeholder="Nhập số điện thoại" />
          </Form.Item>

          <Form.Item label="Loại đối tác" name="partnerType">
            <AppSelect
              options={[
                { value: "BOTH", label: "Khách hàng & NCC" },
                { value: "CUSTOMER", label: "Khách hàng" },
                { value: "SUPPLIER", label: "Nhà cung cấp" }
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
