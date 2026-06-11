import { LoginButton } from "@/components/auth/LoginButton";
import { PageTransition } from "@/components/ui/PageTransition";

export default function Home() {
  return (
    <main className="bg-grid flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <PageTransition>
        <p className="font-display text-arc/80 text-sm uppercase tracking-[0.4em]">
          Guardian Optimization Suite
        </p>
        <h1 className="font-display mt-4 text-5xl font-bold tracking-wide sm:text-7xl">
          SET <span className="text-arc text-glow-arc">BUILDER</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-balance text-foreground/70">
          Build optimal Destiny 2 armor loadouts &mdash; including Tier 5 stat tuning, where 5
          points can be moved from one stat to another.
        </p>
        <div className="mt-10">
          <LoginButton />
        </div>
      </PageTransition>
    </main>
  );
}
