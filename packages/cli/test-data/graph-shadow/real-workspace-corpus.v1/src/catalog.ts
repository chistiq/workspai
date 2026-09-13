export interface CatalogItem {
  readonly sku: string;
  readonly title: string;
  readonly priceCents: number;
}

const items: readonly CatalogItem[] = [
  { sku: 'sku-notebook', title: 'Notebook', priceCents: 1299 },
  { sku: 'sku-pencil', title: 'Pencil', priceCents: 199 },
];

export function listCatalog(): readonly CatalogItem[] {
  return items;
}

export function findCatalogItem(sku: string): CatalogItem | undefined {
  return items.find((item) => item.sku === sku);
}
