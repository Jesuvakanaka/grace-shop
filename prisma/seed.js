const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create default admin/owner user
  const existingUser = await prisma.user.findUnique({
    where: { username: 'owner' },
  });

  if (!existingUser) {
    const hashedPassword = await bcrypt.hash('owner123', 10);
    await prisma.user.create({
      data: {
        username: 'owner',
        password: hashedPassword,
        fullName: 'Business Owner',
        role: 'OWNER',
      },
    });
    console.log('Created default owner user: owner / owner123');
  }

  // Create default staff user
  const existingStaff = await prisma.user.findUnique({
    where: { username: 'staff' },
  });

  if (!existingStaff) {
    const hashedPassword = await bcrypt.hash('staff123', 10);
    await prisma.user.create({
      data: {
        username: 'staff',
        password: hashedPassword,
        fullName: 'Shop Staff',
        role: 'STAFF',
      },
    });
    console.log('Created default staff user: staff / staff123');
  }

  // Create default exchange rate (RMB to USD)
  const existingRate = await prisma.exchangeRate.findFirst();

  if (!existingRate) {
    await prisma.exchangeRate.create({
      data: {
        rmbToUsd: 0.14,
        effectiveDate: new Date(),
        notes: 'Default exchange rate - please update with current rate',
        createdBy: 'system',
      },
    });
    console.log('Created default exchange rate: 1 RMB = 0.14 USD');
  }

  // Create some sample expense categories (stored as reference)
  console.log('Expense categories are defined in code: Transport, Food, Utilities, Rent, Supplies, Salary, Communication, Maintenance, Other');

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
