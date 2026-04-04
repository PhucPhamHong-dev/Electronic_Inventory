import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./components/RequireAuth";
import { ROUTES } from "./constants/routes";
import { AuthLayout } from "./layouts/AuthLayout";
import { MainLayout } from "./layouts/MainLayout";
import { DashboardPage } from "./pages/Dashboard";
import { LoginPage } from "./pages/Login";
import { ArLedgerReportPage } from "./pages/ArLedgerReport";
import { PartnerListPage } from "./pages/PartnerList";
import { ProductsPage } from "./pages/Products";
import { ReportsPage } from "./pages/Reports";
import { StockCardPage } from "./pages/StockCard";
import { SystemPage } from "./pages/System";
import { VoucherHistoryPage } from "./pages/VoucherHistory";
import { VoucherFormPage } from "./pages/VoucherForm";

export function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path={ROUTES.LOGIN} element={<LoginPage />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <MainLayout />
          </RequireAuth>
        }
      >
        <Route path={ROUTES.DASHBOARD} element={<DashboardPage />} />
        <Route path={ROUTES.VOUCHER_FORM} element={<VoucherFormPage />} />
        <Route path={ROUTES.PURCHASE_VOUCHER} element={<VoucherFormPage />} />
        <Route path={ROUTES.SALES_VOUCHER} element={<VoucherFormPage />} />
        <Route path={ROUTES.MASTER_DATA} element={<ProductsPage />} />
        <Route path={ROUTES.PRODUCTS} element={<ProductsPage />} />
        <Route path={ROUTES.PARTNERS} element={<PartnerListPage />} />
        <Route path={ROUTES.REPORTS} element={<ReportsPage />} />
        <Route path={ROUTES.VOUCHER_HISTORY} element={<VoucherHistoryPage />} />
        <Route path={ROUTES.AR_LEDGER_REPORT} element={<ArLedgerReportPage />} />
        <Route path={ROUTES.STOCK_CARD_REPORT} element={<StockCardPage />} />
        <Route path={ROUTES.SYSTEM} element={<SystemPage />} />
      </Route>
      <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
    </Routes>
  );
}
