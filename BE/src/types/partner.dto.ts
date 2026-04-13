export type PartnerTypeValue = "SUPPLIER" | "CUSTOMER" | "BOTH";
export type PartnerGroupValue = "CUSTOMER" | "SUPPLIER";

export interface ListPartnersQueryDto {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: PartnerTypeValue;
  group?: PartnerGroupValue;
  debtOnly?: boolean;
  debtStatus?: "HAS_DEBT" | "NO_DEBT";
}

export interface CreatePartnerDto {
  code?: string;
  name: string;
  group?: PartnerGroupValue;
  partnerType?: PartnerTypeValue;
  phone?: string;
  taxCode?: string;
  address?: string;
}

export interface UpdatePartnerDto {
  code?: string;
  name?: string;
  group?: PartnerGroupValue;
  partnerType?: PartnerTypeValue;
  phone?: string;
  taxCode?: string;
  address?: string;
}

export interface PartnerViewDto {
  id: string;
  code: string;
  name: string;
  group: PartnerGroupValue;
  partnerType: PartnerTypeValue;
  phone: string | null;
  taxCode: string | null;
  address: string | null;
  currentDebt: number;
}
