import { Router } from 'express';
import { protect, authorizeRoles } from '../middleware/auth.js';
import * as controller from '../controllers/domainController.js';

const managers = ['OWNER', 'MANAGER'];
const inventoryManagers = ['OWNER', 'MANAGER', 'PHARMACIST'];
const viewers = ['OWNER', 'MANAGER', 'PHARMACIST', 'CASHIER'];

export const batchRoutes = Router();
batchRoutes.use(protect);
batchRoutes.get('/dashboard', authorizeRoles(...viewers), controller.getExpiryDashboard);
batchRoutes.get('/expired', authorizeRoles(...inventoryManagers), controller.listExpiredBatches);
batchRoutes.get('/near-expiry', authorizeRoles(...inventoryManagers), controller.listNearExpiryBatches);
batchRoutes.get('/product/:productId', authorizeRoles(...viewers), controller.listBatches);
batchRoutes.post('/', authorizeRoles(...inventoryManagers), controller.createBatch);
batchRoutes.patch('/:id', authorizeRoles(...inventoryManagers), controller.updateBatch);

export const stockRoutes = Router();
stockRoutes.use(protect);
stockRoutes.get('/movements', authorizeRoles(...viewers), controller.listStockMovements);
stockRoutes.post('/adjustments', authorizeRoles(...inventoryManagers), controller.adjustStock);
stockRoutes.post('/damage', authorizeRoles(...inventoryManagers), controller.recordDamage);
stockRoutes.post('/expiry', authorizeRoles(...inventoryManagers), controller.recordExpiry);
stockRoutes.post('/returns', authorizeRoles(...inventoryManagers), controller.recordReturn);

export const inventoryRoutes = Router();
inventoryRoutes.use(protect);
inventoryRoutes.get('/', authorizeRoles(...viewers), controller.listInventory);
inventoryRoutes.get('/low-stock', authorizeRoles(...viewers), controller.listLowStockInventory);
inventoryRoutes.get('/out-of-stock', authorizeRoles(...viewers), controller.listOutOfStockInventory);
inventoryRoutes.get('/expiry', authorizeRoles(...viewers), controller.listExpiryInventory);
inventoryRoutes.get('/products/:id/stock-summary', authorizeRoles(...viewers), controller.getProductStockSummary);
inventoryRoutes.get('/products/:id/fefo', authorizeRoles(...viewers), controller.getFefoAvailability);
inventoryRoutes.post('/adjustments', authorizeRoles(...inventoryManagers), controller.adjustInventoryStock);

export const supplierRoutes = Router();
supplierRoutes.use(protect);
supplierRoutes.get('/', authorizeRoles(...viewers), controller.listSuppliers);
supplierRoutes.post('/', authorizeRoles(...managers), controller.createSupplier);
supplierRoutes.get('/:id', authorizeRoles(...viewers), controller.getSupplier);
supplierRoutes.patch('/:id', authorizeRoles(...managers), controller.updateSupplier);

export const purchaseRoutes = Router();
purchaseRoutes.use(protect);
purchaseRoutes.get('/', authorizeRoles(...viewers), controller.listPurchases);
purchaseRoutes.post('/', authorizeRoles(...inventoryManagers), controller.createPurchase);
purchaseRoutes.get('/:id', authorizeRoles(...viewers), controller.getPurchase);

export const customerRoutes = Router();
customerRoutes.use(protect);
customerRoutes.get('/', authorizeRoles(...viewers), controller.listCustomers);
customerRoutes.post('/', authorizeRoles(...viewers), controller.createCustomer);
customerRoutes.get('/:id', authorizeRoles(...viewers), controller.getCustomer);
customerRoutes.patch('/:id', authorizeRoles(...viewers), controller.updateCustomer);

export const saleRoutes = Router();
saleRoutes.use(protect);
saleRoutes.get('/', authorizeRoles(...viewers), controller.listSales);
saleRoutes.post('/', authorizeRoles(...viewers), controller.createSale);
saleRoutes.get('/:id', authorizeRoles(...viewers), controller.getSale);
saleRoutes.get('/:id/receipt', authorizeRoles(...viewers), controller.getSaleReceipt);
saleRoutes.get('/:id/invoice-pdf', authorizeRoles(...viewers), controller.getSaleInvoicePdf);

