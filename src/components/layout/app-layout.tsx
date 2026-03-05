"use client";

import React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { useOfflineSync } from "@/hooks/use-offline-sync";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  useOfflineSync();

  if (isMobile === undefined) {
    return null;
  }

  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-white">
        <MobileNav />
        <main className="flex-1 w-full">{children}</main>
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
