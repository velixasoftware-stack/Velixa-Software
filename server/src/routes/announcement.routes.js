const router = require('express').Router();
const { authenticate, requireChiefAdminScreen } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/announcement.controller');

// Public: the client login page reads this before anyone has signed in.
router.get('/active', ctrl.listActive);

// Managing captions is Chief Admin (ADMIN role) only.
// ADMIN, or a sales role given the Login Captions screen.
router.use(authenticate, requireChiefAdminScreen('announcements'));
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
