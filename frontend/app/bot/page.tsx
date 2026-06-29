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
    // Generate a 6-character alphanumeric room code
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
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
