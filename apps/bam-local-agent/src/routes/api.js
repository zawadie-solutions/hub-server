import path from 'path';
import { fileURLToPath } from 'url';
import express, { Router } from 'express';
import multer from 'multer';
import { requireAdminKey, requireTeamKey, sessionInfo } from '../middleware/auth.js';
import { askMeta, askQuestion } from '../controllers/askController.js';
import {
  health, getOverview, uploadPlaybook, getJobStatus, getPlaybooks, activatePlaybook,
  addKnowledge, deleteKnowledge, testQuery, addStore, researchStore, patchStore, removeStore, reviewKnowledge
} from '../controllers/adminController.js';

/* ---------- JSON API (mounted at /api) ---------- */
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.get('/health', health);

// Tells the pages whether the Zawadie Hub already signed this person in (so they skip the key prompt). Reveals nothing secret.
router.get('/session', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(sessionInfo(req)); });

// Marketing planner (team access code)
router.use('/ask', requireTeamKey);
router.get('/ask/meta', askMeta);
router.post('/ask', askQuestion);

router.use('/admin', requireAdminKey);
router.get('/admin/overview', getOverview);
router.post('/admin/playbooks', upload.single('file'), uploadPlaybook);
router.get('/admin/playbooks', getPlaybooks);
router.post('/admin/playbooks/:id/activate', activatePlaybook);
router.get('/admin/jobs/:id', getJobStatus);
router.post('/admin/stores', addStore);
router.post('/admin/stores/:id/research', researchStore);
router.patch('/admin/stores/:id', patchStore);
router.delete('/admin/stores/:id', removeStore);
router.post('/admin/knowledge', addKnowledge);
router.delete('/admin/knowledge/:id', deleteKnowledge);
router.patch('/admin/knowledge/:id/review', reviewKnowledge);
router.post('/admin/query', testQuery);

export default router;

/* ---------- Admin portal pages (mounted at /) ---------- */
// The page itself holds no secrets; every data call needs the x-admin-key header.
export const pageRouter = Router();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

pageRouter.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  });
  next();
});
pageRouter.use(express.static(publicDir, { index: false, maxAge: 0, etag: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
pageRouter.get(['/', '/admin'], (req, res) => res.sendFile(path.join(publicDir, 'index.html')));   // admin portal
pageRouter.get('/ask', (req, res) => res.sendFile(path.join(publicDir, 'ask.html')));                // marketing planner
