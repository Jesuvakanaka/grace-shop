-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" SERIAL NOT NULL,
    "rmbToUsd" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "unitCostRmb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellingPriceRmb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sellingPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openingQuantity" INTEGER NOT NULL DEFAULT 0,
    "currentQuantity" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sourceImportId" INTEGER,
    "sourceFilename" TEXT,
    "sourceSheetName" TEXT,
    "sourceRowNumber" INTEGER,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "movementDate" TIMESTAMP(3) NOT NULL,
    "movementType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "closingBalance" INTEGER NOT NULL DEFAULT 0,
    "referenceType" TEXT,
    "referenceId" INTEGER,
    "notes" TEXT,
    "sourceImportId" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" SERIAL NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "paymentType" TEXT NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" SERIAL NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
    "paidTo" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashPosition" (
    "id" SERIAL NOT NULL,
    "cashDate" TIMESTAMP(3) NOT NULL,
    "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debtorPaymentsReceived" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherCashIn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expensesPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditorPaymentsMade" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedClosingCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualCountedCash" DOUBLE PRECISION,
    "variance" DOUBLE PRECISION,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Debtor" (
    "id" SERIAL NOT NULL,
    "customerName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "totalCreditAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstandingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Debtor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtorTransaction" (
    "id" SERIAL NOT NULL,
    "debtorId" INTEGER NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "transactionType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "referenceType" TEXT,
    "referenceId" INTEGER,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtorTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creditor" (
    "id" SERIAL NOT NULL,
    "creditorName" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "description" TEXT,
    "totalAmountOwed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outstandingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Creditor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditorTransaction" (
    "id" SERIAL NOT NULL,
    "creditorId" INTEGER NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "transactionType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "referenceType" TEXT,
    "referenceId" INTEGER,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditorTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayClosing" (
    "id" SERIAL NOT NULL,
    "closingDate" TIMESTAMP(3) NOT NULL,
    "openingCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCashSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCreditSales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalExpenses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debtorPaymentsReceived" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditorPaymentsMade" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedClosingCash" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualCountedCash" DOUBLE PRECISION,
    "cashVariance" DOUBLE PRECISION,
    "totalItemsSold" INTEGER NOT NULL DEFAULT 0,
    "stockNotes" TEXT,
    "signOffName" TEXT,
    "closingNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "closedBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportDocument" (
    "id" SERIAL NOT NULL,
    "filename" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "importedBy" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "exchangeRateUsed" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" SERIAL NOT NULL,
    "importDocumentId" INTEGER NOT NULL,
    "sheetName" TEXT,
    "rowNumber" INTEGER NOT NULL,
    "detectedRecordType" TEXT,
    "rawData" TEXT,
    "mappedData" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportError" (
    "id" SERIAL NOT NULL,
    "importDocumentId" INTEGER NOT NULL,
    "importRowId" INTEGER,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportError_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Product_itemNumber_key" ON "Product"("itemNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CashPosition_cashDate_key" ON "CashPosition"("cashDate");

-- CreateIndex
CREATE UNIQUE INDEX "DayClosing_closingDate_key" ON "DayClosing"("closingDate");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtorTransaction" ADD CONSTRAINT "DebtorTransaction_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Debtor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditorTransaction" ADD CONSTRAINT "CreditorTransaction_creditorId_fkey" FOREIGN KEY ("creditorId") REFERENCES "Creditor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_importDocumentId_fkey" FOREIGN KEY ("importDocumentId") REFERENCES "ImportDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportError" ADD CONSTRAINT "ImportError_importDocumentId_fkey" FOREIGN KEY ("importDocumentId") REFERENCES "ImportDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportError" ADD CONSTRAINT "ImportError_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "ImportRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

