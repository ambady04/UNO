"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { getStoredGuest } from "../../api";
import { gameSounds } from "../../sounds";

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

// ─── Display helpers ────────────────────────────────────────────────────────
const COLOR_MAP: Record<string, string> = {
  R: "var(--color-red)",
  Y: "var(--color-yellow)",
  G: "var(--color-green)",
  B: "var(--color-blue)",
  W: "var(--color-wild)",
};

const COLOR_LABEL: Record<string, string> = {
  R: "Red",
  Y: "Yellow",
  G: "Green",
  B: "Blue",
};

const COLOR_NAME: Record<string, string> = {
  R: "Red",
  G: "Green",
  B: "Blue",
  Y: "Yellow",
  W: "Wild",
};

function getCardName(cc: string, cv: string): string {
  if (cc === "W") {
    if (cv === "Draw4") return "Wild Draw 4";
    return "Wild";
  }
  const colorName = COLOR_NAME[cc] || cc;
  let valueName = cv;
  if (cv === "Draw2") valueName = "+2";
  return `${colorName} ${valueName}`;
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
    return [next, `Bot played ${getCardName(cc, cv)} — your turn is skipped!`];
  }
  if (cv === "Reverse") {
    next = { ...next, currentTurn: "bot" };
    return [next, `Bot played ${getCardName(cc, cv)} — acts as Skip in 1v1!`];
  }
  if (cv === "Draw2") {
    next = { ...next, drawPenalty: s.drawPenalty + 2, currentTurn: "player" };
    return [next, `Bot played ${getCardName(cc, cv)}! You must draw ${next.drawPenalty} card(s).`];
  }
  if (cv === "WildDraw4") {
    next = { ...next, drawPenalty: s.drawPenalty + 4, currentTurn: "player" };
    return [
      next,
      `Bot played ${getCardName(cc, cv)}! Color → ${COLOR_LABEL[color]}. Draw ${next.drawPenalty} card(s).`,
    ];
  }
  next = { ...next, currentTurn: "player" };
  return [next, unoMsg || `Bot played ${getCardName(cc, cv)}.`];
}

const getCardStyle = (index: number, total: number) => {
  let overlapDesktop = -30;
  let overlapMobile = -20;
  if (total > 15) { overlapDesktop = -54; overlapMobile = -32; }
  else if (total > 10) { overlapDesktop = -45; overlapMobile = -28; }
  else if (total > 6) { overlapDesktop = -36; overlapMobile = -24; }
  return {
    zIndex: index,
    position: "relative" as const,
    "--card-overlap": `${overlapDesktop}px`,
    "--card-overlap-mobile": `${overlapMobile}px`,
    marginRight: index === total - 1 ? "0px" : undefined,
  } as React.CSSProperties;
};

const renderReverseIcon = (size: string = "100%") => (
  <svg viewBox="0 0 100 100" style={{ width: size, height: size, fill: "currentColor", display: "block" }}>
    <path d="M 25,60 C 20,40 40,20 60,25 L 56,15 L 78,30 L 60,45 L 60,35 C 47,32 32,44 35,58 Z" />
    <path d="M 75,40 C 80,60 60,80 40,75 L 44,85 L 22,70 L 40,55 L 40,65 C 53,68 68,56 65,42 Z" />
  </svg>
);

