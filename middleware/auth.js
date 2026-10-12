function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).render('error', {
    user: req.session.user || null,
    code: 403,
    message: "You don't have permission to view this page.",
  });
}

function requireSolutionAccess(solutionId) {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    if (user.role === 'admin' || (user.solutions || []).includes(solutionId)) return next();
    return res.status(403).render('error', {
      user,
      code: 403,
      message: "You don't have access to this solution yet. Ask your admin to grant it.",
    });
  };
}

module.exports = { requireLogin, requireAdmin, requireSolutionAccess };
