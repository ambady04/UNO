"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getStoredGuest } from "../api";
import { gameSounds } from "../sounds";

// ─── Types ─────────────────────────────────────────────────────────────────────
type Card = string;

interface BotGameState {
  deck: Card[];
  discardPile: Card[];
  playerHand: Card[];
  botHand: Card[];
  currentColor: string;
  currentValue: string;
  currentTurn: "player" | "bot";
  drawPenalty: number;
  hasDrawnThisTurn: boolean;
  gameStatus: "PLAYING" | "FINISHED";
  winner: "player" | "bot" | null;
  playerCalledUno: boolean;
  botCalledUno: boolean;
}

// ─── Pure helpers (no hooks, no side-effects) ──────────────────────────────────
function createDeck(): Card[] {
  const colors = ["R", "Y", "G", "B"];
  const deck: Card[] = [];
  for (const c of colors) {
    deck.push(`${c}_0`);
    for (let n = 1; n <= 9; n++) {
      deck.push(`${c}_${n}`);
      deck.push(`${c}_${n}`);
    }
    for (const a of ["Skip", "Reverse", "Draw2"]) {
      deck.push(`${c}_${a}`);
      deck.push(`${c}_${a}`);
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push("W_Wild");
    deck.push("W_WildDraw4");
  }
  return deck;
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isPlayable(
  card: Card,
  color: string,
  value: string,
  penalty: number,
  hasDrawn: boolean,
): boolean {
  const [cc, cv] = card.split("_");
  if (penalty > 0) {
    if (hasDrawn) return false;
    if (value === "Draw2") return cv === "Draw2";
    if (value === "WildDraw4") return cv === "WildDraw4";
    return false;
  }
  if (cv === "WildDraw4" && value === "Draw2") return false;
  if (cv === "Draw2" && value === "WildDraw4") return false;
  if (cc === "W") return true;
  return cc === color || cv === value;
}

function drawCards(
  deck: Card[],
  discard: Card[],
  count: number,
): { drawn: Card[]; deck: Card[]; discard: Card[] } {
  let d = [...deck];
  let disc = [...discard];
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (d.length === 0) {
      const top = disc.pop()!;
      d = shuffled(disc);
      disc = [top];
    }
    if (d.length > 0) drawn.push(d.pop()!);
  }
  return { drawn, deck: d, discard: disc };
}

function initGame(): BotGameState {
  let deck = shuffled(createDeck());
  const playerHand: Card[] = [];
  const botHand: Card[] = [];
  for (let i = 0; i < 7; i++) {
    playerHand.push(deck.pop()!);
    botHand.push(deck.pop()!);
  }

  let startCard = deck.pop()!;
  while (true) {
    const [c, v] = startCard.split("_");
    if (
      c !== "W" &&
      !["Skip", "Reverse", "Draw2", "Wild", "WildDraw4"].includes(v)
    )
      break;
    deck = shuffled([startCard, ...deck]);
    startCard = deck.pop()!;
  }
  const [sc, sv] = startCard.split("_");
  return {
    deck,
    discardPile: [startCard],
    playerHand,
    botHand,
    currentColor: sc,
    currentValue: sv,
    currentTurn: "player",
    drawPenalty: 0,
    hasDrawnThisTurn: false,
    gameStatus: "PLAYING",
    winner: null,
    playerCalledUno: false,
    botCalledUno: false,
  };
}

function botChooseColor(hand: Card[]): string {
  const counts: Record<string, number> = { R: 0, Y: 0, G: 0, B: 0 };
  for (const c of hand) {
    const col = c.split("_")[0];
    if (col in counts) counts[col]++;
  }
  return (["R", "Y", "G", "B"] as const).reduce((a, b) =>
    counts[a] >= counts[b] ? a : b,
  );
}

function botPickCard(
  hand: Card[],
  color: string,
  value: string,
  penalty: number,
  hasDrawn: boolean,
): { card: Card; chosenColor?: string } | null {
  const playable = hand.filter((c) =>
    isPlayable(c, color, value, penalty, hasDrawn),
  );
  if (!playable.length) return null;
  const rank = (c: Card) => {
    const v = c.split("_")[1];
    if (v === "WildDraw4") return 0;
    if (v === "Wild") return 1;
    if (["Skip", "Reverse", "Draw2"].includes(v)) return 2;
    return 3;
  };
  playable.sort((a, b) => rank(a) - rank(b));
  const card = playable[0];
  return {
    card,
    chosenColor: card.startsWith("W_")
      ? botChooseColor(hand.filter((c) => c !== card))
      : undefined,
  };
}

// Returns [newState, message] — pure, no side-effects
function applyBotPlayPure(
  s: BotGameState,
  card: Card,
  chosenColor?: string,
): [BotGameState, string] {
  const [cc, cv] = card.split("_");
  const botHand = s.botHand.filter((c) => c !== card);
  const color = cc === "W" ? (chosenColor ?? "R") : cc;
  let next: BotGameState = {
    ...s,
    botHand,
    discardPile: [...s.discardPile, card],
    currentValue: cv,
    currentColor: color,
    botCalledUno: false,
    hasDrawnThisTurn: false,
    drawPenalty: 0,
  };

  if (next.botHand.length === 0)
    return [{ ...next, gameStatus: "FINISHED", winner: "bot" }, ""];
  const unoMsg = next.botHand.length === 1 ? "🤖 Bot: UNO!" : "";
  if (next.botHand.length === 1) next = { ...next, botCalledUno: true };

  if (cv === "Skip") {
    next = { ...next, currentTurn: "bot" };
    return [next, "Bot played Skip — your turn is skipped!"];
  }
  if (cv === "Reverse") {
    next = { ...next, currentTurn: "bot" };
    return [next, "Bot played Reverse — acts as Skip in 1v1!"];
  }
  if (cv === "Draw2") {
    next = { ...next, drawPenalty: s.drawPenalty + 2, currentTurn: "player" };
    return [next, `Bot played +2! You must draw ${next.drawPenalty} card(s).`];
  }
  if (cv === "WildDraw4") {
    next = { ...next, drawPenalty: s.drawPenalty + 4, currentTurn: "player" };
    return [
      next,
      `Bot played +4! Color → ${COLOR_LABEL[color]}. Draw ${next.drawPenalty} card(s).`,
    ];
  }
  next = { ...next, currentTurn: "player" };
  return [next, unoMsg || `Bot played ${cc}_${cv}.`];
}

// ─── Display helpers ────────────────────────────────────────────────────────
// Solid gradients matching globals.css card colors exactly
const CARD_BG: Record<string, string> = {
  R: "linear-gradient(135deg, #ff4136 0%, #c3130a 100%)",
  Y: "linear-gradient(135deg, #ffe500 0%, #ff9900 100%)",
  G: "linear-gradient(135deg, #2ecc40 0%, #1b7a26 100%)",
  B: "linear-gradient(135deg, #0074d9 0%, #005299 100%)",
  W: "linear-gradient(135deg, #2a2b35 0%, #0e0f12 100%)",
};
const COLOR_MAP: Record<string, string> = {
  R: "#e52521",
  Y: "#ffe500",
  G: "#2ba84a",
  B: "#0076a3",
  W: "#1e1f26",
};
const COLOR_LABEL: Record<string, string> = {
  R: "Red",
  Y: "Yellow",
  G: "Green",
  B: "Blue",
};

function sortHand(hand: Card[]): Card[] {
  const co: Record<string, number> = { R: 0, Y: 1, G: 2, B: 3, W: 4 };
  const vo: Record<string, number> = {
    "0": 0,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
    "6": 6,
    "7": 7,
    "8": 8,
    "9": 9,
    Skip: 10,
    Reverse: 11,
    Draw2: 12,
    Wild: 13,
    WildDraw4: 14,
  };
  return [...hand].sort((a, b) => {
    const [ca, va] = a.split("_"),
      [cb, vb] = b.split("_");
    const d = (co[ca] ?? 99) - (co[cb] ?? 99);
    return d !== 0 ? d : (vo[va] ?? 99) - (vo[vb] ?? 99);
  });
}

function cardLabel(card: Card): string {
  const v = card.split("_")[1];
  if (v === "Draw2") return "+2";
  if (v === "WildDraw4") return "+4";
  if (v === "Wild") return "W";
  return v ?? "?";
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function BotGamePage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("You");
  const [gs, setGs] = useState<BotGameState | null>(null);
  const [message, setMessage] = useState("");
  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [botThinking, setBotThinking] = useState(false);

  // No ref needed — setTimeout id is local; won't trigger "ref during render" lint
  const showMsg = useCallback((text: string) => {
    setMessage(text);
    setTimeout(() => setMessage((prev) => (prev === text ? "" : prev)), 3000);
  }, []);

  useEffect(() => {
    // Defer state updates so they don't run synchronously inside the effect body
    const stored = getStoredGuest();
    const muted = gameSounds.getMute();
    const id = setTimeout(() => {
      if (stored) setNickname(stored.nickname);
      setIsMuted(muted);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  function startGame() {
    setGs(initGame());
    setPendingWild(null);
    setMessage("");
  }

  // ─── Bot turn — runs outside setGs, uses separate effect ────────────────────
  const runBotTurn = useCallback(
    (currentGs: BotGameState) => {
      setBotThinking(true);
      const delay = 900 + Math.random() * 600;
      setTimeout(() => {
        setBotThinking(false);

        // Compute new state synchronously, then apply with setGs + show message
        const s = {
          ...currentGs,
          botHand: [...currentGs.botHand],
          deck: [...currentGs.deck],
          discardPile: [...currentGs.discardPile],
        };
        const pick = botPickCard(
          s.botHand,
          s.currentColor,
          s.currentValue,
          s.drawPenalty,
          s.hasDrawnThisTurn,
        );

        let nextState: BotGameState;
        let msg: string;

        if (!pick) {
          const { drawn, deck, discard } = drawCards(s.deck, s.discardPile, 1);
          const afterDraw = {
            ...s,
            botHand: [...s.botHand, ...drawn],
            deck,
            discardPile: discard,
            hasDrawnThisTurn: true,
            botCalledUno: false,
          };
          const pick2 = botPickCard(
            afterDraw.botHand,
            afterDraw.currentColor,
            afterDraw.currentValue,
            afterDraw.drawPenalty,
            afterDraw.hasDrawnThisTurn,
          );
          if (!pick2) {
            nextState = {
              ...afterDraw,
              hasDrawnThisTurn: false,
              currentTurn: "player",
            };
            msg = "Bot drew a card and passed.";
          } else {
            [nextState, msg] = applyBotPlayPure(
              afterDraw,
              pick2.card,
              pick2.chosenColor,
            );
          }
        } else {
          [nextState, msg] = applyBotPlayPure(s, pick.card, pick.chosenColor);
        }

        setGs(nextState);
        if (msg) showMsg(msg);
      }, delay);
    },
    [showMsg],
  );

  // Trigger bot turn — deferred so setState isn't called synchronously inside an effect body
  useEffect(() => {
    if (
      !gs ||
      gs.currentTurn !== "bot" ||
      gs.gameStatus !== "PLAYING" ||
      botThinking
    )
      return;
    const id = setTimeout(() => runBotTurn(gs), 0);
    return () => clearTimeout(id);
  }, [gs, botThinking, runBotTurn]);

  // ─── Player actions ─────────────────────────────────────────────────────────
  function playerPlayCard(card: Card) {
    if (!gs || gs.currentTurn !== "player" || gs.gameStatus !== "PLAYING")
      return;
    if (
      !isPlayable(
        card,
        gs.currentColor,
        gs.currentValue,
        gs.drawPenalty,
        gs.hasDrawnThisTurn,
      )
    ) {
      showMsg("That card can't be played right now.");
      return;
    }
    if (card.startsWith("W_")) {
      setPendingWild(card);
      return;
    }
    applyPlayerPlay(card);
  }

  function applyPlayerPlay(card: Card, chosenColor?: string) {
    setPendingWild(null);
    if (!gs) return;
    const [cc, cv] = card.split("_");
    const playerHand = gs.playerHand.filter((c) => c !== card);
    const color = cc === "W" ? (chosenColor ?? "R") : cc;
    const base: BotGameState = {
      ...gs,
      playerHand,
      discardPile: [...gs.discardPile, card],
      currentValue: cv,
      currentColor: color,
      playerCalledUno: false,
      hasDrawnThisTurn: false,
      drawPenalty: 0,
    };

    if (playerHand.length === 0) {
      setGs({ ...base, gameStatus: "FINISHED", winner: "player" });
      return;
    }

    let next = base;
    let msg = "";
    if (cv === "Skip") {
      next = { ...base, currentTurn: "player" };
      msg = "You played Skip — bot's turn skipped!";
    } else if (cv === "Reverse") {
      next = { ...base, currentTurn: "player" };
      msg = "You played Reverse — acts as Skip in 1v1!";
    } else if (cv === "Draw2") {
      next = { ...base, drawPenalty: 2, currentTurn: "bot" };
      msg = `+2! Bot must draw 2 card(s).`;
    } else if (cv === "WildDraw4") {
      next = { ...base, drawPenalty: 4, currentTurn: "bot" };
      msg = `+4! Color → ${COLOR_LABEL[color]}. Bot draws 4.`;
    } else {
      next = { ...base, currentTurn: "bot" };
    }

    setGs(next);
    if (msg) showMsg(msg);
    gameSounds.play("playCard");
  }

  function playerDrawCard() {
    if (!gs || gs.currentTurn !== "player" || gs.gameStatus !== "PLAYING")
      return;
    if (gs.hasDrawnThisTurn && gs.drawPenalty === 0) {
      showMsg("You already drew. Play a card or pass.");
      return;
    }
    const { drawn, deck, discard } = drawCards(gs.deck, gs.discardPile, 1);
    const newPenalty = gs.drawPenalty > 0 ? gs.drawPenalty - 1 : 0;
    const penaltyDone = gs.drawPenalty > 0 && newPenalty === 0;
    setGs({
      ...gs,
      playerHand: [...gs.playerHand, ...drawn],
      deck,
      discardPile: discard,
      drawPenalty: newPenalty,
      hasDrawnThisTurn: !penaltyDone,
      playerCalledUno: false,
      currentTurn: penaltyDone ? "bot" : gs.currentTurn,
    });
    gameSounds.play("drawCard");
  }

  function playerPassTurn() {
    if (!gs || gs.currentTurn !== "player" || gs.gameStatus !== "PLAYING")
      return;
    if (!gs.hasDrawnThisTurn) {
      showMsg("Draw a card first before passing.");
      return;
    }
    setGs({ ...gs, hasDrawnThisTurn: false, currentTurn: "bot" });
  }

  function callUno() {
    if (!gs || gs.playerHand.length !== 1) {
      showMsg("You can only call UNO with 1 card left!");
      return;
    }
    setGs({ ...gs, playerCalledUno: true });
    showMsg("🎉 UNO!");
    gameSounds.play("unoShout");
  }

  // ─── Render card ────────────────────────────────────────────────────────────
  function renderCard(
    card: Card,
    onClick?: () => void,
    playable = false,
    faceDown = false,
    key?: any,
  ) {
    const [cc] = card.split("_");
    const bg = faceDown
      ? "radial-gradient(circle, #e52521 0%, #990000 100%)"
      : (CARD_BG[cc] ?? "linear-gradient(135deg, #333 0%, #111 100%)");
    return (
      <div
        key={key}
        onClick={onClick}
        style={{
          width: 66,
          height: 99,
          borderRadius: 8,
          border: `2px solid rgba(255,255,255,${playable ? 0.9 : 0.2})`,
          background: bg,
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: faceDown ? 11 : 18,
          cursor: onClick ? "pointer" : "default",
          boxShadow: playable
            ? "0 0 10px rgba(255,255,255,0.4),0 4px 12px rgba(0,0,0,0.4)"
            : "0 4px 12px rgba(0,0,0,0.4)",
          transition: "transform 0.2s",
          userSelect: "none",
          flexShrink: 0,
          opacity: 1,
          fontStyle: faceDown ? "italic" : undefined,
        }}
        onMouseEnter={(e) => {
          if (onClick)
            (e.currentTarget as HTMLElement).style.transform =
              "translateY(-8px) scale(1.05)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = "";
        }}
      >
        {faceDown ? "UNO" : cardLabel(card)}
      </div>
    );
  }

  // ─── Pre-game ───────────────────────────────────────────────────────────────
  if (!gs) {
    return (
      <div className="lobby-container">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🤖</div>
          <h1 className="lobby-title" style={{ margin: "0 0 4px 0" }}>
            Play vs Bot
          </h1>
          <p style={{ opacity: 0.6, fontSize: 14, margin: 0 }}>
            1v1 match against the AI
          </p>
        </div>
        <div
          className="glass-panel"
          style={{
            width: "100%",
            padding: 24,
            boxSizing: "border-box",
            textAlign: "center",
          }}
        >
          <p style={{ marginBottom: 20, fontSize: 14, opacity: 0.7 }}>
            Play a classic UNO 1v1 game against a bot. All standard rules apply
            — first to empty their hand wins!
          </p>
          <button
            onClick={startGame}
            className="btn-primary"
            style={{ marginBottom: 12 }}
          >
            Start Game
          </button>
          <button onClick={() => router.push("/")} className="btn-secondary">
            ← Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  // ─── Finished ──────────────────────────────────────────────────────────────
  if (gs.gameStatus === "FINISHED") {
    const won = gs.winner === "player";
    return (
      <div className="lobby-container" style={{ gap: 16 }}>
        <div
          className="glass-panel"
          style={{
            width: "100%",
            padding: 32,
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: 64, marginBottom: 8 }}>
            {won ? "🏆" : "😢"}
          </div>
          <h2
            style={{
              margin: "0 0 8px 0",
              fontSize: 28,
              fontWeight: 900,
              color: won ? "#ffcc00" : "#ff5555",
            }}
          >
            {won ? "You Win!" : "Bot Wins!"}
          </h2>
          <p style={{ opacity: 0.6, fontSize: 14, margin: "0 0 28px 0" }}>
            {won
              ? `Congrats ${nickname}! You beat the bot!`
              : "Better luck next time!"}
          </p>
          <button
            onClick={startGame}
            className="btn-primary"
            style={{ marginBottom: 12 }}
          >
            Play Again
          </button>
          <button onClick={() => router.push("/")} className="btn-secondary">
            ← Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  // ─── Wild picker ───────────────────────────────────────────────────────────
  if (pendingWild) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.85)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 100,
        }}
      >
        <h2 style={{ color: "#fff", marginBottom: 20, fontWeight: 800 }}>
          Choose a color
        </h2>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          {(["R", "Y", "G", "B"] as const).map((col) => (
            <button
              key={col}
              onClick={() => applyPlayerPlay(pendingWild, col)}
              style={{
                width: 80,
                height: 80,
                borderRadius: "50%",
                border: "3px solid #fff",
                background: COLOR_MAP[col],
                cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
                transition: "transform 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.transform = "scale(1.1)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.transform = "";
              }}
            />
          ))}
        </div>
        <button
          onClick={() => setPendingWild(null)}
          className="btn-secondary"
          style={{ marginTop: 24, width: 160 }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // ─── Derived ───────────────────────────────────────────────────────────────
  const topCard = gs.discardPile[gs.discardPile.length - 1];
  const sortedHand = sortHand(gs.playerHand);
  const isPlayerTurn = gs.currentTurn === "player";
  const hasPlayable = sortedHand.some((c) =>
    isPlayable(
      c,
      gs.currentColor,
      gs.currentValue,
      gs.drawPenalty,
      gs.hasDrawnThisTurn,
    ),
  );
  const needsToDraw =
    isPlayerTurn &&
    (gs.drawPenalty > 0 || (!gs.hasDrawnThisTurn && !hasPlayable));
  const currentColorHex = COLOR_MAP[gs.currentColor] ?? "#888";

  // ─── Board ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100vw",
        position: "fixed",
        top: 0,
        left: 0,
        overflow: "hidden",
        background:
          "radial-gradient(circle at center, #0f2015 0%, #050a07 100%)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(0,0,0,0.3)",
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: 15, letterSpacing: 1 }}>UNO vs Bot</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              const m = !isMuted;
              setIsMuted(m);
              gameSounds.setMute(m);
            }}
            className="btn-secondary"
            style={{ padding: "4px 10px", fontSize: 13, minHeight: 32 }}
          >
            {isMuted ? "🔇" : "🔊"}
          </button>
          <button
            onClick={() => router.push("/")}
            className="btn-secondary"
            style={{
              padding: "4px 10px",
              fontSize: 12,
              minHeight: 32,
              borderColor: "rgba(255,51,51,0.3)",
              color: "#ff5555",
            }}
          >
            Exit
          </button>
        </div>
      </div>

      {/* Alert */}
      {message && (
        <div className="game-alert alert-success" style={{ top: 60 }}>
          {message}
        </div>
      )}

      {/* Bot zone */}
      <div
        style={{
          flexShrink: 0,
          padding: "14px 16px 8px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: "linear-gradient(135deg,#ff3333,#880000)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              border: `2px solid ${gs.currentTurn === "bot" ? "#ffcc00" : "rgba(255,255,255,0.15)"}`,
              boxShadow:
                gs.currentTurn === "bot"
                  ? "0 0 12px rgba(255,204,0,0.6)"
                  : "none",
            }}
          >
            🤖
          </div>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Bot</span>
            {gs.botCalledUno && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  background: "#ff3333",
                  color: "#fff",
                  padding: "1px 5px",
                  borderRadius: 4,
                  fontWeight: 800,
                }}
              >
                UNO
              </span>
            )}
            {botThinking && (
              <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.5 }}>
                thinking...
              </span>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 3,
            flexWrap: "wrap",
            justifyContent: "center",
            maxWidth: "100%",
            overflow: "hidden",
          }}
        >
          {Array.from({ length: Math.min(gs.botHand.length, 15) }).map((_, i) =>
            renderCard("W_back", undefined, false, true, `bot-${i}`),
          )}
          {gs.botHand.length > 15 && (
            <span style={{ alignSelf: "center", fontSize: 12, opacity: 0.6 }}>
              +{gs.botHand.length - 15}
            </span>
          )}
          {gs.botHand.length === 0 && (
            <span style={{ fontSize: 12, color: "#00cc66", fontWeight: 800 }}>
              No cards!
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, opacity: 0.5 }}>
          {gs.botHand.length} card{gs.botHand.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table felt */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "8px 16px",
          background:
            "radial-gradient(circle at center, #145c2d 0%, #082d14 100%)",
          borderTop: "4px solid #4a2810",
          borderBottom: "4px solid #4a2810",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            padding: "4px 12px",
            borderRadius: 20,
            background: currentColorHex,
            fontSize: 11,
            fontWeight: 700,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.2)",
          }}
        >
          {COLOR_LABEL[gs.currentColor] ?? gs.currentColor}
        </div>
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            fontSize: 11,
            opacity: 0.7,
            fontWeight: 700,
          }}
        >
          {gs.currentTurn === "player" ? "⬇ Your turn" : "⬆ Bot's turn"}
        </div>
        {gs.drawPenalty > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: 10,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#ff3333",
              color: "#fff",
              padding: "4px 14px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 800,
              boxShadow: "0 0 12px rgba(255,51,51,0.5)",
              whiteSpace: "nowrap",
            }}
          >
            Draw penalty: {gs.drawPenalty}
          </div>
        )}
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <div
            onClick={isPlayerTurn ? playerDrawCard : undefined}
            style={{
              cursor: isPlayerTurn ? "pointer" : "default",
              opacity: isPlayerTurn ? 1 : 0.5,
            }}
          >
            {renderCard("W_back", undefined, needsToDraw, true, "draw")}
            <div
              style={{
                textAlign: "center",
                fontSize: 10,
                opacity: 0.6,
                marginTop: 4,
              }}
            >
              {gs.deck.length} left
            </div>
          </div>
          {renderCard(topCard, undefined, false, false, "discard")}
        </div>
      </div>

      {/* Player zone */}
      <div
        style={{
          flexShrink: 0,
          background: "#0a0b10",
          borderTop: "1.5px solid rgba(255,255,255,0.08)",
          padding: "10px 12px 16px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            paddingLeft: 4,
            paddingRight: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "linear-gradient(135deg,#3388ff,#0055cc)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 12,
                border: `2px solid ${isPlayerTurn ? "#ffcc00" : "rgba(255,255,255,0.15)"}`,
              }}
            >
              {nickname.charAt(0).toUpperCase()}
            </div>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{nickname}</span>
            {gs.playerCalledUno && (
              <span
                style={{
                  fontSize: 10,
                  background: "#ff3333",
                  color: "#fff",
                  padding: "1px 5px",
                  borderRadius: 4,
                  fontWeight: 800,
                }}
              >
                UNO
              </span>
            )}
            <span style={{ fontSize: 11, opacity: 0.5 }}>
              {gs.playerHand.length} cards
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {gs.playerHand.length === 1 && !gs.playerCalledUno && (
              <button
                onClick={callUno}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: "2px solid #ffcc00",
                  background: "rgba(255,204,0,0.2)",
                  color: "#ffcc00",
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: "pointer",
                  animation: "uno-btn-pulse 1.2s infinite",
                }}
              >
                UNO!
              </button>
            )}
            {gs.hasDrawnThisTurn && gs.drawPenalty === 0 && isPlayerTurn && (
              <button
                onClick={playerPassTurn}
                className="btn-secondary"
                style={{ padding: "4px 10px", fontSize: 12, minHeight: 30 }}
              >
                Pass
              </button>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 4,
            overflowX: "auto",
            paddingBottom: 4,
            paddingTop: 8,
            scrollbarWidth: "none",
            background: "#0a0b10",
          }}
        >
          {sortedHand.map((card, idx) => {
            const playable =
              isPlayerTurn &&
              isPlayable(
                card,
                gs.currentColor,
                gs.currentValue,
                gs.drawPenalty,
                gs.hasDrawnThisTurn,
              );
            return renderCard(
              card,
              playable ? () => playerPlayCard(card) : undefined,
              playable,
              false,
              `${card}-${idx}`,
            );
          })}
        </div>
      </div>
    </div>
  );
}