function renderUnoCard(
  cardStr: string,
  onClick?: () => void,
  extraStyle?: React.CSSProperties,
  keyProp?: any,
  isPlayable?: boolean,
  isSelected?: boolean,
) {
  const parts = cardStr.split("_");
  const color = parts[0];
  const val = parts[1] || "";

  let colorClass = "card-back";
  if (color === "R") colorClass = "card-red";
  else if (color === "Y") colorClass = "card-yellow";
  else if (color === "G") colorClass = "card-green";
  else if (color === "B") colorClass = "card-blue";
  else if (color === "W") colorClass = "card-wild";

  const cardClasses = `uno-card ${colorClass} ${isPlayable ? "playable" : ""} ${isSelected ? "selected-card" : ""}`;

  if (colorClass === "card-back") {
    return <div key={keyProp} className={cardClasses} onClick={onClick} style={extraStyle} />;
  }

  let cornerLabel: React.ReactNode = val;
  if (val === "Draw2") cornerLabel = "+2";
  else if (val === "WildDraw4") cornerLabel = "+4";
  else if (val === "Wild") cornerLabel = "W";
  else if (val === "Skip") cornerLabel = "⊘";
  else if (val === "Reverse") {
    cornerLabel = (
      <div style={{ width: "12px", height: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {renderReverseIcon("100%")}
      </div>
    );
  }

  const isWild = color === "W";
  const isAction = ["Skip", "Reverse", "Draw2"].includes(val);
  const isNumber = !isWild && !isAction;

  return (
    <div key={keyProp} className={cardClasses} onClick={onClick} style={extraStyle}>
      <div className="card-corner top-left">{cornerLabel}</div>
      <div className="card-center">
        {isWild ? (
          <div className="card-center-wild-pill"><span>{val === "WildDraw4" ? "+4" : "W"}</span></div>
        ) : isNumber ? (
          <div className="card-center-solid-circle"><span>{val}</span></div>
        ) : val === "Reverse" ? (
          <div className="card-center-oval" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 4 }}>
            <div style={{ width: "36px", height: "36px", color: "currentColor" }}>{renderReverseIcon("100%")}</div>
          </div>
        ) : (
          <div className="card-center-oval"><span className="card-center-value">{cornerLabel}</span></div>
        )}
      </div>
      <div className="card-corner bottom-right">{cornerLabel}</div>
    </div>
  );
}

