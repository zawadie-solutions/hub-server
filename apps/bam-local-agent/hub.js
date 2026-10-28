// Entry used by the Zawadie hub (hub-server/server.js): returns this app for the hub to mount at
// /bam-local-agent, running in the hub's own process instead of as a separate proxied server.
// Hub sign-in is trusted via the signed X-Zawadie-User-* headers (see src/middleware/auth.js);
// ADMIN_API_KEY/TEAM_ACCESS_KEY remain the fallback when this app is run standalone.
export async function createSolution() {
  const { default: app } = await import('./src/app.js');
  return app;
}
