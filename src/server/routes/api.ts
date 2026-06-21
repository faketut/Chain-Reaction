// Chain Reaction — /api/* gameplay endpoints. The actual handlers live in
// ../routes.ts (kept at that path so the preview's mock fetch and the existing
// path-relative imports continue to work).

export { app as api } from '../routes';
