import { authorizeStorefront } from './auth.ts';
import { listCatalog } from './catalog.ts';
import { createOrder } from './orders.ts';

export function handleCatalogRequest(role: string): readonly { sku: string }[] {
  if (!authorizeStorefront(role)) return [];
  return listCatalog().map((item) => ({ sku: item.sku }));
}

export function handleOrderRequest(
  role: string,
  id: string,
  sku: string,
  quantity: number
): { readonly id: string; readonly totalCents: number } | undefined {
  if (!authorizeStorefront(role)) return undefined;
  const order = createOrder(id, sku, quantity);
  return { id: order.id, totalCents: order.totalCents };
}
