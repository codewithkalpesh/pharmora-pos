import { Router } from 'express';
import { changePassword, getMe, login, logout, signup } from '../controllers/authController.js';
import { protect } from '../middleware/auth.js';

const router = Router();

router.post('/signup', signup);
router.post('/login', login);
router.get('/me', protect, getMe);
router.post('/change-password', protect, changePassword);
router.post('/logout', protect, logout);

export default router;
