"use client";

export function LoginButton() {
  return (
    <a
      href="/api/auth/login"
      className="inline-flex items-center justify-center border border-border-active text-accent px-8 py-3 text-base uppercase tracking-widest transition-colors hover:bg-accent/10"
    >
      [ LOGIN WITH BUNGIE ]
    </a>
  );
}
