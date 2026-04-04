import { Layout } from "antd";
import { Outlet } from "react-router-dom";

const { Content } = Layout;

export function AuthLayout() {
  return (
    <Layout style={{ minHeight: "100vh", background: "#f5f7fa" }}>
      <Content style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
