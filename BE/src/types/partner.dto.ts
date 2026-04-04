export type PartnerTypeValue = "SUPPLIER" | "CUSTOMER" | "BOTH";

export interface ListPartnersQueryDto {
  page: number;
  pageSize: number;
  keyword?: string;
  type?: PartnerTypeValue;
}

export interface CreatePartnerDto {
  code?: string;
  name: string;
  partnerType?: PartnerTypeValue;
  phone?: string;
  taxCode?: string;
  address?: string;
}

export interface UpdatePartnerDto {
  code?: string;
  name?: string;
  partnerType?: PartnerTypeValue;
  phone?: string;
  taxCode?: string;
  address?: string;
}

export interface PartnerViewDto {
  id: string;
  code: string;
  name: string;
  partnerType: PartnerTypeValue;
  phone: string | null;
  taxCode: string | null;
  address: string | null;
  currentDebt: number;
}
