"use client";

import { useState } from "react";
import { Menu, LogOut } from "lucide-react";
import { clsx } from "clsx";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import ErrorBoundary from "./ErrorBoundary";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { status } = useSession();
  const pathname = usePathname();

  // Login page: always bare (no shell)
  if (pathname === "/login") {
    return <>{children}</>;
  }

  // Session still loading: show shell skeleton to avoid jitter
  if (status === "loading") {
    return (
      <div className="flex min-h-screen bg-background">
        <div className="fixed top-0 left-0 right-0 z-40 h-14 border-b border-border bg-card" />
        <main className="min-w-0 flex-1 pt-14" />
      </div>
    );
  }

  // Not authenticated: render bare (middleware will redirect to /login)
  if (status === "unauthenticated") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-background transition-colors duration-300">
      <Sidebar open={sidebarOpen} />

      {/* Top bar with hamburger — shifts right when sidebar is open */}
      <header
        className={clsx(
          "fixed top-0 right-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-card px-4 shadow-sm transition-[left] duration-200 ease-in-out",
          sidebarOpen ? "left-64" : "left-0"
        )}
      >
        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none transition-colors"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex flex-1 items-center justify-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary p-1 text-xs font-bold text-primary-foreground">
            V
          </div>
          <span className="font-semibold text-foreground">Virtual Specimen Dispatch System</span>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none transition-colors"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      {/* Main content — shifts right when sidebar is open */}
      <main
        className={clsx(
          "min-w-0 flex-1 pt-14 transition-[margin-left] duration-200 ease-in-out",
          sidebarOpen && "ml-64"
        )}
      >
        <div className="min-w-0 px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6">
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
