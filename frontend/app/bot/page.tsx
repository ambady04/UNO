"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /bot — generates a unique room code and immediately redirects to /bot/[code].
 * This ensures every player gets their own isolated game session.
 */
export default function BotRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // Generate a 6-char code from a mixed pool — always letters + digits
    // Avoids ambiguous chars: 0/O, 1/I, 5/S, 8/B
    const LETTERS = "ACDEFGHJKLMNPQRTUVWXY";
    const DIGITS  = "2346789";
    const ALL     = LETTERS + DIGITS;

    // Guarantee at least 2 digits and 2 letters in the code
    const pick = (pool: string) => pool[Math.floor(Math.random() * pool.length)];
    const parts = [
      pick(LETTERS), pick(LETTERS),
      pick(DIGITS),  pick(DIGITS),
      pick(ALL),     pick(ALL),
    ];
    // Fisher-Yates shuffle so the guaranteed chars aren't always in fixed positions
    for (let i = parts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [parts[i], parts[j]] = [parts[j], parts[i]];
    }
    const code = parts.join("");
    router.replace(`/bot/${code}`);
  }, [router]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        flexDirection: "column",
        gap: 16,
        color: "#fff",
        background: "radial-gradient(circle at center, #0f2015 0%, #050a07 100%)",
      }}
    >
      <div style={{ fontSize: 48 }}>🤖</div>
      <p style={{ fontSize: 16, opacity: 0.7, margin: 0 }}>Setting up your game…</p>
    </div>
  );
}
