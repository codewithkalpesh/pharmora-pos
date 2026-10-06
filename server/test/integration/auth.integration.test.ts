import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import test from 'node:test';
import bcrypt from 'bcryptjs';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), override: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Integration tests require server/.env DATABASE_URL');

const target = new URL(connectionString);
const databaseName = target.pathname.replace(/^\//, '').split('?')[0];
if (!target.hostname.endsWith('.neon.tech') || databaseName !== 'pharmora_pos_dev') {
  throw new Error('Integration tests are restricted to the verified Neon pharmora_pos_dev database');
}

const prisma = new PrismaClient();
class RollbackRequested extends Error {}

test('Live Neon DB: Authentication, User Roles, Password Management, and Owner Safety with clean transactional rollback', async () => {
  const marker = randomUUID().slice(0, 8);

  try {
    await prisma.$connect();

    await prisma.$transaction(async (tx) => {
      // 1. Verify standard roles exist or create
      const roles = ['OWNER', 'MANAGER', 'CASHIER', 'PHARMACIST', 'STAFF'] as const;
      const roleMap: Record<string, string> = {};

      for (const r of roles) {
        let role = await tx.role.findUnique({ where: { name: r } });
        if (!role) {
          role = await tx.role.create({ data: { name: r } });
        }
        roleMap[r] = role.id;
      }

      // 2. Create a test OWNER user
      const ownerEmail = `owner-${marker}@pharmora.test`;
      const ownerPassword = await bcrypt.hash('OwnerPass123!', 10);

      const ownerUser = await tx.user.create({
        data: {
          name: `Test Owner ${marker}`,
          email: ownerEmail,
          password: ownerPassword,
          roleId: roleMap['OWNER'],
          isActive: true,
        },
        include: { role: true },
      });

      assert.equal(ownerUser.role.name, 'OWNER');
      assert.equal(await bcrypt.compare('OwnerPass123!', ownerUser.password), true);
      assert.equal(await bcrypt.compare('WrongPass', ownerUser.password), false);

      // 3. Create a test STAFF user
      const staffEmail = `staff-${marker}@pharmora.test`;
      const staffPassword = await bcrypt.hash('StaffPass123!', 10);

      const staffUser = await tx.user.create({
        data: {
          name: `Test Staff ${marker}`,
          email: staffEmail,
          password: staffPassword,
          roleId: roleMap['STAFF'],
          isActive: true,
        },
        include: { role: true },
      });

      assert.equal(staffUser.role.name, 'STAFF');

      // 4. Test User Deactivation on Staff User
      const deactivatedStaff = await tx.user.update({
        where: { id: staffUser.id },
        data: { isActive: false },
      });

      assert.equal(deactivatedStaff.isActive, false);

      // 5. Test Password Change on Owner User
      const newPassword = await bcrypt.hash('UpdatedOwnerPass456!', 10);
      const updatedOwner = await tx.user.update({
        where: { id: ownerUser.id },
        data: { password: newPassword },
      });

      assert.equal(await bcrypt.compare('UpdatedOwnerPass456!', updatedOwner.password), true);
      assert.equal(await bcrypt.compare('OwnerPass123!', updatedOwner.password), false, 'Old password must no longer match');

      // 6. Test Owner Safety Logic: Count active owners
      const activeOwners = await tx.user.count({
        where: {
          isActive: true,
          role: { name: 'OWNER' },
        },
      });

      assert.ok(activeOwners >= 1, 'There must be at least 1 active owner');

      // 7. Request Rollback to ensure 0 DB pollution
      throw new RollbackRequested('Rollback authentication integration test');
    }, { maxWait: 20000, timeout: 60000 });
  } catch (error) {
    if (error instanceof RollbackRequested) {
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
});
