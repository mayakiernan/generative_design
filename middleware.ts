// Vercel Routing Middleware: password-protects every page and the API with HTTP Basic auth.
// Set SITE_PASSWORD in the Vercel project. Any username works. Without it, the deployment refuses all requests.
// The API function checks the same password again (scripts/compare-handler.ts), so this isn't the only lock.
import {passwordOk} from './scripts/password.js';

export const config = {matcher: '/:path*'};

export default function middleware(request: Request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return new Response('This deployment has no SITE_PASSWORD set.', {status: 503});
  if (passwordOk(request, password, true)) return;
  return new Response('Password required.', {status: 401, headers: {'WWW-Authenticate': 'Basic realm="Possible Pieces", charset="UTF-8"'}});
}