export const settingsRoutes = Router();
settingsRoutes.use(protect);
settingsRoutes.get('/store', authorizeRoles(...viewers), controller.getStoreSettings);
settingsRoutes.put('/store', authorizeRoles(...managers), controller.updateStoreSettings);

export const paymentRoutes = Router();
paymentRoutes.use(protect);
paymentRoutes.get('/', authorizeRoles(...viewers), controller.listPayments);
paymentRoutes.get('/:id', authorizeRoles(...viewers), controller.getPayment);
paymentRoutes.post('/sales/:saleId', authorizeRoles(...viewers), controller.recordSalePayment);
paymentRoutes.post('/customers/:customerId', authorizeRoles(...viewers), controller.recordCustomerPayment);
paymentRoutes.post('/suppliers/:supplierId/purchases/:purchaseId', authorizeRoles(...inventoryManagers), controller.recordSupplierPayment);

export const cashbookRoutes = Router();
cashbookRoutes.use(protect);
cashbookRoutes.get('/balances', authorizeRoles(...viewers), controller.getCashbookBalances);
cashbookRoutes.get('/position', authorizeRoles(...viewers), controller.getCashbookBalances);
cashbookRoutes.get('/summary', authorizeRoles(...viewers), controller.getCashbookSummary);
cashbookRoutes.get('/opening', authorizeRoles(...viewers), controller.getOpeningCash);
cashbookRoutes.put('/opening', authorizeRoles(...managers), controller.setOpeningCash);
cashbookRoutes.get('/closing', authorizeRoles(...viewers), controller.getDailyClosing);
cashbookRoutes.post('/closing', authorizeRoles(...managers), controller.createDailyClosing);
cashbookRoutes.get('/', authorizeRoles(...viewers), controller.listCashbookEntries);
cashbookRoutes.post('/adjustments', authorizeRoles(...managers), controller.createCashbookAdjustment);
cashbookRoutes.post('/transfers', authorizeRoles(...managers), controller.transferCashAndBank);

export const expenseRoutes = Router();
expenseRoutes.use(protect);
expenseRoutes.get('/categories', authorizeRoles(...viewers), controller.listExpenseCategories);
expenseRoutes.get('/', authorizeRoles(...viewers), controller.listExpenses);
expenseRoutes.post('/', authorizeRoles(...managers), controller.createExpense);

export const dailySalesRoutes = Router();
dailySalesRoutes.use(protect);
dailySalesRoutes.get('/reconciliation', authorizeRoles(...viewers), controller.getDailySalesReconciliation);
dailySalesRoutes.get('/date', authorizeRoles(...viewers), controller.getDailySaleForDate);
dailySalesRoutes.get('/:id', authorizeRoles(...viewers), controller.getDailySale);
dailySalesRoutes.post('/', authorizeRoles(...managers), controller.createDailySales);
dailySalesRoutes.patch('/:id', authorizeRoles(...managers), controller.updateDailySales);

export const dashboardRoutes = Router();
dashboardRoutes.use(protect);
dashboardRoutes.get('/summary', authorizeRoles(...viewers), controller.getDashboardSummary);

export const purchaseOrderRoutes = Router();
purchaseOrderRoutes.use(protect);
purchaseOrderRoutes.get('/purchase-list', authorizeRoles(...viewers), controller.getPurchaseList);
purchaseOrderRoutes.get('/', authorizeRoles(...viewers), controller.listPurchaseOrders);
purchaseOrderRoutes.post('/', authorizeRoles(...inventoryManagers), controller.createPurchaseOrder);
purchaseOrderRoutes.get('/:id', authorizeRoles(...viewers), controller.getPurchaseOrder);
purchaseOrderRoutes.patch('/:id', authorizeRoles(...inventoryManagers), controller.updatePurchaseOrder);
purchaseOrderRoutes.patch('/:id/status', authorizeRoles(...inventoryManagers), controller.updatePurchaseOrderStatus);
purchaseOrderRoutes.post('/:id/cancel', authorizeRoles(...inventoryManagers), controller.cancelPurchaseOrder);
purchaseOrderRoutes.post('/:id/reorder', authorizeRoles(...inventoryManagers), controller.reorderPurchaseOrder);
purchaseOrderRoutes.get('/:id/text', authorizeRoles(...viewers), controller.getPurchaseOrderText);

