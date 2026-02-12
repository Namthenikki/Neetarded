"use client";

import React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { BottomNav } from "@/components/layout/bottom-nav";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();

  if (isMobile === undefined) {
    return null; 
  }

  if (isMobile) {
    return (
      <div className="pb-20 bg-white">
        <main>{children}</main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-white">
      <SidebarNav />
      <main className="flex-1">{children}</main>
    </div>
  );
}
