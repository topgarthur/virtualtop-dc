function adminOk(req) {
  const key = process.env.ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== 'production';
  const got = req.get('x-admin-key') || req.query.admin || (req.body && req.body.adminKey);
  return Boolean(got && got === key);
}

function requireAdmin(req, res, next) {
  if (adminOk(req)) return next();
  return res.status(403).json({
    error: 'ERR_ADMIN',
    message: 'That action is locked on the public host.',
  });
}

module.exports = { adminOk, requireAdmin };
