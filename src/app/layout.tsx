import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";

import "./globals.css";

export const metadata: Metadata = {
  title: "Competitor Research Agent",
  description: "基于搜索证据的智能竞品调研系统。",
  applicationName: "Competitor Research Agent",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="paper-noise" aria-hidden="true" />
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
