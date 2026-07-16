"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  Upload,
  Layers,
  Users,
  Copy,
  AlertTriangle,
  MessageSquare,
  BookOpen,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Trigger", icon: Upload },
  { href: "/batches", label: "Batch Logs", icon: Layers },
  { href: "/messages", label: "Message Logs", icon: MessageSquare },
  { href: "/teachers", label: "Teachers", icon: Users },
  { href: "/duplicates", label: "Duplicates", icon: Copy },
  { href: "/dlq", label: "DLQ", icon: AlertTriangle },
  { href: "/book-mappings", label: "Book Mappings", icon: BookOpen },
  { href: "/wati-templates", label: "WATI Templates", icon: MessageSquare },
];

interface Props {
  open: boolean;
}

export default function Sidebar({ open }: Props) {
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.dataset.theme = "purple";
  }, []);

  return (
    <>
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-card border-r border-border transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

      </aside>
    </>
  );
}
