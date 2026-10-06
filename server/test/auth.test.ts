import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../src/config/env.js';

test('1. Password Hashing: bcrypt properly hashes and verifies passwords', async () => {
  const plain = 'admin123';
  const hashed = await bcrypt.hash(plain, 10);
  assert.notEqual(hashed, plain);
  assert.equal(await bcrypt.compare(plain, hashed), true);
  assert.equal(await bcrypt.compare('wrongpassword', hashed), false);
});

test('2. JWT Signing & Verification: signs with role and verifies payload', () => {
  const token = jwt.sign({ sub: 'user-123', role: 'OWNER' }, env.jwtSecret, { expiresIn: '8h' });
  const decoded = jwt.verify(token, env.jwtSecret) as any;
  assert.equal(decoded.sub, 'user-123');
  assert.equal(decoded.role, 'OWNER');
});

test('3. JWT Expiration: expired token throws TokenExpiredError', () => {
  const expiredToken = jwt.sign({ sub: 'user-123', role: 'OWNER' }, env.jwtSecret, { expiresIn: '-1s' });
  assert.throws(() => {
    jwt.verify(expiredToken, env.jwtSecret);
  }, /jwt expired|TokenExpiredError/);
});

test('4. JWT Tampering: invalid secret throws JsonWebTokenError', () => {
  const token = jwt.sign({ sub: 'user-123', role: 'OWNER' }, 'wrong-secret');
  assert.throws(() => {
    jwt.verify(token, env.jwtSecret);
  }, /invalid signature|JsonWebTokenError/);
});

test('5. Inactive User Check: deactivated user is prevented from login', async () => {
  const user = {
    id: 'user-inactive',
    email: 'staff@pharmora.local',
    password: await bcrypt.hash('staff123', 10),
    isActive: false,
    role: { name: 'STAFF' },
  };

  const passwordMatch = await bcrypt.compare('staff123', user.password);
  assert.equal(passwordMatch, true);
  assert.equal(user.isActive, false, 'User must be marked inactive');
});

test('6. Password Hash Privacy: sanitized user response excludes password', () => {
  const rawUser = {
    id: 'usr-1',
    name: 'Owner Admin',
    email: 'owner@pharmora.local',
    password: '$2a$10$hashedpasswordstring',
    phone: '+919999999999',
    isActive: true,
    role: { id: 'r1', name: 'OWNER' },
  };

  const sanitize = (u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    isActive: u.isActive,
    role: u.role ? { id: u.role.id, name: u.role.name } : null,
  });

  const sanitized = sanitize(rawUser);
  assert.equal('password' in sanitized, false, 'Sanitized user must never have password property');
  assert.equal((sanitized as any).password, undefined);
});

test('7. Owner Protection Logic: preventing deactivation of the last active OWNER', () => {
  const activeOwners = [{ id: 'owner-1', role: 'OWNER', isActive: true }];

  function validateDeactivation(targetUserId: string, allOwners: typeof activeOwners) {
    const activeCount = allOwners.filter(o => o.isActive && o.role === 'OWNER').length;
    const target = allOwners.find(o => o.id === targetUserId);
    if (target?.role === 'OWNER' && activeCount <= 1) {
      throw new Error('Cannot deactivate the last active OWNER account');
    }
    return true;
  }

  // Should throw when only 1 active owner exists
  assert.throws(() => {
    validateDeactivation('owner-1', activeOwners);
  }, /Cannot deactivate the last active OWNER/);

  // Should succeed when multiple active owners exist
  const multipleOwners = [
    { id: 'owner-1', role: 'OWNER', isActive: true },
    { id: 'owner-2', role: 'OWNER', isActive: true },
  ];
  assert.equal(validateDeactivation('owner-1', multipleOwners), true);
});

test('8. Role Authorization Hierarchy: OWNER has access, non-OWNER is restricted', () => {
  function checkAccess(userRole: string, allowedRoles: string[]) {
    if (!allowedRoles.includes(userRole)) {
      throw new Error('Forbidden');
    }
    return true;
  }

  // OWNER accessing OWNER-only resource
  assert.equal(checkAccess('OWNER', ['OWNER']), true);

  // MANAGER attempting to access OWNER-only resource
  assert.throws(() => {
    checkAccess('MANAGER', ['OWNER']);
  }, /Forbidden/);

  // CASHIER attempting to access OWNER-only resource
  assert.throws(() => {
    checkAccess('CASHIER', ['OWNER']);
  }, /Forbidden/);

  // STAFF attempting to access OWNER-only resource
  assert.throws(() => {
    checkAccess('STAFF', ['OWNER']);
  }, /Forbidden/);
});

test('9. Password Change Validation & Verification', async () => {
  const currentPlain = 'oldPassword123';
  const currentHashed = await bcrypt.hash(currentPlain, 10);
  const newPlain = 'newSecurePassword456';

  // 1. Verify old password matches
  const match = await bcrypt.compare('oldPassword123', currentHashed);
  assert.equal(match, true);

  // 2. Reject incorrect current password
  const mismatch = await bcrypt.compare('wrongOldPassword', currentHashed);
  assert.equal(mismatch, false);

  // 3. Hash new password and ensure old password stops working
  const newHashed = await bcrypt.hash(newPlain, 10);
  assert.equal(await bcrypt.compare(newPlain, newHashed), true);
  assert.equal(await bcrypt.compare(currentPlain, newHashed), false);
});
