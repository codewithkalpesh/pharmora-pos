import { Router } from 'express';
import {
  createUser,
  listUsers,
  resetUserPassword,
  setUserStatus,
  updateUser,
} from '../controllers/usersController.js';
import { authorizeRoles, protect } from '../middleware/auth.js';

const router = Router();

// User management endpoints strictly restricted to OWNER
router.use(protect);
router.use(authorizeRoles('OWNER'));

router.get('/', listUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.patch('/:id/status', setUserStatus);
router.post('/:id/reset-password', resetUserPassword);

export default router;
