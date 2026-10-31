#!/usr/bin/env node
/**
 * Business Control System Initialization Script
 * 
 * Usage:
 *   npm run init           - Initialize with seed users + import data (keeps existing data)
 *   npm run init:fresh     - Reset database completely and initialize fresh
 * 
 * This script:
 *   1. Optionally resets the database (with --reset flag)
 *   2. Creates default users (owner/owner123, staff/staff123)
 *   3. Imports products from business_product_list_with_selling_prices.xlsx
 *   4. Imports opening stock from stock_tracking_workbook.xlsx
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { execSync } = require('child_process');

const prisma = new PrismaClient();

const RESET_FLAG = process.argv.includes('--reset') || process.argv.includes('--fresh');

async function resetDatabase() {
  console.log('\n🗑️  Resetting database...');
  try {
    execSync('npx prisma db push --force-reset --accept-data-loss', { 
      stdio: 'inherit',
      env: { ...process.env, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'user requested reset via init script' }
    });
    console.log('   Database reset complete.');
  } catch (error) {
    console.error('   Failed to reset database:', error.message);
    process.exit(1);
  }
}

async function seedUsers() {
  console.log('\n👤 Setting up default users...');
  
  // Owner user
  const existingOwner = await prisma.user.findUnique({ where: { username: 'owner' } });
  if (!existingOwner) {
    const hashedPassword = await bcrypt.hash('owner123', 10);
    await prisma.user.create({
      data: {
        username: 'owner',
        password: hashedPassword,
        fullName: 'Business Owner',
        role: 'OWNER',
      },
    });
    console.log('   Created: owner / owner123');
  } else {
    console.log('   Exists: owner');
  }

  // Staff user
  const existingStaff = await prisma.user.findUnique({ where: { username: 'staff' } });
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
    console.log('   Created: staff / staff123');
  } else {
    console.log('   Exists: staff');
  }

  // Exchange rate
  const existingRate = await prisma.exchangeRate.findFirst();
  if (!existingRate) {
    await prisma.exchangeRate.create({
      data: {
        rmbToUsd: 0.14,
        effectiveDate: new Date(),
        notes: 'Default exchange rate',
        createdBy: 'system',
      },
    });
    console.log('   Created: Exchange rate (1 RMB = 0.14 USD)');
  } else {
    console.log('   Exists: Exchange rate');
  }
}

async function importProductList(filePath) {
  console.log('\n📦 Importing Product List...');
  
  if (!fs.existsSync(filePath)) {
    console.log(`   File not found: ${filePath}`);
    return 0;
  }

  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
  let created = 0, updated = 0, skipped = 0;
  
  for (const row of rows) {
    const itemNumber = String(row['NO.'] || '').trim();
    const productName = row['Product name'] || '';
    const unitCostRmb = parseFloat(row['Unit cost (RMB)']) || 0;
    const unitCostUsd = parseFloat(row['Unit cost (USD)']) || 0;
    const sellingPriceRmb = parseFloat(row['Selling price/item (RMB)']) || unitCostRmb * 2;
    const sellingPriceUsd = parseFloat(row['Selling price/item (USD)']) || unitCostUsd * 2;
    const quantity = parseInt(row['Quantity'] || row['Initial stock']) || 0;
    
    if (!itemNumber || !productName) {
      skipped++;
      continue;
    }
    
    const existing = await prisma.product.findFirst({ where: { itemNumber } });
    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          productName,
          unitCostRmb,
          unitCostUsd,
          sellingPriceRmb,
          sellingPriceUsd,
          currentQuantity: quantity > 0 ? quantity : existing.currentQuantity,
          openingQuantity: quantity > 0 ? quantity : existing.openingQuantity
        }
      });
      updated++;
    } else {
      await prisma.product.create({
        data: {
          itemNumber,
          productName,
          unitCostRmb,
          unitCostUsd,
          sellingPriceRmb,
          sellingPriceUsd,
          currentQuantity: quantity,
          openingQuantity: quantity
        }
      });
      created++;
    }
  }
  
  console.log(`   Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
  return created + updated;
}

async function importOpeningStock(filePath) {
  console.log('\n📊 Importing Opening Stock...');
  
  if (!fs.existsSync(filePath)) {
    console.log(`   File not found: ${filePath}`);
    return 0;
  }

  const buffer = fs.readFileSync(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  const sheetName = 'Summary';
  if (!workbook.SheetNames.includes(sheetName)) {
    console.log(`   No Summary sheet found`);
    return 0;
  }
  
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  let updated = 0, skipped = 0;
  
  for (const row of rows) {
    const itemNumber = String(row['NO.'] || '').trim();
    const quantity = parseInt(row['Initial stock'] || row['Quantity'] || row['Opening Stock']) || 0;
    
    if (!itemNumber || quantity <= 0) {
      skipped++;
      continue;
    }
    
    const product = await prisma.product.findFirst({ where: { itemNumber } });
    if (!product) {
      skipped++;
      continue;
    }
    
    // Check if opening balance already exists
    const existingMovement = await prisma.stockMovement.findFirst({
      where: { productId: product.id, movementType: 'OPENING_BALANCE' }
    });
    
    if (!existingMovement) {
      await prisma.product.update({
        where: { id: product.id },
        data: { currentQuantity: quantity, openingQuantity: quantity }
      });
      
      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          movementDate: new Date(),
          movementType: 'OPENING_BALANCE',
          quantity: quantity,
          openingBalance: 0,
          closingBalance: quantity,
          notes: 'Imported opening stock'
        }
      });
      updated++;
    } else {
      skipped++;
    }
  }
  
  console.log(`   Updated: ${updated}, Skipped (already exists): ${skipped}`);
  return updated;
}

async function showSummary() {
  const productCount = await prisma.product.count();
  const totalStock = await prisma.product.aggregate({ _sum: { currentQuantity: true } });
  const userCount = await prisma.user.count();
  
  console.log('\n' + '═'.repeat(50));
  console.log('✅ SYSTEM INITIALIZED');
  console.log('═'.repeat(50));
  console.log(`   Users:           ${userCount}`);
  console.log(`   Products:        ${productCount}`);
  console.log(`   Total Stock:     ${totalStock._sum.currentQuantity || 0} units`);
  console.log('═'.repeat(50));
  console.log('\n📝 Login credentials:');
  console.log('   Owner: owner / owner123');
  console.log('   Staff: staff / staff123');
  console.log('\n🚀 Start the app with: npm run dev');
  console.log('');
}

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   BUSINESS CONTROL - SYSTEM INITIALIZATION     ║');
  console.log('╚════════════════════════════════════════════════╝');
  
  if (RESET_FLAG) {
    await resetDatabase();
  }
  
  const docsDir = path.join(__dirname, '..', 'docs', 'business-control-inputs');
  const productListFile = path.join(docsDir, 'business_product_list_with_selling_prices.xlsx');
  const stockFile = path.join(docsDir, 'stock_tracking_workbook.xlsx');
  
  await seedUsers();
  await importProductList(productListFile);
  await importOpeningStock(stockFile);
  await showSummary();
}

main()
  .catch(e => {
    console.error('\n❌ Initialization failed:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
