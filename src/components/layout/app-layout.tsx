"use client";

import React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { BottomNav } from "@/components/layout/bottom-nav";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile === undefined) {
    return null; // Or a loading skeleton
  }

  if (isMobile) {
    return (
      <div className="pb-20">
        <main>{children}</main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <SidebarNav />
      <main className="flex-1 border-l">{children}</main>
    </div>
  );
}
