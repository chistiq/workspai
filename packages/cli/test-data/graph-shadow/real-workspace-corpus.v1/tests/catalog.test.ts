import assert from 'node:assert/strict';
import { findCatalogItem, listCatalog } from '../src/catalog.ts';

assert.equal(listCatalog().length, 2);
assert.equal(findCatalogItem('sku-pencil')?.title, 'Pencil');
assert.equal(findCatalogItem('missing'), undefined);
