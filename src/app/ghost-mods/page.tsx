import Link from "next/link";
import { PageTransition } from "@/components/ui/PageTransition";
import { GhostModAdvisor } from "@/components/ghost/GhostModAdvisor";

export const metadata = { title: "Ghost Mod Advisor · Phosphor" };

export default function GhostModsPage() {
  return (
    <main className="min-h-screen px-4 sm:px-6 py-8">
      <PageTransition>
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-baseline gap-4">
            <Link
              href="/"
              className="text-xs uppercase tracking-widest text-fg-dim hover:text-fg transition-colors"
            >
              ← Phosphor
            </Link>
            <h1 className="text-xl font-bold text-glow" style={{ fontFamily: "var(--font-sans)" }}>
              <span className="text-fg">Ghost</span>
              <span className="text-accent">Advisor</span>
            </h1>
            <span className="text-sm text-fg-dim tracking-widest uppercase">Mod Planner</span>
          </div>
          <GhostModAdvisor />
        </div>
      </PageTransition>
    </main>
  );
}
