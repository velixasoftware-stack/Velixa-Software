const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { loginLimiter, signupLimiter } = require('../middleware/rateLimit');
const { chiefAdminLogin, clientUserLogin, selfRegister, changeOwnPassword, logout } = require('../controllers/auth.controller');

router.post('/chief-admin/login', loginLimiter, chiefAdminLogin);
router.post('/login', loginLimiter, clientUserLogin);
// Self sign-up is switched off - new clients are created by Chief Admin only.
router.post('/self-register', (_req, res) => res.status(403).json({ message: 'Self sign-up is not available. Please contact Velixa to create your account.' }));
router.put('/change-password', authenticate, changeOwnPassword);
router.post('/logout', authenticate, logout);

module.exports = router;
