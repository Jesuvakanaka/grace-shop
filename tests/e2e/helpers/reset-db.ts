import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

export async function resetDatabase() {
  console.log('Resetting database for E2E tests...');
  
  // Disable foreign keys checks if needed, but in SQLite we can just delete in topological order
  await prisma.$transaction([
    prisma.stockMovement.deleteMany(),
    prisma.saleItem.deleteMany(),
    prisma.sale.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.debtorTransaction.deleteMany(),
    prisma.debtor.deleteMany(),
    prisma.creditorTransaction.deleteMany(),
    prisma.creditor.deleteMany(),
    prisma.dayClosing.deleteMany(),
    prisma.importError.deleteMany(),
    prisma.importRow.deleteMany(),
    prisma.importDocument.deleteMany(),
    prisma.product.deleteMany(),
    prisma.exchangeRate.deleteMany(),
    prisma.user.deleteMany()
  ]);

  // Seed default owner
  const hashedOwnerPassword = await bcrypt.hash('owner123', 10);
  await prisma.user.create({
    data: {
      username: 'owner',
      password: hashedOwnerPassword,
      fullName: 'Business Owner',
      role: 'OWNER',
    },
  });

  // Seed default staff
  const hashedStaffPassword = await bcrypt.hash('staff123', 10);
  await prisma.user.create({
    data: {
      username: 'staff',
      password: hashedStaffPassword,
      fullName: 'Shop Staff',
      role: 'STAFF',
    },
  });

  // Seed default exchange rate
  await prisma.exchangeRate.create({
    data: {
      rmbToUsd: 0.14,
      effectiveDate: new Date(),
      notes: 'Initial seed exchange rate',
      createdBy: 'system',
    },
  });

  console.log('Database reset and re-seeded successfully.');
}

// Allow direct execution
if (require.main === module) {
  resetDatabase()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
