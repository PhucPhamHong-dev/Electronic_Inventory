import type { ThemeConfig } from "antd";

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: "#1890ff",
    colorSuccess: "#52c41a",
    colorWarning: "#faad14",
    colorError: "#f5222d",
    fontSize: 14,
    colorText: "#1f1f1f",
    controlHeight: 36,
    borderRadius: 4
  },
  components: {
    Table: {
      fontSize: 14,
      headerBg: "#f0f2f5",
      headerColor: "#262626",
      fontWeightStrong: 600
    },
    Form: {
      labelFontSize: 14,
      labelColor: "#434343"
    }
  }
};
