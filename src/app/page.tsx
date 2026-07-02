import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginButton } from "@/components/auth/LoginButton";
import { PageTransition } from "@/components/ui/PageTransition";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import { getArmorStatIcons } from "@/lib/manifest/stats";
import { OptimizerClient } from "@/components/optimizer/OptimizerClient";
import { getSession } from "@/lib/session/session";

export default async function Home() {
  const session = await getValidSession();

  // Token is expiring soon — redirect to the refresh route handler which can
  // write cookies, then return here. Only redirect if a session actually exists.
  if (!session) {
    const raw = await getSession();
    if (raw.accessToken && raw.refreshToken) {
      redirect("/api/auth/refresh?return=/");
    }
  }

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <PageTransition>
          <p className="text-sm text-fg-muted tracking-[0.3em] uppercase mb-6">Destiny 2</p>
          <h1 className="text-6xl font-bold tracking-tight sm:text-8xl" style={{ fontFamily: "var(--font-sans)" }}>
            <span className="text-fg">Phos</span>
            <span className="text-accent">phor</span>
          </h1>
          <p className="mt-4 text-base text-fg-dim tracking-widest uppercase">Armor Optimizer · T5 Stat Tuning</p>
          <p className="mx-auto mt-8 max-w-md text-base text-fg-muted leading-relaxed">
            Find optimal armor combinations across your vault, including Tier 5 tuning
            where each piece can shift +5 points into any stat.
          </p>
          <div className="mt-10">
            <LoginButton />
          </div>
        </PageTransition>
      </main>
    );
  }

  await ensureManifestUpToDate();

  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);
  const statIcons = getArmorStatIcons();

  const charactersData = profile.characters.data ?? {};
  const firstCharacter = Object.values(charactersData)[0];
  const characters: Record<string, { classType: number }> = Object.fromEntries(
    Object.entries(charactersData).map(([id, c]) => [id, { classType: c.classType }])
  );

  return (
    <main className="min-h-screen px-4 sm:px-6 py-8">
      <PageTransition>
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex items-baseline gap-3">
            <h1 className="text-xl font-bold text-glow" style={{ fontFamily: "var(--font-sans)" }}>
              <span className="text-fg">Phos</span>
              <span className="text-accent">phor</span>
            </h1>
            <span className="text-sm text-fg-dim tracking-widest uppercase">Armor Optimizer</span>
            <Link
              href="/ghost-mods"
              className="ml-auto text-xs uppercase tracking-widest text-fg-dim hover:text-fg transition-colors"
            >
              Ghost Advisor →
            </Link>
          </div>
          <OptimizerClient
            inventory={inventory}
            statIcons={statIcons}
            defaultClassType={firstCharacter?.classType ?? 0}
            characters={characters}
          />
        </div>
      </PageTransition>
    </main>
  );
}
