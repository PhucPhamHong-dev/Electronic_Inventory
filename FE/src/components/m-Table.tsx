import { Table, type TableProps } from "antd";

export function MTable<T extends object>(props: TableProps<T>) {
  return <Table<T> size="small" bordered {...props} />;
}
