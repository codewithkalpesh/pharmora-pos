import assert from 'node:assert/strict';
import test from 'node:test';
import { createProduct, listProducts, setProductActive, updateProduct } from '../src/services/productService.js';
import { createCategory, setCategoryActive, updateCategory } from '../src/services/categoryService.js';

const asClient = (client: unknown) => client as never;

const productHarness = (initial: Record<string, unknown> | null = null) => {
  const state = { product: initial, audits: [] as Array<Record<string, unknown>> };
  const client = {
    product: {
      findFirst: async ({ where }: any) => {
        if (!state.product) return null;
        const terms = where.OR ?? [];
        return terms.some((term: any) => (term.barcode && term.barcode === state.product?.barcode) || (term.sku && term.sku === state.product?.sku))
          ? state.product
          : null;
      },
      findUnique: async () => state.product,
      create: async ({ data }: any) => (state.product = { id: 'product-1', createdAt: new Date(), updatedAt: new Date(), ...data }),
      update: async ({ data }: any) => (state.product = { ...state.product, ...data, updatedAt: new Date() }),
      findMany: async () => state.product ? [state.product] : [],
      count: async () => state.product ? 1 : 0,
    },
    category: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: 'category-1', active: true, ...data }),
      update: async ({ data }: any) => ({ id: 'category-1', ...data }),
    },
    supplier: { findUnique: async () => null },
    auditLog: { create: async ({ data }: any) => { const row = { id: `audit-${state.audits.length + 1}`, ...data }; state.audits.push(row); return row; } },
  };
  return { client: asClient(client), state };
};

test('product create preserves exact decimal values and emits an audit record', async () => {
  const { client, state } = productHarness();
  const product = await createProduct({ name: 'Paracetamol', mrp: '99.99', sellingPrice: '149.50', purchasePrice: '1299.75' }, client, 'user-1');
  assert.equal((product as any).mrp.toFixed(2), '99.99');
  assert.equal((product as any).sellingPrice.toFixed(2), '149.50');
  assert.equal((product as any).purchasePrice.toFixed(2), '1299.75');
  assert.equal(state.audits[0]?.action, 'PRODUCT_CREATED');
});

test('product update records audit and updates searchable fields', async () => {
  const initial = { id: 'product-1', name: 'Tablet', genericName: null, brand: null, barcode: null, sku: null, hsn: null, gst: null, mrp: null, sellingPrice: null, purchasePrice: null, minStock: 0, maxStock: null, reorderLevel: 0, rackLocation: null, categoryId: null, supplierId: null, active: true };
  const { client, state } = productHarness(initial);
  await updateProduct('product-1', { name: 'New tablet', brand: 'North' }, client, 'user-1');
  assert.equal(state.product?.name, 'New tablet');
  assert.equal(state.product?.brand, 'North');
  assert.equal(state.audits[0]?.action, 'PRODUCT_UPDATED');
});

test('product list searches by brand as well as other indexed identity fields', async () => {
  let captured: any;
  const client = asClient({
    product: {
      findMany: async (args: any) => { captured = args; return []; },
      count: async () => 0,
    },
  });
  await listProducts('Northstar', client);
  assert.ok(captured.where.OR.some((term: any) => term.brand?.contains === 'Northstar'));
});

test('duplicate barcode and SKU are rejected before create', async () => {
  const barcode = productHarness({ id: 'existing', barcode: '0001', sku: 'A-1' });
  await assert.rejects(() => createProduct({ name: 'Duplicate barcode', barcode: '0001' }, barcode.client));
  const sku = productHarness({ id: 'existing', barcode: '0001', sku: 'A-1' });
  await assert.rejects(() => createProduct({ name: 'Duplicate SKU', sku: 'A-1' }, sku.client));
});

test('product activation changes are audited', async () => {
  const initial = { id: 'product-1', name: 'Tablet', genericName: null, brand: null, barcode: null, sku: null, hsn: null, gst: null, mrp: null, sellingPrice: null, purchasePrice: null, minStock: 0, maxStock: null, reorderLevel: 0, rackLocation: null, categoryId: null, supplierId: null, active: true };
  const { client, state } = productHarness(initial);
  await setProductActive('product-1', false, client, 'user-1');
  assert.equal(state.product?.active, false);
  assert.equal(state.audits[0]?.action, 'PRODUCT_DEACTIVATED');
});

test('category duplicate name check is case insensitive and categories deactivate without deletion', async () => {
  let created = false;
  const client = asClient({
    category: {
      findFirst: async ({ where }: any) => where.id?.not ? null : ({ id: 'existing' }),
      findUnique: async () => ({ id: 'category-1', name: 'Pain', active: true }),
      create: async () => { created = true; return { id: 'new' }; },
      update: async ({ data }: any) => ({ id: 'category-1', name: 'Pain', ...data }),
    },
    auditLog: { create: async ({ data }: any) => data },
  });
  await assert.rejects(() => createCategory({ name: 'pain' }, client));
  assert.equal(created, false);
  const archived = await setCategoryActive('category-1', false, client, 'user-1');
  assert.equal((archived as any).active, false);
  await updateCategory('category-1', { name: 'Pain Relief' }, client, 'user-1');
});
