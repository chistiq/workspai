import { handleCatalogRequest, handleOrderRequest } from './http.ts';

export function startStorefront(): {
  readonly catalog: readonly { sku: string }[];
  readonly order: { readonly id: string; readonly totalCents: number } | undefined;
} {
  return {
    catalog: handleCatalogRequest('storefront'),
    order: handleOrderRequest('storefront', 'order-1', 'sku-notebook', 2),
  };
}

export const storefront = startStorefront();