export const saleReturnRoutes = Router();
saleReturnRoutes.use(protect);
saleReturnRoutes.get('/', authorizeRoles(...viewers), controller.listSaleReturns);
saleReturnRoutes.post('/', authorizeRoles(...viewers), controller.createSaleReturn);
saleReturnRoutes.get('/:id', authorizeRoles(...viewers), controller.getSaleReturn);

export const purchaseReturnRoutes = Router();
purchaseReturnRoutes.use(protect);
purchaseReturnRoutes.get('/', authorizeRoles(...viewers), controller.listPurchaseReturns);
purchaseReturnRoutes.post('/', authorizeRoles(...inventoryManagers), controller.createPurchaseReturn);
purchaseReturnRoutes.get('/:id', authorizeRoles(...viewers), controller.getPurchaseReturn);

export const reportRoutes = Router();
reportRoutes.use(protect);
reportRoutes.get('/sales', authorizeRoles(...viewers), controller.getSalesReport);
reportRoutes.get('/purchases', authorizeRoles(...viewers), controller.getPurchaseReport);
reportRoutes.get('/expenses', authorizeRoles(...viewers), controller.getExpenseReport);
reportRoutes.get('/cashbook', authorizeRoles(...viewers), controller.getCashbookReport);
reportRoutes.get('/profit', authorizeRoles(...managers), controller.getProfitReport);
reportRoutes.get('/gst', authorizeRoles(...managers), controller.getGstReport);
reportRoutes.get('/inventory-valuation', authorizeRoles(...viewers), controller.getInventoryValuationReport);
reportRoutes.get('/customer-outstanding', authorizeRoles(...viewers), controller.getCustomerOutstandingReport);
reportRoutes.get('/supplier-outstanding', authorizeRoles(...viewers), controller.getSupplierOutstandingReport);
reportRoutes.get('/products', authorizeRoles(...viewers), controller.getProductAnalyticsReport);
reportRoutes.get('/categories', authorizeRoles(...viewers), controller.getCategoryAnalyticsReport);
reportRoutes.get('/target', authorizeRoles(...viewers), controller.getMonthlyTargetReport);
reportRoutes.post('/target', authorizeRoles(...managers), controller.setMonthlyTarget);

export const notificationRoutes = Router();
notificationRoutes.use(protect);
notificationRoutes.get('/telegram/status', authorizeRoles(...viewers), controller.getTelegramStatus);
notificationRoutes.put('/telegram/config', authorizeRoles(...managers), controller.updateTelegramConfig);
notificationRoutes.post('/telegram/test', authorizeRoles(...managers), controller.testTelegramConnection);
notificationRoutes.post('/telegram/daily-summary', authorizeRoles(...managers), controller.triggerDailySummary);
notificationRoutes.post('/telegram/monthly-summary', authorizeRoles(...managers), controller.triggerMonthlySummary);
notificationRoutes.post('/telegram/low-stock', authorizeRoles(...managers), controller.triggerLowStockAlert);
notificationRoutes.post('/telegram/expiry', authorizeRoles(...managers), controller.triggerExpiryAlert);
notificationRoutes.post('/telegram/customer-dues', authorizeRoles(...managers), controller.triggerCustomerDuesAlert);
notificationRoutes.post('/telegram/supplier-dues', authorizeRoles(...managers), controller.triggerSupplierDuesAlert);
notificationRoutes.get('/history', authorizeRoles(...viewers), controller.listNotificationHistory);

export const whatsappRoutes = Router();
whatsappRoutes.use(protect);
whatsappRoutes.get('/invoice/:saleId', authorizeRoles(...viewers), controller.getWhatsAppInvoice);
whatsappRoutes.get('/payment/:paymentId', authorizeRoles(...viewers), controller.getWhatsAppPaymentReceipt);
whatsappRoutes.get('/due-reminder/:customerId', authorizeRoles(...viewers), controller.getWhatsAppDueReminder);
whatsappRoutes.get('/purchase-order/:orderId', authorizeRoles(...viewers), controller.getWhatsAppPurchaseOrder);



