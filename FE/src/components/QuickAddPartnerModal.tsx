import { PartnerModal, type PartnerFormValues } from "./PartnerModal";
import type { PartnerTypeValue } from "../types";

export interface QuickAddPartnerPayload extends PartnerFormValues {}

interface QuickAddPartnerModalProps {
  open: boolean;
  loading: boolean;
  title?: string;
  initialPartnerType?: PartnerTypeValue;
  onCancel: () => void;
  onSubmit: (payload: QuickAddPartnerPayload) => Promise<void>;
}

export function QuickAddPartnerModal(props: QuickAddPartnerModalProps) {
  const { open, loading, title, initialPartnerType = "CUSTOMER", onCancel, onSubmit } = props;

  return (
    <PartnerModal
      open={open}
      loading={loading}
      mode="create"
      title={title ?? "Thêm nhanh khách hàng / nhà cung cấp"}
      requirePhone
      initialValues={{
        partnerType: initialPartnerType
      }}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}
