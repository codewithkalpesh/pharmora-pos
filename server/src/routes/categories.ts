import { Router } from 'express';
import { createCategory, listCategories, setCategoryActive, updateCategory } from '../controllers/categoriesController.js';
import { authorizeRoles, protect } from '../middleware/auth.js';

const router = Router();

router.use(protect);
router.get('/', authorizeRoles('OWNER', 'MANAGER', 'PHARMACIST'), listCategories);
router.post('/', authorizeRoles('OWNER', 'MANAGER'), createCategory);
router.patch('/:id', authorizeRoles('OWNER', 'MANAGER'), updateCategory);
router.patch('/:id/active', authorizeRoles('OWNER', 'MANAGER'), setCategoryActive);

export default router;
