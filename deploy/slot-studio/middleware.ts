// Vercel Routing Middleware: password-protects Slot Studio with HTTP Basic auth, as the main site does.
// Set SITE_PASSWORD in this Vercel project. Any username works. Without it, the deployment refuses all requests.
// password.ts is copied from scripts/password.ts by `npm run studio:build`.
import {passwordOk} from './password.js';

// This folder has no package.json or @types/node; Vercel provides process.env at run time.
declare const process: {env: Record<string, string | undefined>};

export const config = {matcher: '/:path*'};

export default function middleware(request: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return new Response('This deployment has no SITE_PASSWORD set.', {status: 503});
  if (passwordOk(request, password, true)) return;
  return new Response('Password required.', {status: 401, headers: {'WWW-Authenticate': 'Basic realm="Slot Studio", charset="UTF-8"'}});
}
