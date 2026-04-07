import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  notification
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { PermissionMap } from "../types/auth";
import type { CompanySettings, IUserItem, UserMutationPayload } from "../types";
import {
  createUser,
  deleteUser,
  fetchCompanySettings,
  fetchUsers,
  resetUserPassword,
  updateCompanySettings,
  updateUser
} from "../services/system.api";

type PermissionKey = keyof PermissionMap;

interface UserFormValues {
  username: string;
  fullName?: string;
  password?: string;
  isActive: boolean;
  permissions: PermissionKey[];
}

interface ResetPasswordFormValues {
  newPassword: string;
}

const PERMISSION_OPTIONS: Array<{ key: PermissionKey; label: string }> = [
  { key: "create_purchase_voucher", label: "Lập phiếu nhập kho" },
  { key: "create_sales_voucher", label: "Lập phiếu xuất kho/Bán hàng" },
  { key: "create_conversion_voucher", label: "Lập phiếu xé lẻ/chuyển đổi" },
  { key: "edit_booked_voucher", label: "Sửa phiếu đã ghi sổ" },
  { key: "view_cost_price", label: "Xem giá vốn & Lợi nhuận" },
  { key: "view_audit_logs", label: "Xem lịch sử chỉnh sửa" }
];

const DEFAULT_PERMISSION_MAP: PermissionMap = {
  create_purchase_voucher: false,
  create_sales_voucher: false,
  create_conversion_voucher: false,
  edit_booked_voucher: false,
  view_cost_price: false,
  view_audit_logs: false
};

function permissionMapToArray(value: PermissionMap): PermissionKey[] {
  return (Object.keys(value) as PermissionKey[]).filter((key) => value[key]);
}

function permissionArrayToMap(values: PermissionKey[]): PermissionMap {
  const map: PermissionMap = { ...DEFAULT_PERMISSION_MAP };
  values.forEach((key) => {
    map[key] = true;
  });
  return map;
}

function randomPassword(): string {
  const prefix = "WMS";
  const tail = Math.random().toString(36).slice(2, 8);
  return `${prefix}${tail}`;
}