function sortHand(hand: Card[]): Card[] {
  const co: Record<string, number> = { R: 0, Y: 1, G: 2, B: 3, W: 4 };
  const vo: Record<string, number> = { "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, Skip: 10, Reverse: 11, Draw2: 12, Wild: 13, WildDraw4: 14 };
  return [...hand].sort((a, b) => {
    const [ca, va] = a.split("_"), [cb, vb] = b.split("_");
    const d = (co[ca] ?? 99) - (co[cb] ?? 99);
    return d !== 0 ? d : (vo[va] ?? 99) - (vo[vb] ?? 99);
  });
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function BotGamePage() {
  const router = useRouter();
  const params = useParams();
  const code = (params?.code as string ?? "").toUpperCase();
  const storageKey = `uno_bot_game_state_${code}`;

  const [nickname, setNickname] = useState("You");
  const [gs, setGs] = useState<BotGameState | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const toastIdRef = useRef(0);

  const showMsg = useCallback((text: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, text }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const [pendingWild, setPendingWild] = useState<Card | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [botThinking, setBotThinking] = useState(false);
  const [confettiParticles, setConfettiParticles] = useState<
    { id: number; dx: string; dy: string; color: string; rot: string; duration: string; left: string; top: string }[]
  >([]);

  const prevGsRef = useRef<BotGameState | null>(null);
  const botTurnInProgressRef = useRef(false);

  // Play sound effects dynamically based on state transitions
  useEffect(() => {
    if (gs && prevGsRef.current) {
      const prev = prevGsRef.current;
      const current = gs;
      if (prev.gameStatus !== "FINISHED" && current.gameStatus === "FINISHED") {
        gameSounds.play(current.winner === "player" ? "gameWin" : "gameOver");
      } else if (current.gameStatus === "PLAYING") {
        const prevTop = prev.discardPile[prev.discardPile.length - 1];
        const currTop = current.discardPile[current.discardPile.length - 1];
        if (currTop && currTop !== prevTop) {
          const parts = currTop.split("_");
          const val = parts[1];
          if (val === "WildDraw4") gameSounds.play("playPlus4");
          else if (val === "Draw2") gameSounds.play("playPlus2");
          else if (parts[0] === "W" && val === "Wild") gameSounds.play("playWild");
          else gameSounds.play("playCard");
        } else if (current.deck.length !== prev.deck.length) {
          gameSounds.play(prev.deck.length - current.deck.length > 1 ? "gameStart" : "drawCard");
        }
        if (current.currentTurn === "player" && prev.currentTurn !== "player") gameSounds.play("myTurn");
        if (current.playerCalledUno && !prev.playerCalledUno) gameSounds.play("unoShout");
        else if (current.botCalledUno && !prev.botCalledUno) gameSounds.play("unoShout");
      }
    } else if (gs && !prevGsRef.current) {
      gameSounds.play("gameStart");
    }
    prevGsRef.current = gs;
  }, [gs]);

  // Confetti on win
  useEffect(() => {
    if (gs?.gameStatus === "FINISHED" && gs?.winner === "player") {
      const colors = ["#ff3333", "#ffcc00", "#00cc66", "#3388ff", "#ff00ff", "#00ffff"];
      setConfettiParticles(
        Array.from({ length: 150 }).map((_, i) => {
          const angle = Math.random() * 2 * Math.PI;
          const distance = Math.random() * 350 + 150;
          return {
            id: i,
            dx: `${Math.cos(angle) * distance}px`,
            dy: `${Math.sin(angle) * distance}px`,
            color: colors[Math.floor(Math.random() * colors.length)],
            rot: `${Math.random() * 360}deg`,
            duration: `${Math.random() * 1.5 + 1.2}s`,
            left: `calc(50% + ${Math.random() * 40 - 20}px)`,
            top: `calc(50% + ${Math.random() * 40 - 20}px)`,
          };
        })
      );
    } else {
      setConfettiParticles([]);
    }
  }, [gs?.gameStatus, gs?.winner]);

  // Auto-pass when no playable card after drawing
  useEffect(() => {
    if (!gs || gs.gameStatus !== "PLAYING" || gs.currentTurn !== "player") return;
    if (gs.hasDrawnThisTurn && gs.drawPenalty === 0) {
      const hasPlayableCard = gs.playerHand.some((c) =>
        isPlayable(c, gs.currentColor, gs.currentValue, gs.drawPenalty, gs.hasDrawnThisTurn)
      );
      if (!hasPlayableCard) {
        const timer = setTimeout(() => playerPassTurn(), 1200);
        return () => clearTimeout(timer);
      }
    }
  }, [gs?.hasDrawnThisTurn, gs?.drawPenalty, gs?.playerHand, gs?.currentColor, gs?.currentValue, gs?.currentTurn, gs?.gameStatus, showMsg]);

  // Bot catches player not calling UNO
  useEffect(() => {
    if (!gs || gs.gameStatus !== "PLAYING") return;
    if (gs.playerHand.length === 1 && !gs.playerCalledUno) {
      const timer = setTimeout(() => {
        setGs((current) => {
          if (!current || current.gameStatus !== "PLAYING" || current.playerHand.length !== 1 || current.playerCalledUno) return current;
          const { drawn, deck, discard } = drawCards(current.deck, current.discardPile, 2);
          showMsg("🤖 Bot caught you not calling UNO! Draw 2 cards.");
          gameSounds.play("reportNoUno");
          return { ...current, playerHand: [...current.playerHand, ...drawn], deck, discardPile: discard, playerCalledUno: true };
        });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [gs?.playerHand?.length, gs?.playerCalledUno, gs?.gameStatus, showMsg]);

  function handleExit() {
    if (typeof window !== "undefined") localStorage.removeItem(storageKey);
    router.push("/");
  }

  // Load state from localStorage on mount
  useEffect(() => {
    const stored = getStoredGuest();
    const muted = gameSounds.getMute();
    const saved = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
    const id = setTimeout(() => {
      if (stored) setNickname(stored.nickname);
      setIsMuted(muted);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.gameStatus === "PLAYING") setGs(parsed);
        } catch (e) {
          console.error("Failed to parse saved bot game state", e);
        }
      }
    }, 0);
    return () => clearTimeout(id);
  }, [storageKey]);

  // Save state to localStorage
  useEffect(() => {
    if (!gs) return;
    if (gs.gameStatus === "PLAYING") {
      localStorage.setItem(storageKey, JSON.stringify(gs));
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [gs, storageKey]);

  function startGame() {
    setGs(initGame());
    setPendingWild(null);
    setToasts([]);
  }

  // ─── Bot turn ────────────────────────────────────────────────────────────────
  const runBotTurn = useCallback(
    (currentGs: BotGameState) => {
      setBotThinking(true);
      const delay = 900 + Math.random() * 600;
      setTimeout(() => {
        setBotThinking(false);
        const s = { ...currentGs, botHand: [...currentGs.botHand], deck: [...currentGs.deck], discardPile: [...currentGs.discardPile] };
        const pick = botPickCard(s.botHand, s.currentColor, s.currentValue, s.drawPenalty, s.hasDrawnThisTurn);

        let nextState: BotGameState;
        let msg: string;

        if (!pick) {
          if (s.drawPenalty > 0) {
            const count = s.drawPenalty;
            const { drawn, deck, discard } = drawCards(s.deck, s.discardPile, count);
            nextState = { ...s, botHand: [...s.botHand, ...drawn], deck, discardPile: discard, drawPenalty: 0, hasDrawnThisTurn: false, currentTurn: "player" };
            msg = `Bot drew ${count} card(s) and passed.`;
          } else {
            const { drawn, deck, discard } = drawCards(s.deck, s.discardPile, 1);
            const afterDraw = { ...s, botHand: [...s.botHand, ...drawn], deck, discardPile: discard, hasDrawnThisTurn: true, botCalledUno: false };
            const pick2 = botPickCard(afterDraw.botHand, afterDraw.currentColor, afterDraw.currentValue, afterDraw.drawPenalty, afterDraw.hasDrawnThisTurn);
            if (!pick2) {
              nextState = { ...afterDraw, hasDrawnThisTurn: false, currentTurn: "player" };
              msg = "Bot drew a card and passed.";
            } else {
              [nextState, msg] = applyBotPlayPure(afterDraw, pick2.card, pick2.chosenColor);
            }
          }
        } else {
          [nextState, msg] = applyBotPlayPure(s, pick.card, pick.chosenColor);
        }

        botTurnInProgressRef.current = false;
        setGs((prev) => ({ ...nextState, playerCalledUno: prev?.playerCalledUno ? prev.playerCalledUno : nextState.playerCalledUno }));
        if (msg) showMsg(msg);
      }, delay);
    },
    [showMsg],
  );

  useEffect(() => {
    if (!gs || gs.gameStatus !== "PLAYING") { botTurnInProgressRef.current = false; return; }
    if (gs.currentTurn !== "bot") { botTurnInProgressRef.current = false; return; }
    if (botTurnInProgressRef.current) return;
    botTurnInProgressRef.current = true;
    const id = setTimeout(() => runBotTurn(gs), 0);
    return () => clearTimeout(id);
  }, [gs, runBotTurn]);

  // ─── Player actions ──────────────────────────────────────────────────────────
  function playerPlayCard(card: Card) {
    if (!gs || gs.currentTurn !== "player" || gs.gameStatus !== "PLAYING") return;
    if (!isPlayable(card, gs.currentColor, gs.currentValue, gs.drawPenalty, gs.hasDrawnThisTurn)) {
      showMsg("That card can't be played right now.");
      return;
    }
    if (card.startsWith("W_")) { setPendingWild(card); return; }
    applyPlayerPlay(card);
  }

  function applyPlayerPlay(card: Card, chosenColor?: string) {
    setPendingWild(null);
    if (!gs) return;
    const [cc, cv] = card.split("_");
    const playerHand = gs.playerHand.filter((c) => c !== card);
    const color = cc === "W" ? (chosenColor ?? "R") : cc;
    const base: BotGameState = { ...gs, playerHand, discardPile: [...gs.discardPile, card], currentValue: cv, currentColor: color, playerCalledUno: false, hasDrawnThisTurn: false, drawPenalty: 0 };

    if (playerHand.length === 0) { setGs({ ...base, gameStatus: "FINISHED", winner: "player" }); return; }

    let next = base;
    let msg = "";
    if (cv === "Skip") {
      next = { ...base, currentTurn: "player" };
      msg = `${nickname} played ${getCardName(cc, cv)} — bot's turn skipped!`;
    } else if (cv === "Reverse") {
      next = { ...base, currentTurn: "player" };
      msg = `${nickname} played ${getCardName(cc, cv)} — acts as Skip in 1v1!`;
    } else if (cv === "Draw2") {
      const penalty = gs.drawPenalty + 2;
      next = { ...base, drawPenalty: penalty, currentTurn: "bot" };
      msg = `${nickname} played ${getCardName(cc, cv)}! Bot must draw ${penalty} card(s).`;
    } else if (cv === "WildDraw4") {
      const penalty = gs.drawPenalty + 4;
      next = { ...base, drawPenalty: penalty, currentTurn: "bot" };
      msg = `${nickname} played ${getCardName(cc, cv)}! Color → ${COLOR_LABEL[color]}. Bot must draw ${penalty} card(s).`;
    } else {
      next = { ...base, currentTurn: "bot" };
      msg = `${nickname} played ${getCardName(cc, cv)}.`;
    }

    setGs(next);
    if (msg) showMsg(msg);
  }

  function playerDrawCard() {
    if (!gs || gs.currentTurn !== "player" || gs.gameStatus !== "PLAYING") return;
    if (gs.hasDrawnThisTurn && gs.drawPenalty === 0) { showMsg("You already drew. Play a card or pass."); return; }
    const count = gs.drawPenalty > 0 ? gs.drawPenalty : 1;
    const { drawn, deck, discard } = drawCards(gs.deck, gs.discardPile, count);
    showMsg(gs.drawPenalty > 0 ? `You drew ${count} card(s) as penalty.` : `You drew a card.`);
    setGs({ ...gs, playerHand: [...gs.playerHand, ...drawn], deck, discardPile: discard, drawPenalty: 0, hasDrawnThisTurn: gs.drawPenalty === 0, playerCalledUno: false, currentTurn: gs.drawPenalty > 0 ? "bot" : gs.currentTurn });
  }

  function playerPassTurn() {
    if (!gs || gs.currentTurn !== "player" || gs.gameStatus !== "PLAYING") return;
    if (!gs.hasDrawnThisTurn) { showMsg("Draw a card first before passing."); return; }
    setGs({ ...gs, hasDrawnThisTurn: false, currentTurn: "bot" });
    showMsg("You passed. Bot's turn.");
  }

  function callUno() {
    if (!gs || gs.playerHand.length !== 1) { showMsg("You can only call UNO with 1 card left!"); return; }
    setGs({ ...gs, playerCalledUno: true });
    showMsg("🎉 UNO!");
  }

  // ─── Pre-game ───────────────────────────────────────────────────────────────
  if (!gs) {
    return (
      <div className="lobby-container">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🤖</div>
          <h1 className="lobby-title" style={{ margin: "0 0 4px 0" }}>Play vs Bot</h1>
          <p style={{ opacity: 0.6, fontSize: 14, margin: 0 }}>1v1 match against the AI</p>
        </div>
        <div className="glass-panel" style={{ width: "100%", padding: 24, boxSizing: "border-box", textAlign: "center" }}>
          <p style={{ marginBottom: 20, fontSize: 14, opacity: 0.7 }}>
            Play a classic UNO 1v1 game against a bot. All standard rules apply — first to empty their hand wins!
          </p>
          <button onClick={startGame} className="btn-primary" style={{ marginBottom: 12 }}>Start Game</button>
          <button onClick={handleExit} className="btn-secondary">← Back to Lobby</button>
        </div>
      </div>
    );
  }

  // ─── Finished ───────────────────────────────────────────────────────────────
  if (gs.gameStatus === "FINISHED") {
    const won = gs.winner === "player";
    return (
      <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", justifyContent: "center", gap: 24, minHeight: "100vh" }}>
        {won && (
          <div className="confetti-container">
            {confettiParticles.map((p) => (
              <div key={p.id} className="confetti-particle" style={{ left: p.left, top: p.top, backgroundColor: p.color, ["--dx" as any]: p.dx, ["--dy" as any]: p.dy, ["--rot" as any]: p.rot, ["--duration" as any]: p.duration }} />
            ))}
          </div>
        )}
        <div className="glass-panel" style={{ padding: 32, textAlign: "center", maxWidth: 500, margin: "0 auto", width: "100%", zIndex: 10 }}>
          <span style={{ fontSize: 64, display: "block", marginBottom: 12 }}>{won ? "🏆" : "😢"}</span>
          <h2 style={{ margin: "0 0 8px 0", fontSize: 28, fontWeight: 900, color: won ? "#ffcc00" : "#ff5555" }}>
            {won ? "You Win!" : "Bot Wins!"}
          </h2>
          <p style={{ opacity: 0.6, fontSize: 14, margin: "0 0 28px 0" }}>
            {won ? `Congrats ${nickname}! You beat the bot!` : "Better luck next time!"}
          </p>
          <button onClick={startGame} className="btn-primary" style={{ marginBottom: 12 }}>Play Again</button>
          <button onClick={handleExit} className="btn-secondary">← Back to Lobby</button>
        </div>
      </div>
    );
  }

  // ─── Derived ─────────────────────────────────────────────────────────────────
  const topCard = gs.discardPile[gs.discardPile.length - 1];
  const sortedHand = sortHand(gs.playerHand);
  const isPlayerTurn = gs.currentTurn === "player";
  const hasPlayable = sortedHand.some((c) => isPlayable(c, gs.currentColor, gs.currentValue, gs.drawPenalty, gs.hasDrawnThisTurn));
  const needsToDraw = isPlayerTurn && (gs.drawPenalty > 0 || (!gs.hasDrawnThisTurn && !hasPlayable));

  // ─── Board ───────────────────────────────────────────────────────────────────
  return (
    <div className="uno-table">
      {/* Header */}
      <div className="game-header-top" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)", position: "absolute", top: 0, left: 0, right: 0, height: 52, zIndex: 100 }}>
        <strong className="game-header-logo-text" style={{ fontSize: 14, letterSpacing: 0.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 1 }}>
          <span style={{ color: "#ffcc00ff" }}>UNO!</span>
          <span className="hide-mobile" style={{ color: "#e41010ff" }}> You vs Bot</span>
        </strong>

        {/* Inline turn/color headers for mobile screen space saving only */}
        <div className="mobile-header-indicators" style={{ display: "none", gap: 6, alignItems: "center", flex: 1, justifyContent: "center", padding: "0 4px" }}>
          <div style={{ padding: "4px 8px", borderRadius: 8, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", color: isPlayerTurn ? "#ffcc00" : "#fff", fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
            {isPlayerTurn ? "YOUR TURN" : "BOT'S TURN"}
          </div>
          <div style={{
            background: gs.currentColor === "R" ? "var(--color-red)" : gs.currentColor === "Y" ? "var(--color-yellow)" : gs.currentColor === "G" ? "var(--color-green)" : gs.currentColor === "B" ? "var(--color-blue)" : "#333",
            color: gs.currentColor === "Y" ? "#000" : "#fff",
            fontWeight: 800,
            padding: "4px 8px",
            fontSize: 10,
            borderRadius: 8,
            whiteSpace: "nowrap"
          }}>
            {gs.currentColor === "R" ? "Red" : gs.currentColor === "Y" ? "Yellow" : gs.currentColor === "G" ? "Green" : gs.currentColor === "B" ? "Blue" : "None"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          <button
            onClick={() => { const m = !isMuted; setIsMuted(m); gameSounds.setMute(m); }}
            className="btn-secondary"
            style={{ padding: "4px 8px", fontSize: 14, minHeight: 30, minWidth: 34, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            {isMuted ? "🔇" : "🔊"}
          </button>
          <button onClick={handleExit} className="btn-secondary" style={{ padding: "4px 10px", fontSize: 12, minHeight: 30, borderColor: "rgba(255,51,51,0.3)", color: "#ff5555" }}>
            Exit
          </button>
        </div>
      </div>

      {/* Toast stack — positioned dynamically and prevents clipping */}
      <div style={{ position: "fixed", bottom: "210px", left: "16px", right: "16px", display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: 6, zIndex: 300, pointerEvents: "none" }}>
        {toasts.map((t) => (
          <div key={t.id} className="game-alert alert-success" style={{ position: "relative", bottom: "auto", left: "auto", transform: "none", whiteSpace: "normal", wordBreak: "break-word", textAlign: "center", fontSize: 12, maxWidth: "100%", padding: "8px 16px" }}>
            {t.text}
          </div>
        ))}
      </div>

      {/* Bot Avatar */}
      <div className="opponents-top" style={{ marginTop: 52 }}>
        <div className={`opponent-avatar ${gs.currentTurn === "bot" ? "active-turn" : ""}`} style={{ position: "relative" }}>
          <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>🤖 Bot</span>
          <div className="opponent-card-stack">
            {Array.from({ length: Math.min(3, gs.botHand.length) }).map((_, cIdx) => (
              <div key={cIdx} className="opponent-card-mini" style={{ left: `${8 + cIdx * 4}px`, transform: `rotate(${cIdx * 6 - 6}deg)`, zIndex: cIdx, boxShadow: "-1px 1px 3px rgba(0,0,0,0.25)" }} />
            ))}
            {gs.botHand.length === 0 && <span style={{ fontSize: 9, color: "#00cc66", fontWeight: 800 }}>Won!</span>}
          </div>
          <span style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{gs.botHand.length} card{gs.botHand.length !== 1 ? "s" : ""}</span>
          {gs.botCalledUno && (
            <span style={{ position: "absolute", bottom: -6, right: -6, fontSize: 10, background: "#ff3333", color: "#ffffff", padding: "2px 6px", borderRadius: 6, fontWeight: 800, boxShadow: "0 0 8px rgba(255,51,51,0.6)", letterSpacing: 0.5, zIndex: 10 }}>UNO</span>
          )}
          {botThinking && (
            <span style={{ position: "absolute", top: "50%", left: "calc(100% + 12px)", transform: "translateY(-50%)", fontSize: 11, opacity: 0.8, background: "rgba(0,0,0,0.6)", padding: "3px 8px", borderRadius: 8, whiteSpace: "nowrap" }}>thinking...</span>
          )}
        </div>
      </div>

      {/* Felt Table */}
      <div className="table-felt" style={{ marginTop: "52px" }}>
        {/* Turn & Color (Hidden on mobile since they are now in the top header) */}
        <div className="table-header-row hide-mobile" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", zIndex: 30 }}>
          <div style={{ padding: "5px 12px", borderRadius: 12, background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)", color: isPlayerTurn ? "#ffcc00" : "#fff", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
            {isPlayerTurn ? "👉 YOUR TURN 👈" : "🤖 BOT'S TURN"}
          </div>
          <div className="color-banner" style={{ background: gs.currentColor === "R" ? "var(--color-red)" : gs.currentColor === "Y" ? "var(--color-yellow)" : gs.currentColor === "G" ? "var(--color-green)" : gs.currentColor === "B" ? "var(--color-blue)" : "#333", color: gs.currentColor === "Y" ? "#000" : "#fff", fontWeight: 900, padding: "5px 12px", fontSize: 12, borderRadius: 12, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
            <span>COLOR: {gs.currentColor === "R" ? "Red" : gs.currentColor === "Y" ? "Yellow" : gs.currentColor === "G" ? "Green" : gs.currentColor === "B" ? "Blue" : "None"}</span>
          </div>
        </div>

        {/* Piles */}
        <div className="pile-container">
          <div
            onClick={isPlayerTurn ? playerDrawCard : undefined}
            className={`uno-card card-back deck-stack-3d ${needsToDraw ? "active-turn" : ""}`}
            style={{ cursor: isPlayerTurn && (!gs.hasDrawnThisTurn || gs.drawPenalty > 0) ? "pointer" : "not-allowed", opacity: isPlayerTurn && (!gs.hasDrawnThisTurn || gs.drawPenalty > 0) ? 1 : 0.7, position: "relative" }}
          >
            <div style={{ position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)", background: "rgba(255,255,255,1)", border: "1.5px solid #ff0000", color: "#ff0000", borderRadius: "10px", padding: "2px 8px", fontSize: "11px", fontWeight: 900, boxShadow: "0 2px 8px rgba(0,0,0,0.4)", zIndex: 20, whiteSpace: "nowrap" }}>
              {gs.deck.length}
            </div>
          </div>
          <div style={{ display: "inline-flex" }}>
            {gs.discardPile.length > 0 && renderUnoCard(topCard, undefined, { cursor: "default", animation: "card-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }, topCard)}
          </div>
        </div>

        {/* Draw penalty alert */}
        {gs.drawPenalty > 0 && isPlayerTurn && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,40,40,0.18)", border: "1.5px solid rgba(255,80,80,0.55)", borderRadius: 12, padding: "7px 20px", color: "#ff5555", fontWeight: 800, fontSize: 14, letterSpacing: 0.4, boxShadow: "0 0 16px rgba(255,51,51,0.25)", animation: "pulse 1.2s infinite", marginTop: 12 }}>
            ⚠️ Draw {gs.drawPenalty} card{gs.drawPenalty !== 1 ? "s" : ""}! Click the deck!
          </div>
        )}

        {/* No playable cards hint */}
        {isPlayerTurn && gs.drawPenalty === 0 && !gs.hasDrawnThisTurn && gs.playerHand.length > 0 && !hasPlayable && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,170,0,0.12)", border: "1px solid rgba(255,170,0,0.4)", borderRadius: 10, padding: "5px 14px", color: "#ffaa00", fontWeight: 700, fontSize: 12, marginTop: 12 }}>
            🎴 No playable cards — draw from the deck!
          </div>
        )}

        {/* Action buttons */}
        <div className="table-action-row" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12, zIndex: 30 }}>
          <button onClick={callUno} className="btn-uno-shout" disabled={!(gs.playerHand.length === 1 && !gs.playerCalledUno)}>UNO</button>
          {gs.hasDrawnThisTurn && gs.drawPenalty === 0 && isPlayerTurn && hasPlayable && (
            <button onClick={playerPassTurn} className="btn-primary" style={{ background: "#00cc66", color: "#fff", minHeight: 44, padding: "0 20px", width: "auto", borderRadius: 12, fontSize: 14, fontWeight: 800, boxShadow: "0 0 12px rgba(0,204,102,0.4)", letterSpacing: 0.5 }}>✓ Pass</button>
          )}
        </div>
      </div>

      {/* Player Hand */}
      <div className="player-bottom-panel">
        <div className="hand-wrapper" style={{ position: "relative" }}>
          <div className="hand-container">
            {sortedHand.map((card, idx) => {
              const isCardPlayable = isPlayerTurn && isPlayable(card, gs.currentColor, gs.currentValue, gs.drawPenalty, gs.hasDrawnThisTurn);
              const baseStyle = getCardStyle(idx, gs.playerHand.length);
              return (
                <div
                  className="hand-card-wrapper"
                  key={idx}
                  style={{ ...baseStyle, cursor: isCardPlayable ? "pointer" : "not-allowed", zIndex: isCardPlayable ? 1000 + idx : idx, transform: isCardPlayable ? "translateY(-10px)" : "translateY(0px)", transition: "transform 0.2s ease, filter 0.2s ease" }}
                  onClick={() => { if (isCardPlayable) playerPlayCard(card); }}
                >
                  {renderUnoCard(card, undefined, { transform: isCardPlayable ? "translateY(-4px) scale(1.08)" : "scale(1.0)", opacity: 1, filter: isCardPlayable ? "none" : "saturate(0.3) brightness(0.38)", cursor: isCardPlayable ? "pointer" : "not-allowed", pointerEvents: "none" }, idx, isCardPlayable, false)}
                </div>
              );
            })}
          </div>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "0 12px 6px 12px", fontSize: 13, pointerEvents: "none", zIndex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "rgba(255,255,255,0.8)" }}>Your Hand ({gs.playerHand.length} cards)</span>
              {gs.playerCalledUno && (
                <span style={{ fontSize: 10, background: "#ff3333", color: "#ffffff", padding: "2px 6px", borderRadius: 6, fontWeight: 800, boxShadow: "0 0 8px rgba(255,51,51,0.6)", letterSpacing: 0.5 }}>UNO DECLARED</span>
              )}
            </div>
            {isPlayerTurn && <span style={{ color: "#ffcc00", fontWeight: 800 }}>Your Turn to Play!</span>}
          </div>
        </div>
      </div>

      {/* Wild color picker */}
      {pendingWild && (
        <div className="modal-overlay-animate" style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(10px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999, padding: 24 }}>
          <div className="glass-panel modal-content-animate" style={{ padding: 32, maxWidth: 380, width: "100%", textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.6)", border: "1px solid rgba(255,255,255,0.15)" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>{pendingWild.includes("WildDraw4") ? "⚡" : "🎨"}</div>
            <h3 style={{ margin: "0 0 6px 0", fontSize: 20, fontWeight: 900 }}>{pendingWild.includes("WildDraw4") ? "Wild +4" : "Wild Card"}</h3>
            <p style={{ margin: "0 0 24px 0", fontSize: 13, opacity: 0.6 }}>Choose a color to continue</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[{ code: "R", label: "Red", bg: "var(--color-red)", text: "#fff" }, { code: "Y", label: "Yellow", bg: "var(--color-yellow)", text: "#000" }, { code: "G", label: "Green", bg: "var(--color-green)", text: "#fff" }, { code: "B", label: "Blue", bg: "var(--color-blue)", text: "#fff" }].map(({ code: c, label, bg, text }) => (
                <button key={c} onClick={() => applyPlayerPlay(pendingWild, c)} style={{ background: bg, color: text, border: "3px solid transparent", borderRadius: 14, padding: "18px 12px", fontSize: 16, fontWeight: 900, cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s", boxShadow: "0 4px 15px rgba(0,0,0,0.3)", letterSpacing: 1 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.07)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                >{label}</button>
              ))}
            </div>
            <button onClick={() => setPendingWild(null)} className="btn-secondary" style={{ marginTop: 16, width: "100%", minHeight: 40, fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
