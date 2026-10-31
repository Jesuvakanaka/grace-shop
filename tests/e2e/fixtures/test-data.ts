export const E2E_TEST_DATA = {
  operatingCurrency: 'USD',
  exchangeRateRmbToUsd: 0.1478,
  openingCash: 1000,
  debtorPaymentAmount: 10,
  creditorOpeningAmount: 200,
  creditorPaymentAmount: 80,
  expenseAmount: 150,
  expenseCategory: 'Logistics',
  expensePaidTo: 'Port Authority',
  expenseDescription: 'Import customs clearance fee',
  syntheticProducts: [
    {
      itemNumber: 'P001',
      productName: 'Synthetic Product 001',
      unitCostRmb: 10,
      unitCostUsd: 1.48,
      openingQuantity: 5,
    },
    {
      itemNumber: 'P002',
      productName: 'Synthetic Product 002',
      unitCostRmb: 20,
      unitCostUsd: 2.96,
      openingQuantity: 3,
    },
  ],
};
