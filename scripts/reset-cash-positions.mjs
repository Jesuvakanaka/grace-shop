import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const deleted = await prisma.cashPosition.deleteMany();
console.log(`Deleted ${deleted.count} cash position record(s).`);

await prisma.$disconnect();
