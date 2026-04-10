export type QuotationStatusValue = "PENDING" | "APPROVED" | "REJECTED";

export interface QuotationItemInputDto {
  productId: string;
  unitId?: string;
  quantity: number;
  price: number;
  discountPercent?: number;
  taxPercent?: number;
}

export interface CreateQuotationDto {
  partnerId: string;
  notes?: string;
  status?: QuotationStatusValue;
  items: QuotationItemInputDto[];
}

export interface UpdateQuotationDto {
  partnerId?: string;
  notes?: string;
  status?: QuotationStatusValue;
  items?: QuotationItemInputDto[];
}

export interface ListQuotationQueryDto {
  page: number;
  pageSize: number;
  search?: string;
  status?: QuotationStatusValue;
  partnerId?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface QuotationListItemDto {
  id: string;
  quotationNo: string;
  partnerId: string;
  partnerName: string;
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  totalNetAmount: number;
  notes: string | null;
  status: QuotationStatusValue;
  createdAt: Date;
  createdBy: string | null;
  createdByName?: string | null;
}

export interface QuotationDetailDto {
  id: string;
  quotationNo: string;
  partnerId: string;
  partnerName: string;
  totalAmount: number;
  totalDiscount: number;
  totalTax: number;
  totalNetAmount: number;
  notes: string | null;
  status: QuotationStatusValue;
  createdAt: Date;
  createdBy: string | null;
  createdByName?: string | null;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    skuCode: string;
    unitId: string | null;
    quantity: number;
    price: number;
    discountPercent: number;
    unitPriceAfterDiscount: number;
    taxPercent: number;
    netAmount: number;
  }>;
}
