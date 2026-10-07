const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { loginLimiter, signupLimiter } = require('../middleware/rateLimit');
const { chiefAdminLogin, clientUserLogin, selfRegister, changeOwnPassword, logout } = require('../controllers/auth.controller');

router.post('/chief-admin/login', loginLimiter, chiefAdminLogin);
router.post('/login', loginLimiter, clientUserLogin);
router.post('/self-register', signupLimiter, selfRegister);
router.put('/change-password', authenticate, changeOwnPassword);
router.post('/logout', authenticate, logout);

module.exports = router;
