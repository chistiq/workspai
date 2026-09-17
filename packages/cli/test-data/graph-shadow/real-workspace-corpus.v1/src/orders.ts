import { findCatalogItem } from './catalog.ts';

export interface Order {
  readonly id: string;
  readonly sku: string;
  readonly quantity: number;
  readonly totalCents: number;
}

export function createOrder(id: string, sku: string, quantity: number): Order {
  const item = findCatalogItem(sku);
  if (!item) throw new Error('unknown catalog sku');
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('invalid quantity');
  return {
    id,
    sku,
    quantity,
    totalCents: item.priceCents * quantity,
  };
}
