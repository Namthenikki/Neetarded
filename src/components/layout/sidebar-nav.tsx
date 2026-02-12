"use client";

import {
  LayoutDashboard,
  BookCopy,
  User as UserIcon,
  BookPlus,
  LogOut,
  Shield,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "../ui/button";

const studentNavLinks = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/quizzes", icon: BookCopy, label: "Browse Quizzes" },
  { href: "/dashboard/profile", icon: UserIcon, label: "Profile" },
];

const adminNavLinks = [
    { href: "/dashboard/admin", icon: Shield, label: "Admin" },
    { href: "/dashboard/create", icon: BookPlus, label: "Create Quiz" },
]

export function SidebarNav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  
  const navLinks = user?.role === 'admin' ? [...adminNavLinks, ...studentNavLinks] : studentNavLinks;

  const getInitials = (name: string = '') => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  }

  return (
    <aside className="w-64 flex-shrink-0 bg-white p-4 flex flex-col border-r border-slate-200">
      <div className="mb-8">
        <Logo />
      </div>
      <nav className="flex-1">
        <ul className="space-y-1">
          {navLinks.map((link) => {
             const isActive = (pathname.startsWith(link.href) && link.href !== '/dashboard') || pathname === link.href;
            return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-slate-600 transition-colors hover:bg-primary/10 hover:text-primary",
                  isActive ? "bg-primary/10 text-primary font-medium" : ""
                )}
              >
                <link.icon className="h-5 w-5" />
                <span>{link.label}</span>
              </Link>
            </li>
          )})}
        </ul>
      </nav>
      <div>
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start p-2 h-auto rounded-xl hover:bg-slate-100">
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-slate-200 text-slate-700">{getInitials(user.name)}</AvatarFallback>
                  </Avatar>
                  <div className="text-left">
                    <p className="text-sm font-medium leading-none text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-500 leading-none">{user.studentId}</p>
                  </div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56 rounded-xl" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user.name}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user.studentId}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer">
                <Link href="/dashboard/profile">
                  <UserIcon />
                  <span>Profile</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={logout} className="cursor-pointer">
                <LogOut />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </aside>
  );
}
