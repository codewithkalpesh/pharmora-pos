import { Router } from 'express';
import { createProduct, getProduct, listProducts, setProductActive, updateProduct } from '../controllers/productsController.js';
import { authorizeRoles, protect } from '../middleware/auth.js';

const router = Router();

router.use(protect);
router.get('/', authorizeRoles('OWNER', 'MANAGER', 'PHARMACIST', 'CASHIER'), listProducts);
router.post('/', authorizeRoles('OWNER', 'MANAGER', 'PHARMACIST'), createProduct);
router.get('/:id', authorizeRoles('OWNER', 'MANAGER', 'PHARMACIST', 'CASHIER'), getProduct);
router.patch('/:id', authorizeRoles('OWNER', 'MANAGER', 'PHARMACIST'), updateProduct);
router.patch('/:id/active', authorizeRoles('OWNER', 'MANAGER', 'PHARMACIST'), setProductActive);

export default router;
