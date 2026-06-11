import { redirect } from "next/navigation";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import { getArmorStatIcons } from "@/lib/manifest/stats";
import { OptimizerClient } from "@/components/optimizer/OptimizerClient";
import { PageTransition } from "@/components/ui/PageTransition";

export default async function OptimizerPage() {
  const session = await getValidSession();
  if (!session) {
    redirect("/");
  }

  await ensureManifestUpToDate();

  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);
  const statIcons = getArmorStatIcons();

  const firstCharacter = Object.values(profile.characters.data ?? {})[0];

  return (
    <main className="bg-grid min-h-screen px-6 py-10">
      <PageTransition>
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between">
            <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl">
              ARMOR <span className="text-arc text-glow-arc">OPTIMIZER</span>
            </h1>
            <a
              href="/inventory"
              className="font-display text-foreground/60 hover:text-foreground text-xs uppercase tracking-wider transition-colors"
            >
              Inventory
            </a>
          </div>

          <OptimizerClient
            inventory={inventory}
            statIcons={statIcons}
            defaultClassType={firstCharacter?.classType ?? 0}
          />
        </div>
      </PageTransition>
    </main>
  );
}
