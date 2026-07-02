import { Toast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";

// Shown automatically by Next.js while the root page's Server Component is
// still resolving — this is the only window where we can signal to the user
// that ensureManifestUpToDate() may be downloading/refreshing the Destiny
// manifest, since that check runs server-side before any client JS loads.
export default function Loading() {
  return (
    <Toast>
      <Spinner label="syncing Destiny manifest..." />
    </Toast>
  );
}
