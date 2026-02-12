"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BookCopy, BarChart3, User, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/create", icon: PlusCircle, label: "Create" },
  { href: "/dashboard/quizzes", icon: BookCopy, label: "Quizzes" },
  { href: "/dashboard/profile", icon: User, label: "Profile" },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/80 backdrop-blur-sm">
      <div className="grid h-16 grid-cols-4">
        {navLinks.map((link) => {
          const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-muted-foreground transition-colors",
                isActive ? "text-primary" : "hover:text-primary"
              )}
            >
              <link.icon className="h-5 w-5" />
              <span className="text-xs font-medium">{link.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  );
}
