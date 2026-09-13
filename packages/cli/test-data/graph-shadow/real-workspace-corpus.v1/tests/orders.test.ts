import assert from 'node:assert/strict';
import { createOrder } from '../src/orders.ts';

const order = createOrder('order-1', 'sku-notebook', 2);
assert.equal(order.totalCents, 2598);
assert.throws(() => createOrder('order-2', 'missing', 1));
