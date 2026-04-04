import {
  AppstoreOutlined,
  BarChartOutlined,
  BellOutlined,
  DatabaseOutlined,
  LogoutOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  UserOutlined
} from "@ant-design/icons";
import { Avatar, Breadcrumb, Button, Card, Layout, Menu, Space, Typography } from "antd";
import { useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "../constants/routes";
import { useAuthStore } from "../store/useAuthStore";

const { Sider, Header, Content } = Layout;
const CATALOG_MENU_KEY = "catalog";
const REPORT_MENU_KEY = "bao-cao";

const breadcrumbMap: Record<string, string[]> = {
  [ROUTES.DASHBOARD]: ["Tổng quan"],
  [ROUTES.MASTER_DATA]: ["Danh mục", "Hàng hóa"],
  [ROUTES.PRODUCTS]: ["Danh mục", "Hàng hóa"],
  [ROUTES.PARTNERS]: ["Danh mục", "Đối tác"],
  [ROUTES.PURCHASE_VOUCHER]: ["Mua hàng", "Thêm mới phiếu nhập"],
  [ROUTES.SALES_VOUCHER]: ["Bán hàng", "Thêm mới phiếu xuất"],
  [ROUTES.REPORTS]: ["Báo cáo"],
  [ROUTES.VOUCHER_HISTORY]: ["Báo cáo", "Lịch sử chứng từ"],
  [ROUTES.AR_LEDGER_REPORT]: ["Báo cáo", "Sổ chi tiết công nợ"],
  [ROUTES.STOCK_CARD_REPORT]: ["Báo cáo", "Thẻ kho"],
  [ROUTES.SYSTEM]: ["Hệ thống"]
};

export function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);

  const menuItems = useMemo(
    () => [
      { key: ROUTES.DASHBOARD, icon: <AppstoreOutlined />, label: "Tổng quan" },
      {
        key: CATALOG_MENU_KEY,
        icon: <DatabaseOutlined />,
        label: "Danh mục",
        children: [
          { key: ROUTES.PRODUCTS, label: "Hàng hóa" },
          { key: ROUTES.PARTNERS, label: "Đối tác" }
        ]
      },
      { key: ROUTES.PURCHASE_VOUCHER, icon: <ShoppingCartOutlined />, label: "Mua hàng" },
      { key: ROUTES.SALES_VOUCHER, icon: <ShopOutlined />, label: "Bán hàng" },
      {
        key: REPORT_MENU_KEY,
        icon: <BarChartOutlined />,
        label: "Báo cáo",
        children: [
          { key: ROUTES.VOUCHER_HISTORY, label: "Lịch sử chứng từ" },
          { key: ROUTES.STOCK_CARD_REPORT, label: "Thẻ kho / Sổ chi tiết vật tư" },
          { key: ROUTES.AR_LEDGER_REPORT, label: "Sổ chi tiết công nợ" }
        ]
      },
      { key: ROUTES.SYSTEM, icon: <SettingOutlined />, label: "Hệ thống" }
    ],
    []
  );

  const currentBread = breadcrumbMap[location.pathname] ?? ["Bán hàng", "Thêm mới phiếu xuất"];

  const selectedMenuKey = useMemo(() => {
    if (location.pathname.startsWith(ROUTES.PRODUCTS)) {
      return ROUTES.PRODUCTS;
    }
    if (location.pathname.startsWith(ROUTES.PARTNERS)) {
      return ROUTES.PARTNERS;
    }
    if (location.pathname.startsWith(ROUTES.VOUCHER_HISTORY)) {
      return ROUTES.VOUCHER_HISTORY;
    }
    if (location.pathname.startsWith(ROUTES.STOCK_CARD_REPORT)) {
      return ROUTES.STOCK_CARD_REPORT;
    }
    if (location.pathname.startsWith(ROUTES.AR_LEDGER_REPORT)) {
      return ROUTES.AR_LEDGER_REPORT;
    }
    if (location.pathname === ROUTES.REPORTS) {
      return REPORT_MENU_KEY;
    }
    return location.pathname;
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        theme="dark"
        width={228}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        style={{ borderRight: "1px solid #0f2740" }}
      >
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            paddingInline: 16,
            color: "#ffffff",
            fontWeight: 700,
            letterSpacing: 0.4
          }}
        >
          {collapsed ? "W" : "WMS"}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedMenuKey]}
          defaultOpenKeys={[CATALOG_MENU_KEY, REPORT_MENU_KEY]}
          items={menuItems}
          onClick={(info) => {
            if (info.key === CATALOG_MENU_KEY || info.key === ROUTES.MASTER_DATA) {
              navigate(ROUTES.PRODUCTS);
              return;
            }
            if (info.key === REPORT_MENU_KEY) {
              return;
            }
            navigate(info.key);
          }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: "#ffffff",
            height: 56,
            lineHeight: "56px",
            padding: "0 16px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            zIndex: 10,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}
        >
          <Breadcrumb
            items={currentBread.map((label) => ({
              title: label
            }))}
          />
          <Space size={16}>
            <Typography.Text type="secondary">Kỳ kế toán: Tháng 04/2026</Typography.Text>
            <BellOutlined style={{ fontSize: 16 }} />
            <Space size={8}>
              <Avatar size="small" icon={<UserOutlined />} />
              <Typography.Text>{user?.username ?? "N/A"}</Typography.Text>
            </Space>
            <Button
              icon={<LogoutOutlined />}
              onClick={() => {
                clearSession();
                navigate(ROUTES.LOGIN);
              }}
            >
              Đăng xuất
            </Button>
          </Space>
        </Header>

        <Content style={{ background: "#f0f2f5", padding: 16 }}>
          <Card style={{ borderRadius: 4 }} bodyStyle={{ padding: 20, minHeight: "calc(100vh - 88px)" }}>
            <Outlet />
          </Card>
        </Content>
      </Layout>
    </Layout>
  );
}

