"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BookCopy, BarChart3, User } from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/quizzes", icon: BookCopy, label: "Quizzes" },
  { href: "/dashboard/performance", icon: BarChart3, label: "Performance" },
  { href: "/dashboard/profile", icon: User, label: "Profile" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-10 border-t bg-card">
      <div className="grid h-16 grid-cols-4">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex flex-col items-center justify-center gap-1 text-muted-foreground transition-colors",
              pathname === link.href ? "text-primary" : "hover:text-primary"
            )}
          >
            <link.icon className="h-6 w-6" />
            <span className="text-xs">{link.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
