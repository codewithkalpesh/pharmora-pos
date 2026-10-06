import express from 'express';
import cors from 'cors';
import env from './config/env.js';
import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import categoryRoutes from './routes/categories.js';
import productRoutes from './routes/products.js';
import {
  batchRoutes,
  cashbookRoutes,
  customerRoutes,
  expenseRoutes,
  inventoryRoutes,
  paymentRoutes,
  purchaseRoutes,
  saleRoutes,
  stockRoutes,
  supplierRoutes,
  dailySalesRoutes,
  dashboardRoutes,
  purchaseOrderRoutes,
  saleReturnRoutes,
  purchaseReturnRoutes,
  reportRoutes,
  settingsRoutes,
  notificationRoutes,
  whatsappRoutes,
} from './routes/domain.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isAllowed = env.allowedOrigins.some((allowed) => {
        if (allowed === origin) return true;
        try {
          const originUrl = new URL(origin);
          const allowedUrl = new URL(allowed);
          return originUrl.origin === allowedUrl.origin;
        } catch {
          return false;
        }
      });
      if (isAllowed || env.nodeEnv === 'development') {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.json({ app: 'Pharmora POS API', status: 'ok' });
});

app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/cashbook', cashbookRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/daily-sales', dailySalesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/sale-returns', saleReturnRoutes);
app.use('/api/returns/sales', saleReturnRoutes);
app.use('/api/purchase-returns', purchaseReturnRoutes);
app.use('/api/returns/purchases', purchaseReturnRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/whatsapp', whatsappRoutes);

app.use(errorHandler);

export default app;

