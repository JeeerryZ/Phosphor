import { redirect } from "next/navigation";
import { getValidSession } from "@/lib/session/session";
import { ensureManifestUpToDate } from "@/lib/manifest/sync";
import { getProfileWithArmor } from "@/lib/bungie/profile";
import { transformProfileToArmorInventory } from "@/lib/armor/transform";
import { getCharacterEmblemBackground } from "@/lib/character/emblem";
import { CharacterColumn } from "@/components/inventory/CharacterColumn";
import { VaultSection } from "@/components/inventory/VaultSection";
import { PageTransition } from "@/components/ui/PageTransition";

export default async function InventoryPage() {
  const session = await getValidSession();
  if (!session) {
    redirect("/");
  }

  await ensureManifestUpToDate();

  const profile = await getProfileWithArmor(session);
  const inventory = transformProfileToArmorInventory(profile);

  const characters = Object.values(profile.characters.data ?? {}).sort(
    (a, b) => Date.parse(b.dateLastPlayed) - Date.parse(a.dateLastPlayed)
  );

  return (
    <main className="bg-grid min-h-screen px-6 py-10">
      <PageTransition>
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 flex items-center justify-between">
            <h1 className="font-display text-3xl font-bold tracking-wide sm:text-4xl">
              ARMOR <span className="text-arc text-glow-arc">INVENTORY</span>
            </h1>
            <a
              href="/api/auth/logout"
              className="font-display text-foreground/60 hover:text-foreground text-xs uppercase tracking-wider transition-colors"
            >
              Log out
            </a>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {characters.map((character) => (
              <CharacterColumn
                key={character.characterId}
                classType={character.classType}
                light={character.light}
                emblemPath={character.emblemPath}
                emblemBackgroundPath={getCharacterEmblemBackground(
                  profile,
                  character.characterId,
                  character.emblemBackgroundPath
                )}
                items={inventory.characters[character.characterId] ?? []}
              />
            ))}
          </div>

          <div className="mt-12">
            <VaultSection items={inventory.vault} />
          </div>
        </div>
      </PageTransition>
    </main>
  );
}