export function SystemManagementPage() {
  const queryClient = useQueryClient();
  const [userForm] = Form.useForm<UserFormValues>();
  const [companyForm] = Form.useForm<CompanySettings>();
  const [resetPasswordForm] = Form.useForm<ResetPasswordFormValues>();

  const [openUserModal, setOpenUserModal] = useState(false);
  const [openResetModal, setOpenResetModal] = useState(false);
  const [editingUser, setEditingUser] = useState<IUserItem | null>(null);
  const [resetTargetUser, setResetTargetUser] = useState<IUserItem | null>(null);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers
  });

  const companySettingsQuery = useQuery({
    queryKey: ["system-settings"],
    queryFn: fetchCompanySettings
  });

  useEffect(() => {
    if (!companySettingsQuery.data) {
      return;
    }
    companyForm.setFieldsValue(companySettingsQuery.data);
  }, [companyForm, companySettingsQuery.data]);

  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: async () => {
      setOpenUserModal(false);
      setEditingUser(null);
      userForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      notification.success({ message: "Thêm nhân viên thành công" });
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: async (input: { id: string; payload: Partial<UserMutationPayload> & { password?: string } }) =>
      updateUser(input.id, input.payload),
    onSuccess: async () => {
      setOpenUserModal(false);
      setEditingUser(null);
      userForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      notification.success({ message: "Cập nhật nhân viên thành công" });
    }
  });

  const deleteUserMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      notification.success({ message: "Xóa nhân viên thành công" });
    }
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (input: { userId: string; newPassword: string }) => resetUserPassword(input.userId, input.newPassword),
    onSuccess: async () => {
      setOpenResetModal(false);
      setResetTargetUser(null);
      resetPasswordForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      notification.success({ message: "Đã cập nhật mật khẩu mới cho nhân viên thành công" });
    }
  });

  const updateCompanyMutation = useMutation({
    mutationFn: updateCompanySettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      notification.success({ message: "Đã lưu cấu hình" });
    }
  });

  const saveCompanySettings = async (payload: CompanySettings) => {
    companyForm.setFieldsValue(payload);
    await updateCompanyMutation.mutateAsync(payload);
  };

  const userColumns: ColumnsType<IUserItem> = useMemo(
    () => [
      {
        title: "Tên đăng nhập",
        dataIndex: "username",
        key: "username",
        width: 180
      },
      {
        title: "Họ và tên",
        dataIndex: "fullName",
        key: "fullName",
        render: (value?: string | null) => value || "-"
      },
      {
        title: "Trạng thái",
        dataIndex: "isActive",
        key: "isActive",
        width: 140,
        align: "center",
        render: (value: boolean, record) => (
          <Switch
            checked={value}
            onChange={(checked) =>
              void updateUserMutation.mutateAsync({
                id: record.id,
                payload: { isActive: checked }
              })
            }
          />
        )
      },
      {
        title: "Phân quyền giá vốn",
        dataIndex: "permissions",
        key: "permissions",
        width: 180,
        align: "center",
        render: (value: PermissionMap) => (
          <Tag color={value.view_cost_price ? "green" : "orange"}>{value.view_cost_price ? "Được xem" : "Bị khóa"}</Tag>
        )
      },
      {
        title: "Hành động",
        key: "actions",
        width: 170,
        align: "center",
        render: (_, record) => (
          <Space>
            <Tooltip title="Sửa">
              <Button
                type="text"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditingUser(record);
                  userForm.setFieldsValue({
                    username: record.username,
                    fullName: record.fullName || "",
                    password: "",
                    isActive: record.isActive,
                    permissions: permissionMapToArray(record.permissions)
                  });
                  setOpenUserModal(true);
                }}
              />
            </Tooltip>

            <Tooltip title="Cấp lại mật khẩu">
              <Button
                type="text"
                icon={<KeyOutlined />}
                onClick={() => {
                  setResetTargetUser(record);
                  resetPasswordForm.setFieldValue("newPassword", "123456");
                  setOpenResetModal(true);
                }}
              />
            </Tooltip>

            <Popconfirm
              title="Xóa người dùng"
              description="Bạn có chắc muốn xóa tài khoản này?"
              okText="Xóa"
              cancelText="Hủy"
              onConfirm={() => void deleteUserMutation.mutateAsync(record.id)}
            >
              <Button type="text" danger icon={<DeleteOutlined />} loading={deleteUserMutation.isPending} />
            </Popconfirm>
          </Space>
        )
      }
    ],
    [deleteUserMutation, resetPasswordForm, updateUserMutation, userForm]
  );

  const userModalLoading = createUserMutation.isPending || updateUserMutation.isPending;

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 12 }}>
        Quản trị hệ thống
      </Typography.Title>

      <Tabs
        defaultActiveKey="users"
        items={[
          {
            key: "users",
            label: "Quản lý Người dùng",
            children: (
              <div>
                <Space style={{ width: "100%", justifyContent: "flex-end", marginBottom: 12 }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditingUser(null);
                      userForm.setFieldsValue({
                        username: "",
                        fullName: "",
                        password: "",
                        isActive: true,
                        permissions: []
                      });
                      setOpenUserModal(true);
                    }}
                  >
                    Thêm nhân viên
                  </Button>
                </Space>

                <Table<IUserItem> rowKey="id" size="small" bordered loading={usersQuery.isFetching} columns={userColumns} dataSource={usersQuery.data ?? []} pagination={false} />
              </div>
            )
          },
          {
            key: "company",
            label: "Thông tin Công ty",
            children: (
              <Form<CompanySettings> form={companyForm} layout="vertical">
                <Row gutter={16}>
                  <Col xs={24} md={12}>
                    <Form.Item label="Tên công ty" name="companyName" rules={[{ required: true, message: "Vui lòng nhập tên công ty" }]}>
                      <Input placeholder="Nhập tên công ty" />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label="Số điện thoại" name="companyPhone" rules={[{ required: true, message: "Vui lòng nhập số điện thoại" }]}>
                      <Input placeholder="Nhập số điện thoại" />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={24}>
                    <Form.Item label="Địa chỉ" name="companyAddress" rules={[{ required: true, message: "Vui lòng nhập địa chỉ" }]}>
                      <Input.TextArea rows={3} placeholder="Nhập địa chỉ công ty" />
                    </Form.Item>
                  </Col>
                </Row>
                <Space>
                  <Button
                    type="primary"
                    loading={updateCompanyMutation.isPending}
                    onClick={async () => {
                      const values = await companyForm.validateFields();
                      await updateCompanyMutation.mutateAsync(values);
                    }}
                  >
                    Lưu cấu hình
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      if (companySettingsQuery.data) {
                        companyForm.setFieldsValue(companySettingsQuery.data);
                      }
                    }}
                  >
                    Tải lại
                  </Button>
                </Space>
              </Form>
            )
          },
          {
            key: "settings",
            label: "Thiết lập hệ thống",
            children: (
              <Card bordered className="system-settings-card">
                <Tabs
                  items={[
                    {
                      key: "inventory",
                      label: "Vật tư hàng hóa",
                      children: (
                        <div className="system-settings-row">
                          <div>
                            <Typography.Text strong>Cho phép xuất quá số lượng tồn</Typography.Text>
                            <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 0 }}>
                              Nếu bật, hệ thống sẽ không chặn các phiếu xuất khi số lượng trong kho không đủ.
                            </Typography.Paragraph>
                          </div>
                          <Switch
                            checked={companyForm.getFieldValue("allowNegativeStock") === true}
                            loading={updateCompanyMutation.isPending}
                            onChange={(checked) => {
                              const currentValues = companyForm.getFieldsValue();
                              void saveCompanySettings({
                                ...currentValues,
                                allowNegativeStock: checked
                              });
                            }}
                          />
                        </div>
                      )
                    },
                    {
                      key: "sales",
                      label: "Bán hàng",
                      children: <Typography.Text type="secondary">Thiết lập bán hàng sẽ được bổ sung tiếp.</Typography.Text>
                    },
                    {
                      key: "finance",
                      label: "Tài chính",
                      children: <Typography.Text type="secondary">Thiết lập tài chính sẽ được bổ sung tiếp.</Typography.Text>
                    }
                  ]}
                />
              </Card>
            )
          }
        ]}
      />

      <Modal
        title={editingUser ? `Cập nhật nhân viên: ${editingUser.username}` : "Thêm nhân viên"}
        open={openUserModal}
        onCancel={() => {
          setOpenUserModal(false);
          setEditingUser(null);
          userForm.resetFields();
        }}
        onOk={async () => {
          const values = await userForm.validateFields();
          const permissions = permissionArrayToMap(values.permissions);

          if (editingUser) {
            const payload: Partial<UserMutationPayload> & { password?: string } = {
              username: values.username,
              fullName: values.fullName,
              isActive: values.isActive,
              permissions
            };
            if (values.password && values.password.trim()) {
              payload.password = values.password;
            }
            await updateUserMutation.mutateAsync({
              id: editingUser.id,
              payload
            });
            return;
          }

          await createUserMutation.mutateAsync({
            username: values.username,
            fullName: values.fullName,
            password: values.password || "123456",
            isActive: values.isActive,
            permissions
          });
        }}
        confirmLoading={userModalLoading}
        width={760}
      >
        <Form<UserFormValues> form={userForm} layout="vertical">
          <Divider orientation="left" style={{ marginTop: 0 }}>
            Thông tin tài khoản
          </Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Tên đăng nhập" name="username" rules={[{ required: true, message: "Vui lòng nhập tên đăng nhập" }]}>
                <Input placeholder="Nhập tên đăng nhập" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Họ và tên" name="fullName">
                <Input placeholder="Nhập họ và tên" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Mật khẩu"
                name="password"
                rules={
                  editingUser
                    ? undefined
                    : [{ required: true, message: "Vui lòng nhập mật khẩu cho nhân viên mới" }]
                }
              >
                <Input.Password placeholder={editingUser ? "Bỏ trống nếu không đổi mật khẩu" : "Nhập mật khẩu"} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Trạng thái hoạt động" name="isActive" valuePropName="checked">
                <Switch checkedChildren="Hoạt động" unCheckedChildren="Khóa" />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left">Ma trận phân quyền</Divider>
          <Form.Item
            name="permissions"
            rules={[{ required: true, message: "Vui lòng chọn ít nhất 1 quyền" }]}
          >
            <Checkbox.Group style={{ width: "100%" }}>
              <Row gutter={[8, 8]}>
                {PERMISSION_OPTIONS.map((permission) => (
                  <Col span={12} key={permission.key}>
                    <Checkbox value={permission.key}>{permission.label}</Checkbox>
                  </Col>
                ))}
              </Row>
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Cấp lại mật khẩu cho ${resetTargetUser?.fullName || resetTargetUser?.username || "nhân viên"}`}
        open={openResetModal}
        onCancel={() => {
          setOpenResetModal(false);
          setResetTargetUser(null);
          resetPasswordForm.resetFields();
        }}
        onOk={async () => {
          const values = await resetPasswordForm.validateFields();
          if (!resetTargetUser) {
            return;
          }
          await resetPasswordMutation.mutateAsync({
            userId: resetTargetUser.id,
            newPassword: values.newPassword
          });
        }}
        confirmLoading={resetPasswordMutation.isPending}
        width={520}
      >
        <Form<ResetPasswordFormValues> form={resetPasswordForm} layout="vertical">
          <Form.Item
            label="Mật khẩu mới"
            name="newPassword"
            rules={[{ required: true, message: "Vui lòng nhập mật khẩu mới" }, { min: 6, message: "Mật khẩu tối thiểu 6 ký tự" }]}
          >
            <Input.Password placeholder="Nhập mật khẩu mới" />
          </Form.Item>
          <Button
            icon={<KeyOutlined />}
            onClick={() => resetPasswordForm.setFieldValue("newPassword", randomPassword())}
          >
            Tạo ngẫu nhiên
          </Button>
        </Form>
      </Modal>
    </div>
  );
}
