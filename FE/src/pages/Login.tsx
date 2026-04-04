import { useMutation } from "@tanstack/react-query";
import { Button, Card, Form, Input, Typography } from "antd";
import { Navigate, useNavigate } from "react-router-dom";
import { loginApi } from "../services/auth.api";
import { useAuthStore } from "../store/useAuthStore";
import { ROUTES } from "../constants/routes";
import { decodeJwtPayload } from "../utils/jwt";

interface LoginFormValues {
  username: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const loginMutation = useMutation({
    mutationFn: loginApi,
    onSuccess: (result) => {
      const payload = decodeJwtPayload(result.accessToken);
      setSession({
        token: result.accessToken,
        user: {
          id: payload.sub ?? "",
          username: payload.username ?? "staff"
        },
        permissions: {
          create_purchase_voucher: Boolean(payload.permissions?.create_purchase_voucher),
          create_sales_voucher: Boolean(payload.permissions?.create_sales_voucher),
          create_conversion_voucher: Boolean(payload.permissions?.create_conversion_voucher),
          edit_booked_voucher: Boolean(payload.permissions?.edit_booked_voucher),
          view_cost_price: Boolean(payload.permissions?.view_cost_price),
          view_audit_logs: Boolean(payload.permissions?.view_audit_logs)
        }
      });
      navigate(ROUTES.DASHBOARD, { replace: true });
    }
  });

  if (isAuthenticated) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  const onFinish = (values: LoginFormValues) => {
    loginMutation.mutate(values);
  };

  return (
    <Card style={{ width: 420 }}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Đăng nhập hệ thống WMS
      </Typography.Title>
      <Form<LoginFormValues> layout="vertical" onFinish={onFinish}>
        <Form.Item label="Tên đăng nhập" name="username" rules={[{ required: true, message: "Bắt buộc nhập tên đăng nhập" }]}>
          <Input size="large" autoFocus />
        </Form.Item>
        <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: "Bắt buộc nhập mật khẩu" }]}>
          <Input.Password size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" loading={loginMutation.isPending} block>
          Đăng nhập
        </Button>
      </Form>
    </Card>
  );
}
