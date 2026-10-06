import assert from 'node:assert/strict';
import test from 'node:test';
import { createUUID } from '../../client/src/utils/uuid.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('createUUID generates valid v4 UUID format in normal environment', () => {
  const uuid = createUUID();
  assert.match(uuid, UUID_V4_REGEX, `Expected valid UUID v4 format, got: ${uuid}`);
});

test('createUUID generates unique IDs on repeated calls', () => {
  const ids = new Set<string>();
  const count = 1000;
  for (let i = 0; i < count; i++) {
    const id = createUUID();
    assert.match(id, UUID_V4_REGEX);
    ids.add(id);
  }
  assert.equal(ids.size, count, 'Generated IDs should all be distinct');
});

test('createUUID works when crypto.randomUUID is undefined (e.g. LAN HTTP context with getRandomValues)', () => {
  const originalCrypto = globalThis.crypto;
  try {
    // Simulate browser without crypto.randomUUID but with crypto.getRandomValues
    const mockCrypto = {
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (originalCrypto?.getRandomValues) {
          return originalCrypto.getRandomValues(array);
        }
        if (array && 'length' in array) {
          const u8 = array as unknown as Uint8Array;
          for (let i = 0; i < u8.length; i++) {
            u8[i] = Math.floor(Math.random() * 256);
          }
        }
        return array;
      },
    } as unknown as Crypto;

    Object.defineProperty(globalThis, 'crypto', {
      value: mockCrypto,
      configurable: true,
      writable: true,
    });

    const uuid = createUUID();
    assert.match(uuid, UUID_V4_REGEX, `Expected valid UUID v4 format from getRandomValues fallback, got: ${uuid}`);

    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = createUUID();
      assert.match(id, UUID_V4_REGEX);
      ids.add(id);
    }
    assert.equal(ids.size, 100, 'getRandomValues fallback should produce distinct IDs');
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  }
});

test('createUUID works when crypto is completely undefined or empty (HTTP legacy/restricted fallback)', () => {
  const originalCrypto = globalThis.crypto;
  try {
    // Simulate browser environment where crypto is undefined or has no crypto functions
    Object.defineProperty(globalThis, 'crypto', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const uuid = createUUID();
    assert.match(uuid, UUID_V4_REGEX, `Expected valid UUID v4 format from Math.random fallback, got: ${uuid}`);

    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = createUUID();
      assert.match(id, UUID_V4_REGEX);
      ids.add(id);
    }
    assert.equal(ids.size, 100, 'Math.random fallback should produce distinct IDs');
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
      writable: true,
    });
  }
});
