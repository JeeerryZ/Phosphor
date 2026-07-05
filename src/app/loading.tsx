// Shown automatically by Next.js while the root page's Server Component is
// still resolving — this is the only window where we can signal to the user
// that ensureManifestUpToDate() may be downloading/refreshing the Destiny
// manifest, since that check runs server-side before any client JS loads.
// Pure CSS (Tailwind's animate-spin/animate-toast-in) so it paints correctly
// even if this fallback gets swapped out before client JS ever hydrates.
export default function Loading() {
  return (
    <div className="animate-fade-in fixed inset-0 z-[9999] flex items-center justify-center bg-bg/80">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 rounded-full border-2 border-border-active border-t-accent animate-spin" />
        <span className="text-sm text-fg-dim tracking-widest uppercase">syncing Destiny manifest...</span>
      </div>
    </div>
  );
}
