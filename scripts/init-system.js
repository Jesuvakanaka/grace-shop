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
const OWNER_USERNAME = process.env.GRACE_OWNER_USERNAME || 'owner';

async function resetDatabase() {
  // Refuse BEFORE touching the database unless it is a local, non-production DB.
  // (scripts/lib/db-safety.js exits non-zero and prints the reason when refused.)
  try {
    execSync(`node "${path.join(__dirname, 'lib', 'db-safety.js')}" "init:fresh (database reset)"`, {
      stdio: 'inherit',
    });
  } catch {
    process.exit(1);
  }

  console.log('\n🗑️  Resetting database (drop + re-apply prisma/migrations)...');
  try {
    execSync('npx prisma migrate reset --force --skip-seed', {
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

  // Passwords come from the environment (UAT/production: Secret Manager).
  // NODE_ENV=production: both are required and must be >= 12 chars, otherwise we
  // stop before creating anything. Elsewhere we fall back to the local dev/e2e
  // defaults with a warning. Passwords are never printed.
  const MIN_SEED_PASSWORD_LENGTH = 12;
  const isProduction = process.env.NODE_ENV === 'production';
  const seedPasswords = {};
  const problems = [];
  for (const [username, envVar, devDefault] of [
    ['owner', 'GRACE_OWNER_PASSWORD', 'owner123'],
    ['staff', 'GRACE_STAFF_PASSWORD', 'staff123'],
  ]) {
    const value = process.env[envVar];
    if (value) {
      if (isProduction && value.length < MIN_SEED_PASSWORD_LENGTH) {
        problems.push(`${envVar} must be at least ${MIN_SEED_PASSWORD_LENGTH} characters`);
      }
      seedPasswords[username] = value;
    } else if (isProduction) {
      problems.push(`${envVar} is required when NODE_ENV=production`);
    } else {
      console.warn(`   ⚠️  ${envVar} not set - using the local development default password for '${username}'. Do not use this outside local development.`);
      seedPasswords[username] = devDefault;
    }
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to seed users: ${problems.join('; ')}`);
  }

  // Owner user (UAT seeds margie / Margaret via GRACE_OWNER_USERNAME / GRACE_OWNER_FULLNAME)
  const ownerUsername = OWNER_USERNAME;
  const existingOwner = await prisma.user.findUnique({ where: { username: ownerUsername } });
  if (!existingOwner) {
    const hashedPassword = await bcrypt.hash(seedPasswords.owner, 10);
    await prisma.user.create({
      data: {
        username: ownerUsername,
        password: hashedPassword,
        fullName: process.env.GRACE_OWNER_FULLNAME || 'Business Owner',
        role: 'OWNER',
      },
    });
    console.log(`   Created: ${ownerUsername}`);
  } else {
    console.log(`   Exists: ${ownerUsername}`);
  }

  // Staff user
  const existingStaff = await prisma.user.findUnique({ where: { username: 'staff' } });
  if (!existingStaff) {
    const hashedPassword = await bcrypt.hash(seedPasswords.staff, 10);
    await prisma.user.create({
      data: {
        username: 'staff',
        password: hashedPassword,
        fullName: 'Shop Staff',
        role: 'STAFF',
      },
    });
    console.log('   Created: staff');
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
  console.log(`\n📝 Login users: ${OWNER_USERNAME} (OWNER), staff (STAFF)`);
  console.log('   Passwords: set via GRACE_OWNER_PASSWORD / GRACE_STAFF_PASSWORD (local dev defaults if unset outside production); never printed');
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
