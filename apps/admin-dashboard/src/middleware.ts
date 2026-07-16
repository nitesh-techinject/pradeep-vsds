export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    /*
     * Protect all routes except:
     * - /login
     * - /api/auth (NextAuth endpoints)
     * - /_next (static files)
     * - /favicon.ico
     */
    "/((?!login|api/auth|_next|favicon.ico).*)",
  ],
};
