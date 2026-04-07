import type { PermissionMap } from "./index";

export interface UserListItemDto {
  id: string;
  username: string;
  fullName: string | null;
  isActive: boolean;
  permissions: PermissionMap;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserDto {
  username: string;
  fullName?: string;
  password: string;
  isActive?: boolean;
  permissions?: Partial<PermissionMap>;
}

export interface UpdateUserDto {
  username?: string;
  fullName?: string;
  password?: string;
  isActive?: boolean;
  permissions?: Partial<PermissionMap>;
}

export interface ResetPasswordDto {
  newPassword: string;
}

export interface CompanySettingsDto {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  allowNegativeStock: boolean;
}
