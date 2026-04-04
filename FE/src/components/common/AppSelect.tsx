import { Select } from "antd";
import type { SelectProps } from "antd";
import type { CSSProperties } from "react";

type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

type AppSelectProps<ValueType = unknown> = SelectProps<ValueType> & DataAttributes;

const DEFAULT_DROPDOWN_STYLE: CSSProperties = {
  minWidth: "max-content",
  maxWidth: 600
};

export function AppSelect<ValueType = unknown>(props: AppSelectProps<ValueType>) {
  const { popupMatchSelectWidth, dropdownStyle, popupClassName, ...rest } = props;

  return (
    <Select<ValueType>
      popupMatchSelectWidth={popupMatchSelectWidth ?? false}
      dropdownStyle={{
        ...DEFAULT_DROPDOWN_STYLE,
        ...dropdownStyle
      }}
      popupClassName={popupClassName ? `app-select-dropdown ${popupClassName}` : "app-select-dropdown"}
      {...rest}
    />
  );
}
