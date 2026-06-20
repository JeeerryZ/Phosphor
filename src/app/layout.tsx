import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { BackgroundCanvas } from "@/components/ui/BackgroundCanvas";

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SET BUILDER",
  description: "A Destiny 2 armor optimizer with Tier 5 stat-tuning support.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${ibmPlexMono.variable} h-full`}>
      <body className="min-h-full flex flex-col">
        <BackgroundCanvas />
        <div className="relative flex flex-col flex-1 min-h-full" style={{ zIndex: 1 }}>
          {children}
        </div>
      </body>
    </html>
  );
}
