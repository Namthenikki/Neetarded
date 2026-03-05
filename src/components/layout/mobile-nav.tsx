"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Menu, UserIcon, LogOut, BookCopy } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Logo } from "@/components/logo";
import { studentNavLinks, adminNavLinks } from "./sidebar-nav";
import { useState } from "react";

export function MobileNav() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const [open, setOpen] = useState(false);

    // Admin final links (same logic as sidebar-nav)
    const adminFinalLinks = [
        ...adminNavLinks,
        { href: "/dashboard/quizzes", icon: BookCopy, label: "All Quizzes" },
        { href: "/dashboard/profile", icon: UserIcon, label: "Profile" },
    ];

    const navLinks = user?.role === 'admin' ? adminFinalLinks : studentNavLinks;

    const getInitials = (name: string = '') => {
        return name.split(' ').map(n => n[0]).join('').toUpperCase();
    };

    return (
        <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 flex items-center h-16 px-4 md:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger asChild>
                    <Button variant="ghost" size="icon" className="mr-2">
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle Menu</span>
                    </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] sm:w-[350px] p-0 flex flex-col">
                    <SheetHeader className="p-4 border-b border-slate-100 flex items-start justify-center">
                        <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                        <div className="scale-90 origin-left">
                            <Logo />
                        </div>
                    </SheetHeader>

                    <div className="flex-1 overflow-y-auto py-4 px-3">
                        <ul className="space-y-1">
                            {navLinks.map((link) => {
                                const isActive = (pathname.startsWith(link.href) && link.href !== '/dashboard' && link.href !== '/dashboard/admin') || pathname === link.href;
                                return (
                                    <li key={link.href}>
                                        <Link
                                            href={link.href}
                                            onClick={() => setOpen(false)}
                                            className={cn(
                                                "flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-600 transition-colors hover:bg-primary/10 hover:text-primary",
                                                isActive ? "bg-primary/10 text-primary font-medium" : ""
                                            )}
                                        >
                                            <link.icon className="h-5 w-5" />
                                            <span>{link.label}</span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className="p-4 border-t border-slate-200 bg-slate-50/50">
                        {user && (
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-3 px-2">
                                    <Avatar className="h-10 w-10 border border-slate-200">
                                        <AvatarFallback className="bg-white text-slate-700 font-semibold">{getInitials(user.name)}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-semibold text-slate-900">{user.name}</span>
                                        <span className="text-xs text-slate-500">{user.studentId}</span>
                                    </div>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    <Button variant="outline" className="flex-1 text-xs h-9 rounded-xl" onClick={() => { setOpen(false); /* Router push handled by Link in sidebar if wanted */ }}>
                                        <UserIcon className="h-3.5 w-3.5 mr-2" />
                                        Profile
                                    </Button>
                                    <Button variant="outline" className="flex-1 text-xs h-9 rounded-xl text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200" onClick={logout}>
                                        <LogOut className="h-3.5 w-3.5 mr-2" />
                                        Logout
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            {/* Mobile Header Title */}
            <div className="flex-1 right-2 flex justify-center">
                <div className="scale-75 origin-center">
                    <Logo />
                </div>
            </div>
            <div className="w-10"></div> {/* Spacer to center logo against hamburger */}
        </header>
    );
}
