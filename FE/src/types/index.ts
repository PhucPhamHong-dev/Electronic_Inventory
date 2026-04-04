import type { PermissionMap } from "./auth";

export type PartnerTypeValue = "CUSTOMER" | "SUPPLIER" | "BOTH";

export interface IPartner {
  id: string;
  code: string;
  name: string;
  partnerType: PartnerTypeValue;
  phone?: string | null;
  taxCode?: string | null;
  address?: string | null;
  currentDebt: number;
}

export interface PartnerMutationPayload {
  code?: string;
  name: string;
  partnerType: PartnerTypeValue;
  phone?: string;
  taxCode?: string;
  address?: string;
}

export interface IUserItem {
  id: string;
  username: string;
  fullName?: string | null;
  isActive: boolean;
  permissions: PermissionMap;
  createdAt: string;
  updatedAt: string;
}

export interface UserMutationPayload {
  username: string;
  fullName?: string;
  password?: string;
  isActive?: boolean;
  permissions: PermissionMap;
}

export interface CompanySettings {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
}
