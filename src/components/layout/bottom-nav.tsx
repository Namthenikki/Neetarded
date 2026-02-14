"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BookCopy, User, PlusCircle, Shield, Library, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

const studentNavLinks = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Home" },
  { href: "/dashboard/aura", icon: Sparkles, label: "Aura" },
  { href: "/dashboard/my-library", icon: Library, label: "Library" },
  { href: "/dashboard/profile", icon: User, label: "Profile" },
];

const adminNavLinks = [
  { href: "/dashboard/admin", icon: Shield, label: "Admin" },
  { href: "/dashboard/create", icon: PlusCircle, label: "Create" },
  { href: "/dashboard/quizzes", icon: BookCopy, label: "Quizzes" },
  { href: "/dashboard/profile", icon: User, label: "Profile" },
];

export function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  
  const navLinks = user?.role === 'admin' ? adminNavLinks : studentNavLinks;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/80 backdrop-blur-sm">
      <div className="grid h-16 grid-cols-4">
        {navLinks.map((link) => {
          const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-slate-500 transition-colors",
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
