import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const inputEmail = credentials?.email?.trim() ?? "";
        const inputPassword = credentials?.password?.trim() ?? "";

        const adminEmail = (process.env.ADMIN_EMAIL ?? "admin@pradeeppublications.com").trim();
        const adminPassword = (process.env.ADMIN_PASSWORD ?? "admin@123").trim();

        if (inputEmail === adminEmail && inputPassword === adminPassword) {
          return { id: "1", name: "Admin", email: adminEmail };
        }
        return null;
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: process.env.NEXTAUTH_SECRET,
});

export { handler as GET, handler as POST };
