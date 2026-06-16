'use client';

/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/immutability, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element */

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  getStoredGuest,
  getRoomDetails,
  joinRoom,
  RoomResponse
} from '../../api';
import { gameSounds } from '../../sounds';

interface PlayerState {
  id: string;
  name: string;
  is_connected: boolean;
  called_uno: boolean;
  card_count: number;
}

interface FilteredGameState {
  room_code: string;
  game_status: 'LOBBY' | 'PLAYING' | 'FINISHED';
  version: number;
  current_turn: number;
  direction: number;
  discard_pile: string[];
  current_color: string;
  current_value: string;
  turn_started_at: number;
  has_drawn_this_turn: boolean;
  draw_penalty: number;
  winner_id?: string;
  winner_name?: string;
  deck_count: number;
  players: PlayerState[];
  hand: string[];
}

interface ChatMessage {
  sender_id: string;
  sender_name: string;
  message: string;
  timestamp: number;
}

export default function RoomPage() {
  const router = useRouter();
  const params = useParams();
  const roomCode = ((params?.code as string) || '').toUpperCase();

  const [guest, setGuest] = useState<{ token: string; nickname: string } | null>(null);
  const [roomDetails, setRoomDetails] = useState<RoomResponse | null>(null);
  const [gameState, setGameState] = useState<FilteredGameState | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  // UI states
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertMessage, setAlertMessage] = useState('');
  const [alertType, setAlertType] = useState<'success' | 'error'>('error');
  const [pendingWildCard, setPendingWildCard] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [flyingCardData, setFlyingCardData] = useState<{
    card: string;
    cardIdx: number;  // index in the sorted hand — to hide exactly that slot
    startX: number; startY: number;
    endX: number; endY: number;
    width: number; height: number;
  } | null>(null);

  // Custom Confirmation Dialog State
  const [activeConfirm, setActiveConfirm] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // References
  const socketRef = useRef<WebSocket | null>(null);
  const localVersionRef = useRef<number>(-1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const turnTimerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const isUnmountedRef = useRef<boolean>(false);
  const isChatOpenRef = useRef<boolean>(false); // mirrors isChatOpen to avoid side effects in state updaters
  const discardPileRef = useRef<HTMLDivElement>(null); // anchor for flying card animation
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [confettiParticles, setConfettiParticles] = useState<{ id: number; dx: string; dy: string; color: string; rot: string; duration: string; left: string; top: string }[]>([]);

  // Keep the ref in sync with the state
  useEffect(() => { isChatOpenRef.current = isChatOpen; }, [isChatOpen]);

  // Listen for mobile viewport sizes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const prevGameStateRef = useRef<FilteredGameState | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);

  // Close chat on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isChatOpen &&
        chatRef.current &&
        !chatRef.current.contains(event.target as Node)
      ) {
        const target = event.target as HTMLElement;
        if (!target.closest('.chat-toggle-btn')) {
          setIsChatOpen(false);
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isChatOpen]);

  // Initialize mute state
  useEffect(() => {
    setIsMuted(gameSounds.getMute());
  }, []);

  // Play sound effects dynamically based on state transitions
  useEffect(() => {
    if (gameState && prevGameStateRef.current) {
      const prev = prevGameStateRef.current;
      const current = gameState;

      // 1. Detect Game Start
      if (prev.game_status === 'LOBBY' && current.game_status === 'PLAYING') {
        gameSounds.play('gameStart');
      }
      // 2. Detect Game Over
      else if (prev.game_status === 'PLAYING' && current.game_status === 'FINISHED') {
        const myToken = guest?.token;
        const isWinner = current.winner_id === myToken;
        if (isWinner) {
          gameSounds.play('gameWin');
        } else {
          gameSounds.play('gameOver');
        }
      }
      // 3. Detect Action: Card Played or Drawn or Turn Change or UNO callout
      else if (current.game_status === 'PLAYING') {
        // Compare discard pile top card
        const prevTop = prev.discard_pile?.[0];
        const currTop = current.discard_pile?.[0];
        if (currTop && currTop !== prevTop) {
          const parts = currTop.split('_');
          const color = parts[0];
          const val = parts[1];
          if (val === 'WildDraw4') {
            gameSounds.play('playPlus4');
          } else if (val === 'Draw2') {
            gameSounds.play('playPlus2');
          } else if (color === 'W' && val === 'Wild') {
            gameSounds.play('playWild');
          } else {
            gameSounds.play('playCard');
          }
        }
        // Compare deck count or hand card count to detect Draw Card
        // (Only play draw card sound if a card wasn't just played in the same update)
        else if (current.deck_count !== prev.deck_count) {
          gameSounds.play('drawCard');
        }

        // Compare turn changes (My Turn)
        const prevTurn = prev.current_turn;
        const currTurn = current.current_turn;
        if (currTurn !== prevTurn) {
          const myToken = guest?.token;
          const activePlayer = current.players[currTurn];
          if (activePlayer?.id === myToken) {
            gameSounds.play('myTurn');
          }
        }

        // Detect UNO declared
        const prevMyPlayer = prev.players.find(p => p.id === guest?.token);
        const currMyPlayer = current.players.find(p => p.id === guest?.token);
        if (currMyPlayer?.called_uno && !prevMyPlayer?.called_uno) {
          gameSounds.play('unoShout');
        } else {
          // Check if any other player declared UNO
          for (const p of current.players) {
            const prevP = prev.players.find(x => x.id === p.id);
            if (p.called_uno && !prevP?.called_uno) {
              gameSounds.play('unoShout');
              break;
            }
          }
        }
      }
    }
    prevGameStateRef.current = gameState;
  }, [gameState, guest]);

  // Trigger confetti explosion on finished
  useEffect(() => {
    if (gameState?.game_status === 'FINISHED') {
      const colors = ['#ff3333', '#ffcc00', '#00cc66', '#3388ff', '#ff00ff', '#00ffff'];
      const particles = Array.from({ length: 150 }).map((_, i) => {
        const angle = Math.random() * 2 * Math.PI;
        const distance = Math.random() * 350 + 150;
        const dx = `${Math.cos(angle) * distance}px`;
        const dy = `${Math.sin(angle) * distance}px`;
        const left = `calc(50% + ${Math.random() * 40 - 20}px)`;
        const top = `calc(50% + ${Math.random() * 40 - 20}px)`;
        return {
          id: i,
          dx,
          dy,
          color: colors[Math.floor(Math.random() * colors.length)],
          rot: `${Math.random() * 720 - 360}deg`,
          duration: `${Math.random() * 1.5 + 1}s`,
          left,
          top
        };
      });
      setConfettiParticles(particles);
    } else {
      setConfettiParticles([]);
    }
  }, [gameState?.game_status]);

  // Redirect if not signed in
  useEffect(() => {
    isUnmountedRef.current = false;
    const stored = getStoredGuest();
    if (!stored) {
      router.push(`/?redirect=${roomCode}`);
      return;
    }
    setGuest(stored);
    loadRoom(stored.token);

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      disconnectSocket();
      if (turnTimerIntervalRef.current) clearInterval(turnTimerIntervalRef.current);
    };
  }, [roomCode]);

  async function loadRoom(token: string) {
    try {
      let details = await getRoomDetails(roomCode);
      if (isUnmountedRef.current) return;

      // Check if current guest is already in the room's players list
      const isMember = details.players.some(p => p.user_id === token);
      if (!isMember) {
        // Auto-join the player to the database room lobby
        details = await joinRoom(roomCode);
      }

      if (isUnmountedRef.current) return;

      setRoomDetails(details);
      connectWebSocket(token);
    } catch (err: any) {
      if (isUnmountedRef.current) return;
      showAlert(err.message || 'Room not found or inaccessible.');
      setTimeout(() => {
        if (!isUnmountedRef.current) router.push('/');
      }, 3000);
    } finally {
      if (!isUnmountedRef.current) setLoading(false);
    }
  }

  function connectWebSocket(token: string) {
    // Don't connect if component is unmounted
    if (isUnmountedRef.current) return;

    // Close existing socket before creating new one
    if (socketRef.current) {
      socketRef.current.onclose = null;
      socketRef.current.onerror = null;
      socketRef.current.close();
      socketRef.current = null;
    }

    const wsBase = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';
    const wsUrl = `${wsBase}/ws/room/${roomCode}/?token=${token}`;
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connection opened.');
      reconnectAttemptsRef.current = 0; // reset backoff counter on success
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'game_state_update') {
        const state: FilteredGameState = data.state;
        const version: number = data.version;

        // Versioning: Ignore stale packets
        if (version < localVersionRef.current) {
          console.warn(`Ignoring stale state update: received version ${version}, current is ${localVersionRef.current}`);
          return;
        }

        localVersionRef.current = version;
        setGameState(state);
      }
      else if (data.type === 'chat_message') {
        const msg: ChatMessage = data;
        setChatMessages((prev) => [...prev, msg]);
        // Increment unread badge only for OTHER people's messages when chat is closed.
        // Use a ref (not a functional updater) to read isChatOpen — avoids React StrictMode
        // calling the updater twice which would double the count.
        const myToken = typeof window !== 'undefined' ? localStorage.getItem('uno_guest_token') : null;
        if (msg.sender_id !== myToken) {
          gameSounds.play('chat');
          if (!isChatOpenRef.current) {
            setUnreadCount((n) => n + 1);
          }
        }
      }
      else if (data.type === 'player_kicked') {
        const targetId = data.target_id;
        const myToken = typeof window !== 'undefined' ? localStorage.getItem('uno_guest_token') : null;
        if (targetId === myToken) {
          if (typeof window !== 'undefined') {
            localStorage.setItem('uno_kicked_message', 'You have been kicked from the room by the host.');
          }
          isUnmountedRef.current = true; // stop reconnecting
          disconnectSocket();
          router.push('/');
        } else {
          gameSounds.play('alert');
          showAlert("A player was kicked by the host.");
        }
      }
      else if (data.type === 'room_closed') {
        if (typeof window !== 'undefined') {
          localStorage.setItem('uno_kicked_message', 'The host has closed the room.');
        }
        isUnmountedRef.current = true; // stop reconnecting
        disconnectSocket();
        router.push('/');
      }
      else if (data.type === 'error') {
        showAlert(data.message);
      }
    };

    ws.onclose = (event) => {
      setWsConnected(false);
      console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason || 'none'}`);

      // Don't reconnect on explicit close codes (auth failure, kicked, unmounted)
      if (isUnmountedRef.current || event.code === 4001 || event.code === 4002) return;

      // Exponential backoff reconnect: 1s, 2s, 4s, 8s, max 10s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
      reconnectAttemptsRef.current += 1;
      console.log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttemptsRef.current})...`);

      // Reset version so we accept fresh state from server after reconnect
      localVersionRef.current = -1;

      reconnectTimerRef.current = setTimeout(() => {
        const stored = getStoredGuest();
        if (stored && !isUnmountedRef.current) {
          connectWebSocket(stored.token);
        }
      }, delay);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  }

  function disconnectSocket() {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }

  function sendSocketMessage(type: string, data: any = {}) {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      // Give a more helpful message indicating reconnect is happening
      const state = socketRef.current?.readyState;
      if (state === WebSocket.CONNECTING) {
        showAlert('Still connecting... please wait a moment and try again.');
      } else {
        showAlert('Connection lost. Reconnecting automatically — please try again in a moment.');
      }
      return;
    }
    const eventId = crypto.randomUUID();
    socketRef.current.send(JSON.stringify({
      type,
      event_id: eventId,
      client_version: localVersionRef.current,
      data
    }));
  }

  function showAlert(msg: string, type: 'success' | 'error' = 'error') {
    setAlertMessage(msg);
    setAlertType(type);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setAlertMessage('');
    }, 4000);
  }

  // Action mapping
  function handleStartGame() {
    sendSocketMessage('start_game');
  }

  function handleResetToLobby() {
    sendSocketMessage('reset_to_lobby');
  }

  async function handleLeaveRoom() {
    setActiveConfirm({
      message: 'Are you sure you want to leave this room?',
      onConfirm: async () => {
        try {
          sendSocketMessage('leave_room');
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.error(e);
        }
        isUnmountedRef.current = true;
        disconnectSocket();
        router.push('/');
      }
    });
  }

  function handlePlayCard(card: string, cardIdx: number, cardEl?: HTMLElement) {
    if (!gameState) return;

    // Check if it's the player's turn
    const activePlayer = gameState.players[gameState.current_turn];
    if (activePlayer.id !== guest?.token) {
      showAlert("It is not your turn.");
      return;
    }

    const [color] = card.split('_');

    // Check if wild card played
    if (color === 'W') {
      setPendingWildCard(card);
      return;
    }

    // If we can determine both positions, do the sliding animation overlay
    if (cardEl && discardPileRef.current) {
      // Use the inner .uno-card element's rect so we account for its own CSS transforms
      // (e.g. translateY(-8px) on playable cards) for a pixel-perfect overlay start
      const innerCard = (cardEl.firstElementChild as HTMLElement) ?? cardEl;
      const cardRect = innerCard.getBoundingClientRect();
      const discardRect = discardPileRef.current.getBoundingClientRect();
      setFlyingCardData({
        card,
        cardIdx,
        startX: cardRect.left,
        startY: cardRect.top,
        endX: discardRect.left + (discardRect.width  - cardRect.width)  / 2,
        endY: discardRect.top  + (discardRect.height - cardRect.height) / 2,
        width: cardRect.width,
        height: cardRect.height,
      });
      // Send after animation finishes; clear overlay at same time
      setTimeout(() => {
        sendSocketMessage('play_card', { card });
        setFlyingCardData(null);
      }, 290);
    } else {
      sendSocketMessage('play_card', { card });
    }
  }

  function submitWildCard(chosenColor: string) {
    if (!pendingWildCard) return;
    sendSocketMessage('play_card', {
      card: pendingWildCard,
      chosen_color: chosenColor
    });
    setPendingWildCard(null);
  }

  function handleDrawCard() {
    if (!gameState) return;

    // Check turn
    const activePlayer = gameState.players[gameState.current_turn];
    if (activePlayer.id !== guest?.token) {
      showAlert("It is not your turn.");
      return;
    }

    // If there's still a draw penalty, the player must keep drawing
    if ((gameState.draw_penalty || 0) > 0) {
      sendSocketMessage('draw_card');
      return;
    }

    // Normal draw: can only draw once per turn
    if (gameState.has_drawn_this_turn) {
      showAlert("You have already drawn a card this turn. You can play it or pass.");
      return;
    }

    sendSocketMessage('draw_card');
  }

  function handlePassTurn() {
    if (!gameState) return;

    const activePlayer = gameState.players[gameState.current_turn];
    if (activePlayer.id !== guest?.token) {
      showAlert("It is not your turn.");
      return;
    }

    if (!gameState.has_drawn_this_turn) {
      showAlert("You must draw a card before passing.");
      return;
    }

    sendSocketMessage('pass_turn');
  }

  function handleCallUno() {
    sendSocketMessage('call_uno');
    showAlert('You declared UNO!', 'success');
  }

  function handleCallOutUno(targetId: string) {
    gameSounds.play('reportNoUno');
    sendSocketMessage('call_out_uno', { target_id: targetId });
    showAlert('Calling out player!');
  }

  function handleReportNoUno() {
    if (!gameState) return;
    const target = gameState.players.find(p => p.id !== guest?.token && p.card_count === 1 && !p.called_uno);
    if (target) {
      handleCallOutUno(target.id);
    } else {
      showAlert("No players can be called out right now.");
    }
  }

  function handleKickPlayer(playerId: string) {
    setActiveConfirm({
      message: 'Are you sure you want to kick this player?',
      onConfirm: () => {
        sendSocketMessage('kick_player', { target_id: playerId });
      }
    });
  }

  function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatInput.trim()) return;
    sendSocketMessage('send_message', { message: chatInput.trim() });
    setChatInput('');
  }

  function copyInviteLink() {
    if (typeof window !== 'undefined') {
      const plainText = `🎮 *UNO! Game Invitation* 🃏\n━━━━━━━━━━━━━━━━━━━━━━\nJoin my room and let's play UNO!\n\n🔑 Room Code: ${roomCode}\n🔗 Link to join:\n${window.location.href}\n\nSee you in the game! 🚀`;

      const htmlText = `<div style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; max-width: 400px; padding: 12px; border: 1px solid #eaeaea; border-radius: 8px; background-color: #fafafa; color: #333;">` +
        `<h3 style="margin-top: 0; margin-bottom: 8px; color: #000; font-size: 16px; display: flex; align-items: center; gap: 6px;">🎮 UNO! Game Invitation 🃏</h3>` +
        `<div style="font-size: 14px; margin-bottom: 12px; color: #555;">Join my room and let's play UNO!</div>` +
        `<div style="font-size: 14px; margin-bottom: 8px;">🔑 <strong>Room Code:</strong> <code style="background: #eef2f6; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-weight: bold; color: #000;">${roomCode}</code></div>` +
        `<div style="font-size: 14px; margin-bottom: 12px;">🔗 <strong>Link to join:</strong> <a href="${window.location.href}" style="color: #0066cc; text-decoration: underline;">${window.location.href}</a></div>` +
        `<div style="font-size: 13px; font-style: italic; color: #888; margin-bottom: 0;">See you in the game! 🚀</div>` +
        `</div>`;

      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        const htmlBlob = new Blob([htmlText], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        const item = new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob
        });
        navigator.clipboard.write([item])
          .then(() => showAlert('Invite link copied to clipboard!', 'success'))
          .catch((err) => {
            console.error('Failed to write ClipboardItem:', err);
            navigator.clipboard.writeText(plainText);
            showAlert('Invite link copied to clipboard!', 'success');
          });
      } else {
        navigator.clipboard.writeText(plainText);
        showAlert('Invite link copied to clipboard!', 'success');
      }
    }
  }

  const sortHand = (hand: string[]) => {
    const colorOrder: Record<string, number> = { 'R': 0, 'Y': 1, 'G': 2, 'B': 3, 'W': 4 };
    const valueOrder: Record<string, number> = {
      '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
      'Skip': 10, 'Reverse': 11, 'Draw2': 12, 'Wild': 13, 'WildDraw4': 14
    };

    return [...hand].sort((a, b) => {
      const [colorA, valA] = a.split('_');
      const [colorB, valB] = b.split('_');

      const colorDiff = (colorOrder[colorA] ?? 99) - (colorOrder[colorB] ?? 99);
      if (colorDiff !== 0) return colorDiff;

      return (valueOrder[valA] ?? 99) - (valueOrder[valB] ?? 99);
    });
  };

  const checkPlayableClient = (card: string) => {
    if (!gameState) return false;
    const parts = card.split('_');
    const color = parts[0];
    const val = parts[1] || '';

    const penalty = gameState.draw_penalty || 0;
    if (penalty > 0) {
      if (gameState.has_drawn_this_turn) return false;
      if (gameState.current_value === 'Draw2') {
        return val === 'Draw2';
      } else if (gameState.current_value === 'WildDraw4') {
        return val === 'WildDraw4';
      }
      return false;
    }

    // Cannot play +4 (WildDraw4) over +2 (Draw2)
    if (val === 'WildDraw4' && gameState.current_value === 'Draw2') return false;

    // Cannot play +2 (Draw2) over +4 (WildDraw4)
    if (val === 'Draw2' && gameState.current_value === 'WildDraw4') return false;

    // Wild cards can always be played
    if (color === 'W') return true;

    // Same color or same value
    return color === gameState.current_color || val === gameState.current_value;
  };

  const getCardStyle = (index: number, total: number) => {
    // Dynamic overlaps based on total cards
    let overlapDesktop = -30;
    let overlapMobile = -20;

    if (total > 15) {
      overlapDesktop = -54;
      overlapMobile = -32;
    } else if (total > 10) {
      overlapDesktop = -45;
      overlapMobile = -28;
    } else if (total > 6) {
      overlapDesktop = -36;
      overlapMobile = -24;
    }

    return {
      zIndex: index,
      position: 'relative' as const,
      '--card-overlap': `${overlapDesktop}px`,
      '--card-overlap-mobile': `${overlapMobile}px`,
      marginRight: index === total - 1 ? '0px' : undefined,
    } as React.CSSProperties;
  };

  const renderReverseIcon = (size: string = '100%') => (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size, fill: 'currentColor', display: 'block' }}>
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
    isSelected?: boolean
  ) {
    const parts = cardStr.split('_');
    const color = parts[0];
    const val = parts[1] || '';

    let colorClass = 'card-back';
    if (color === 'R') colorClass = 'card-red';
    else if (color === 'Y') colorClass = 'card-yellow';
    else if (color === 'G') colorClass = 'card-green';
    else if (color === 'B') colorClass = 'card-blue';
    else if (color === 'W') colorClass = 'card-wild';

    const cardClasses = `uno-card ${colorClass} ${isPlayable ? 'playable' : ''} ${isSelected ? 'selected-card' : ''}`;

    if (colorClass === 'card-back') {
      return (
        <div key={keyProp} className={cardClasses} onClick={onClick} style={extraStyle} />
      );
    }

    let cornerLabel: React.ReactNode = val;
    if (val === 'Draw2') cornerLabel = '+2';
    else if (val === 'WildDraw4') cornerLabel = '+4';
    else if (val === 'Wild') cornerLabel = 'W';
    else if (val === 'Skip') cornerLabel = '⊘';
    else if (val === 'Reverse') {
      cornerLabel = (
        <div style={{ width: '12px', height: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {renderReverseIcon('100%')}
        </div>
      );
    }

    const isWild = (color === 'W');
    const isAction = ['Skip', 'Reverse', 'Draw2'].includes(val);
    const isNumber = !isWild && !isAction;

    return (
      <div key={keyProp} className={cardClasses} onClick={onClick} style={extraStyle}>
        <div className="card-corner top-left">{cornerLabel}</div>
        <div className="card-center">
          {isWild ? (
            <div className="card-center-wild-pill">
              <span>{val === 'WildDraw4' ? '+4' : 'W'}</span>
            </div>
          ) : isNumber ? (
            <div className="card-center-solid-circle">
              <span>{val}</span>
            </div>
          ) : val === 'Reverse' ? (
            <div className="card-center-oval" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
              <div style={{ width: '36px', height: '36px', color: 'currentColor' }}>
                {renderReverseIcon('100%')}
              </div>
            </div>
          ) : (
            <div className="card-center-oval">
              <span className="card-center-value">{cornerLabel}</span>
            </div>
          )}
        </div>
        <div className="card-corner bottom-right">{cornerLabel}</div>
      </div>
    );
  }

  // Auto-pass turn if the player draws a card and still has no playable cards
  useEffect(() => {
    if (!gameState) return;
    const activePlayer = gameState.players[gameState.current_turn];
    const isMyTurnNow = activePlayer?.id === guest?.token;

    if (
      gameState.game_status === 'PLAYING' &&
      isMyTurnNow &&
      gameState.has_drawn_this_turn &&
      (gameState.draw_penalty || 0) === 0
    ) {
      const hasPlayableCard = gameState.hand.some(c => checkPlayableClient(c));
      if (!hasPlayableCard) {
        console.log("Auto-passing turn: no playable cards in hand after drawing.");
        // Delay slightly (800ms) to allow the player to see what card they drew
        const timer = setTimeout(() => {
          handlePassTurn();
        }, 800);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState, guest]);

  if (loading || !gameState) {
    return (
      <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', color: '#fff' }}>
        <h2>Connecting to room...</h2>
      </div>
    );
  }

  const activePlayer = gameState ? gameState.players[gameState.current_turn] : null;
  const isMyTurn = activePlayer?.id === guest?.token;
  const myPlayer = gameState?.players.find(p => p.id === guest?.token);
  const canShoutUno = !!gameState && gameState.hand.length === 1 && !myPlayer?.called_uno;

  const needsToDraw = !!gameState && isMyTurn && (
    (gameState.draw_penalty || 0) > 0 ||
    (!gameState.has_drawn_this_turn && gameState.hand.every(c => !checkPlayableClient(c)))
  );

  const targetNoUnoPlayer = gameState?.players.find(
    p => p.id !== guest?.token && p.card_count === 1 && !p.called_uno
  );

  const leftOpponents: PlayerState[] = [];
  const topOpponents: PlayerState[] = [];
  const rightOpponents: PlayerState[] = [];

  if (gameState && gameState.game_status === 'PLAYING') {
    const myIndex = gameState.players.findIndex(p => p.id === guest?.token);
    const opponents: PlayerState[] = [];
    if (myIndex !== -1) {
      const rotated = [
        ...gameState.players.slice(myIndex + 1),
        ...gameState.players.slice(0, myIndex)
      ];
      opponents.push(...rotated);
    } else {
      opponents.push(...gameState.players);
    }

    opponents.forEach((op) => {
      topOpponents.push(op);
    });
  }

  function renderCompactOpponent(p: PlayerState) {
    const isActive = activePlayer?.id === p.id;
    const initial = p.name ? p.name.charAt(0).toUpperCase() : '?';
    return (
      <div
        key={p.id}
        className={`compact-opponent-card ${isActive ? 'active-turn' : ''} ${!p.is_connected ? 'offline' : ''}`}
        style={{ position: 'relative', cursor: (p.card_count === 1 && !p.called_uno) ? 'pointer' : 'default' }}
        onClick={() => {
          if (p.card_count === 1 && !p.called_uno) {
            handleCallOutUno(p.id);
          }
        }}
      >
        {roomDetails?.host_id === guest?.token && p.id !== guest?.token && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleKickPlayer(p.id);
            }}
            style={{
              position: 'absolute',
              top: -4,
              left: -4,
              background: '#ff3333',
              border: 'none',
              borderRadius: '50%',
              color: '#fff',
              fontSize: 9,
              width: 14,
              height: 14,
              cursor: 'pointer',
              fontWeight: 'bold',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }}
            title={`Kick ${p.name}`}
          >
            ×
          </button>
        )}

        <div className="compact-opponent-avatar">
          {initial}
        </div>

        <span className="compact-opponent-name">{p.name}</span>

        {p.card_count > 0 && (
          <span className="compact-opponent-badge">
            <svg viewBox="0 0 24 24" style={{ width: '11px', height: '14px', fill: 'currentColor', stroke: 'none', marginRight: '3px', display: 'inline-block', verticalAlign: 'middle' }}>
              <rect x="3" y="5" width="14" height="17" rx="2.5" opacity="0.4" />
              <rect x="7" y="2" width="14" height="17" rx="2.5" />
            </svg>
            <span style={{ verticalAlign: 'middle' }}>{p.card_count}</span>
          </span>
        )}

        {p.called_uno && (
          <span className="compact-opponent-uno">
            UNO
          </span>
        )}
      </div>
    );
  }

  function renderOpponentAvatar(p: PlayerState) {
    const isActive = activePlayer?.id === p.id;
    return (
      <div
        key={p.id}
        className={`opponent-avatar ${isActive ? 'active-turn' : ''} ${!p.is_connected ? 'offline' : ''}`}
        style={{ position: 'relative', cursor: (p.card_count === 1 && !p.called_uno) ? 'pointer' : 'default' }}
        onClick={() => {
          if (p.card_count === 1 && !p.called_uno) {
            handleCallOutUno(p.id);
          }
        }}
      >
        {roomDetails?.host_id === guest?.token && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleKickPlayer(p.id);
            }}
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              background: '#ff3333',
              border: 'none',
              borderRadius: '50%',
              color: '#fff',
              fontSize: 10,
              width: 18,
              height: 18,
              cursor: 'pointer',
              fontWeight: 'bold',
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 5px rgba(0,0,0,0.3)'
            }}
          >
            ×
          </button>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{p.name}</span>

        <div className="opponent-card-stack">
          {Array.from({ length: Math.min(3, p.card_count) }).map((_, cIdx) => (
            <div
              key={cIdx}
              className="opponent-card-mini"
              style={{
                left: `${8 + cIdx * 4}px`,
                transform: `rotate(${cIdx * 6 - 6}deg)`,
                zIndex: cIdx,
                boxShadow: '-1px 1px 3px rgba(0,0,0,0.25)'
              }}
            />
          ))}
          {p.card_count === 0 && <span style={{ fontSize: 9, color: '#00cc66', fontWeight: 800 }}>Won!</span>}
        </div>

        <span style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{p.card_count} Cards</span>

        {p.called_uno && (
          <span style={{
            fontSize: 9,
            background: '#ff3333',
            color: '#ffffff',
            padding: '1px 5px',
            borderRadius: 4,
            fontWeight: 700,
            marginTop: 4,
            boxShadow: '0 0 6px rgba(255,51,51,0.5)'
          }}>
            UNO
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="game-layout">
      {/* Alert Overlay */}
      {alertMessage && <div key={alertMessage} className={`game-alert ${alertType === 'success' ? 'alert-success' : 'alert-error'}`}>{alertMessage}</div>}

      {/* Top Header Row / Room Status */}
      {gameState?.game_status !== 'LOBBY' && (
        <div className="game-header" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-glass)',
          background: 'rgba(0,0,0,0.3)',
          zIndex: 30
        }}>
          <div>
            <span style={{ fontSize: 11, opacity: 0.5, display: 'block' }}>ROOM CODE</span>
            <strong style={{ fontSize: 16, letterSpacing: 1 }}>{roomCode}</strong>
            {!wsConnected && (
              <span style={{ fontSize: 10, color: '#ffaa00', display: 'block', marginTop: 2, animation: 'pulse 1.2s infinite' }}>
                ⟳ Reconnecting...
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={copyInviteLink} className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12, minHeight: 32 }}>
              Invite
            </button>
            <button
              onClick={() => {
                const newMuted = !isMuted;
                setIsMuted(newMuted);
                gameSounds.setMute(newMuted);
              }}
              className="btn-secondary"
              style={{
                padding: '6px 12px',
                fontSize: 14,
                minHeight: 32,
                width: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer'
              }}
              title={isMuted ? 'Unmute game sounds' : 'Mute game sounds'}
            >
              {isMuted ? '🔇' : '🔊'}
            </button>
            <button onClick={handleLeaveRoom} className="btn-secondary" style={{ padding: '6px 12px', fontSize: 12, minHeight: 32, borderColor: 'rgba(255,51,51,0.3)', color: '#ff5555' }}>
              Exit
            </button>
          </div>
        </div>
      )}

      {/* LOBBY STATE SCREEN */}
      {gameState?.game_status === 'LOBBY' && (
        <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
          <div className="glass-panel" style={{ padding: 24, textAlign: 'center', maxWidth: 500, margin: '0 auto', width: '100%' }}>
            <h2 style={{ margin: '0 0 4px 0', fontWeight: 800 }}>Game Lobby</h2>

            <div style={{
              margin: '12px auto 20px auto',
              padding: '8px 20px',
              borderRadius: '12px',
              background: 'rgba(255, 255, 255, 0.05)',
              backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' rx='12' stroke='%23ffffff' stroke-opacity='0.15' stroke-width='2' stroke-dasharray='4%2c 10' stroke-dashoffset='0' stroke-linecap='round'/%3e%3c/svg%3e")`,
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4
            }}>
              <span style={{ fontSize: 10, opacity: 0.5, letterSpacing: '0.8px', fontWeight: 700 }}>ROOM CODE</span>
              <strong style={{ fontSize: 26, letterSpacing: '2px', color: '#ffcc00', textShadow: '0 0 10px rgba(255,204,0,0.2)' }}>{roomCode}</strong>
            </div>

            <p style={{ margin: '0 0 24px 0', fontSize: 14, opacity: 0.6 }}>
              Waiting for players. Match requires 2 to 10 players.
            </p>

            <h3 style={{ margin: '0 0 12px 0', fontSize: 14, textAlign: 'left', opacity: 0.5 }}>Players Connected ({gameState.players.length}/10)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', marginBottom: 24 }}>
              {gameState.players.map((p, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '10px 14px',
                  borderRadius: 10
                }}>
                  <div>
                    <span style={{ opacity: 0.4, marginRight: 8 }}>#{idx + 1}</span>
                    <strong>{p.name}</strong>
                    {p.id === guest?.token && <span style={{ fontSize: 11, color: '#3388ff', marginLeft: 8 }}>(You)</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 11,
                      padding: '3px 8px',
                      borderRadius: 10,
                      fontWeight: 600,
                      background: p.is_connected ? 'rgba(0,204,102,0.15)' : 'rgba(255,51,51,0.15)',
                      color: p.is_connected ? '#00cc66' : '#ff3333'
                    }}>
                      {p.is_connected ? 'Online' : 'Offline'}
                    </span>
                    {roomDetails?.host_id === guest?.token && p.id !== guest?.token && (
                      <button
                        onClick={() => handleKickPlayer(p.id)}
                        className="btn-secondary"
                        style={{
                          padding: '4px 8px',
                          fontSize: 11,
                          minHeight: 24,
                          borderColor: 'rgba(255,51,51,0.3)',
                          color: '#ff5555',
                          borderRadius: 6,
                          cursor: 'pointer'
                        }}
                      >
                        Kick
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              {roomDetails?.host_id === guest?.token ? (
                (() => {
                  const hasOffline = gameState.players.some(p => !p.is_connected);
                  const hasTooFew = gameState.players.length < 2;
                  const isDisabled = hasTooFew || hasOffline;
                  let btnText = 'Start Match';
                  if (hasTooFew) btnText = 'Need 2+ Players';
                  else if (hasOffline) btnText = 'Waiting for Players to connect...';

                  return (
                    <button
                      onClick={handleStartGame}
                      className="btn-primary"
                      disabled={isDisabled}
                      style={{
                        background: isDisabled ? 'rgba(255,255,255,0.05)' : '#fff',
                        color: isDisabled ? '#666' : '#000',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        width: '100%',
                        minHeight: 44
                      }}
                    >
                      {btnText}
                    </button>
                  );
                })()
              ) : (
                <p style={{ margin: '0 0 8px 0', fontSize: 13, opacity: 0.5, fontStyle: 'italic' }}>
                  Waiting for the host ({roomDetails?.host_nickname}) to start the game...
                </p>
              )}

              {/* Lobby Utility Action Row (Invite & Exit & Mute & Chat) */}
              <div style={{ display: 'flex', gap: 12, width: '100%' }}>
                <button onClick={copyInviteLink} className="btn-secondary" style={{ flex: 2, minHeight: 44 }}>
                  Invite
                </button>
                <button
                  onClick={() => {
                    const newMuted = !isMuted;
                    setIsMuted(newMuted);
                    gameSounds.setMute(newMuted);
                  }}
                  className="btn-secondary"
                  style={{ flex: 1, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                  title={isMuted ? 'Unmute game sounds' : 'Mute game sounds'}
                >
                  {isMuted ? '🔇' : '🔊'}
                </button>
                <button
                  onClick={() => { setIsChatOpen(!isChatOpen); if (!isChatOpen) setUnreadCount(0); }}
                  className="btn-secondary chat-toggle-btn"
                  style={{
                    flex: 1,
                    minHeight: 44,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    position: 'relative',
                    background: isChatOpen ? 'rgba(51,136,255,0.2)' : 'rgba(255,255,255,0.05)',
                    color: isChatOpen ? '#3388ff' : '#fff'
                  }}
                  title={isChatOpen ? 'Close Chat' : 'Open Chat'}
                >
                  💬
                  {!isChatOpen && unreadCount > 0 && (
                    <span style={{
                      position: 'absolute',
                      top: -5,
                      right: -5,
                      background: '#ff3333',
                      color: '#fff',
                      borderRadius: '50%',
                      fontSize: 10,
                      fontWeight: 800,
                      minWidth: 16,
                      height: 16,
                      lineHeight: '16px',
                      textAlign: 'center',
                      padding: '0 3px',
                      boxShadow: '0 0 6px rgba(255,51,51,0.7)'
                    }}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </button>
                <button onClick={handleLeaveRoom} className="btn-secondary" style={{ flex: 2, minHeight: 44, borderColor: 'rgba(255,51,51,0.3)', color: '#ff5555' }}>
                  Exit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PLAYING STATE SCREEN: TABLETOP EXPERIENCE */}
      {gameState?.game_status === 'PLAYING' && (
        <div className="uno-table">
          {/* Mobile Compact Opponents Row */}
          {isMobile && topOpponents.length > 0 && (
            <div className="compact-opponents-row">
              {topOpponents.map(renderCompactOpponent)}
            </div>
          )}

          {/* Top Zone */}
          <div className="opponents-top">
            {topOpponents.map(renderOpponentAvatar)}
          </div>

          {/* Left Zone */}
          <div className="opponents-left">
            {leftOpponents.map(renderOpponentAvatar)}
          </div>

          {/* Central Play Table (Felt Style) */}
          <div className="table-felt">
            {/* Table Header Row (Turn, Color & Direction combined) */}
            <div className="table-header-row" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', zIndex: 30 }}>
              {/* Turn Announcement */}
              <div style={{
                padding: '5px 12px',
                borderRadius: 12,
                background: 'rgba(0,0,0,0.5)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: isMyTurn ? '#ffcc00' : '#fff',
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: 'nowrap'
              }}>
                {isMyTurn ? '👉 YOUR TURN 👈' : `${activePlayer?.name}'s Turn`}
              </div>

              {/* Current Active Color banner with Direction Symbol */}
              <div className="color-banner" style={{
                background:
                  gameState.current_color === 'R' ? 'var(--color-red)' :
                    gameState.current_color === 'Y' ? 'var(--color-yellow)' :
                      gameState.current_color === 'G' ? 'var(--color-green)' :
                        gameState.current_color === 'B' ? 'var(--color-blue)' : '#333',
                color: gameState.current_color === 'Y' ? '#000' : '#fff',
                fontWeight: 900,
                padding: '5px 12px',
                fontSize: 12,
                borderRadius: 12,
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <span>
                  COLOR: {
                    gameState.current_color === 'R' ? 'Red' :
                      gameState.current_color === 'Y' ? 'Yellow' :
                        gameState.current_color === 'G' ? 'Green' :
                          gameState.current_color === 'B' ? 'Blue' : 'None'
                  }
                </span>
                <span style={{ fontSize: 14, fontWeight: 'bold' }}>
                  {gameState.direction === 1 ? '↻' : '↺'}
                </span>
              </div>
            </div>

            {/* Draw Pile and Discard Pile */}
            <div className="pile-container">
              {/* Draw Deck Stack */}
              <div
                onClick={handleDrawCard}
                className={`uno-card card-back deck-stack-3d ${needsToDraw ? 'active-turn' : ''}`}
                style={{
                  cursor: isMyTurn && (!gameState.has_drawn_this_turn || (gameState.draw_penalty || 0) > 0) ? 'pointer' : 'not-allowed',
                  opacity: isMyTurn && (!gameState.has_drawn_this_turn || (gameState.draw_penalty || 0) > 0) ? 1 : 0.7,
                  position: 'relative'
                }}
              >
                {/* Glowing Deck Count Badge */}
                <div style={{
                  position: 'absolute',
                  top: 8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(255, 255, 255, 1)',
                  border: '1.5px solid #ff0000',
                  color: '#ff0000',
                  borderRadius: '10px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  fontWeight: 900,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
                  zIndex: 20,
                  whiteSpace: 'nowrap'
                }}>
                  {gameState.deck_count}
                </div>

              </div>

              {/* Discard Pile Top Card — ref used as target anchor for flying card animation */}
              <div ref={discardPileRef} style={{ display: 'inline-flex' }}>
                {gameState.discard_pile.length > 0 && renderUnoCard(gameState.discard_pile[0], undefined, { cursor: 'default', animation: 'card-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards' }, gameState.discard_pile[0])}
              </div>
            </div>



            {/* Draw Penalty Alert — only shown to the active player who must draw */}
            {(gameState.draw_penalty || 0) > 0 && isMyTurn && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255, 40, 40, 0.18)',
                border: '1.5px solid rgba(255,80,80,0.55)',
                borderRadius: 12,
                padding: '7px 20px',
                color: '#ff5555',
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: 0.4,
                boxShadow: '0 0 16px rgba(255,51,51,0.25)',
                animation: 'pulse 1.2s infinite',
                marginTop: 12
              }}>
                ⚠️ Draw {gameState.draw_penalty} card{gameState.draw_penalty !== 1 ? 's' : ''}! Click the deck!
              </div>
            )}

            {/* Softer note for spectating players when penalty is active */}
            {(gameState.draw_penalty || 0) > 0 && !isMyTurn && (
              <div style={{
                fontSize: 11,
                opacity: 0.55,
                fontWeight: 700,
                background: 'rgba(255,80,80,0.08)',
                border: '1px solid rgba(255,80,80,0.2)',
                borderRadius: 8,
                padding: '3px 12px',
                color: '#ff8888',
                marginTop: 12
              }}>
                {activePlayer?.name} must draw {gameState.draw_penalty} card{gameState.draw_penalty !== 1 ? 's' : ''}
              </div>
            )}

            {/* No playable cards hint — shown when it's your turn but no card can be played */}
            {isMyTurn && (gameState.draw_penalty || 0) === 0 && !gameState.has_drawn_this_turn &&
              gameState.hand.length > 0 && gameState.hand.every(c => !checkPlayableClient(c)) && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  background: 'rgba(255,170,0,0.12)',
                  border: '1px solid rgba(255,170,0,0.4)',
                  borderRadius: 10,
                  padding: '5px 14px',
                  color: '#ffaa00',
                  fontWeight: 700,
                  fontSize: 12,
                  marginTop: 12
                }}>
                  🎴 No playable cards — draw from the deck!
                </div>
              )}

            {/* Action buttons on the table felt */}
            <div className="table-action-row" style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              marginTop: 12,
              zIndex: 30
            }}>
              {/* UNO shout button */}
              <button
                onClick={handleCallUno}
                className="btn-uno-shout"
                disabled={!canShoutUno}
              >
                UNO
              </button>

              {/* "Player didn't call UNO!" pill */}
              {targetNoUnoPlayer && (
                <button
                  onClick={handleReportNoUno}
                  style={{
                    height: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: 'linear-gradient(135deg, #cc2200, #ff4400)',
                    border: '2px solid #ff6600',
                    borderRadius: 24,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 800,
                    padding: '6px 14px',
                    cursor: 'pointer',
                    boxShadow: '0 0 14px rgba(255,68,0,0.7)',
                    animation: 'pulse 1.2s infinite',
                    whiteSpace: 'nowrap',
                    letterSpacing: 0.3
                  }}
                >
                  <span style={{ fontSize: 14 }}>🚨</span>
                  {targetNoUnoPlayer.name}<span style={{ fontSize: 14 }}> didn&apos;t call UNO!</span>
                </button>
              )}

              {/* Pass Turn */}
              {gameState.has_drawn_this_turn && isMyTurn && (gameState.draw_penalty || 0) === 0 && gameState.hand.some(c => checkPlayableClient(c)) && (
                <button
                  onClick={handlePassTurn}
                  className="btn-primary"
                  style={{
                    background: '#00cc66',
                    color: '#fff',
                    minHeight: 44,
                    padding: '0 20px',
                    width: 'auto',
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 800,
                    boxShadow: '0 0 12px rgba(0,204,102,0.4)',
                    letterSpacing: 0.5
                  }}
                >
                  ✓ Pass
                </button>
              )}

            </div>

            {/* Chat Toggle Button (Bottom Right of green table felt) */}
            <button
              onClick={() => { setIsChatOpen(!isChatOpen); if (!isChatOpen) setUnreadCount(0); }}
              className="chat-toggle-btn"
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: '1px solid var(--border-glass)',
                background: isChatOpen ? 'rgba(51,136,255,0.2)' : 'rgba(255,255,255,0.1)',
                color: isChatOpen ? '#3388ff' : '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
                position: 'relative',
                transition: 'background 0.2s, color 0.2s'
              }}
              title={isChatOpen ? 'Close Chat' : 'Open Chat'}
            >
              💬
              {!isChatOpen && unreadCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: -5,
                  right: -5,
                  background: '#ff3333',
                  color: '#fff',
                  borderRadius: '50%',
                  fontSize: 10,
                  fontWeight: 800,
                  minWidth: 16,
                  height: 16,
                  lineHeight: '16px',
                  textAlign: 'center',
                  padding: '0 3px',
                  boxShadow: '0 0 6px rgba(255,51,51,0.7)'
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </div>

          {/* Right Zone */}
          <div className="opponents-right">
            {rightOpponents.map(renderOpponentAvatar)}
          </div>

          {/* Bottom Player Hand & Info */}
          <div className="player-bottom-panel">
            <div className="hand-wrapper">
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 12px 6px 12px', fontSize: 13, opacity: 0.8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Your Hand ({gameState.hand.length} cards)</span>
                  {myPlayer?.called_uno && (
                    <span style={{
                      fontSize: 10,
                      background: '#ff3333',
                      color: '#ffffff',
                      padding: '2px 6px',
                      borderRadius: 6,
                      fontWeight: 800,
                      boxShadow: '0 0 8px rgba(255,51,51,0.6)',
                      letterSpacing: 0.5
                    }}>
                      UNO DECLARED
                    </span>
                  )}
                </div>
                {isMyTurn && (gameState.draw_penalty || 0) === 0 && (
                  <span style={{ color: '#ffcc00', fontWeight: 800 }}>Your Turn to Play!</span>
                )}
              </div>

              <div className="hand-container">
                {sortHand(gameState.hand).map((card, idx) => {
                  const isCardPlayable = isMyTurn && checkPlayableClient(card);
                  const isFlying = flyingCardData?.cardIdx === idx && flyingCardData?.card === card;
                  return (
                    <div
                      className="hand-card-wrapper"
                      key={idx}
                      style={{
                        ...getCardStyle(idx, gameState.hand.length),
                        cursor: isCardPlayable ? 'pointer' : 'not-allowed',
                        // Hide the exact slot that's currently animating to the pile
                        // so there's no double-card flash during the slide
                        visibility: isFlying ? 'hidden' : 'visible',
                        pointerEvents: isFlying ? 'none' : 'auto',
                      }}
                      onClick={(e) => {
                        if (isCardPlayable) {
                          // Pass the wrapper element; handlePlayCard drills into firstElementChild
                          // to get the inner card's rect (which reflects its CSS transforms)
                          handlePlayCard(card, idx, e.currentTarget);
                        }
                      }}
                    >
                      {renderUnoCard(
                        card,
                        undefined,
                        {
                          transform: isCardPlayable ? 'translateY(-8px)' : 'scale(0.95)',
                          opacity: 1,
                          filter: isCardPlayable ? 'none' : 'brightness(0.55) grayscale(0.25)',
                          cursor: isCardPlayable ? 'pointer' : 'not-allowed',
                          pointerEvents: 'none',
                        },
                        idx,
                        isCardPlayable,
                        false
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FINISHED STATE SCREEN */}
      {gameState?.game_status === 'FINISHED' && (
        <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
          {/* Confetti Container */}
          <div className="confetti-container">
            {confettiParticles.map((p) => (
              <div
                key={p.id}
                className="confetti-particle"
                style={{
                  left: p.left,
                  top: p.top,
                  backgroundColor: p.color,
                  // Custom css variable definitions for keyframe animation
                  ['--dx' as any]: p.dx,
                  ['--dy' as any]: p.dy,
                  ['--rot' as any]: p.rot,
                  ['--duration' as any]: p.duration
                }}
              />
            ))}
          </div>

          <div className="glass-panel" style={{ padding: 32, textAlign: 'center', maxWidth: 500, margin: '0 auto', width: '100%', zIndex: 10 }}>
            <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>🏆</span>
            <h2 style={{ margin: '0 0 8px 0', fontSize: 28, fontWeight: 900 }}>Match Finished!</h2>

            {/* Winner highlight */}
            {(() => {
              const winnerName = gameState.winner_name || gameState.players.find(p => p.card_count === 0)?.name;
              return (
                <p style={{ fontSize: 18, color: '#00cc66', fontWeight: 700, margin: '0 0 24px 0' }}>
                  {winnerName ? `🎉 ${winnerName} has won!` : 'A player has won!'}
                </p>
              );
            })()}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Host: Play Again resets the room back to lobby */}
              {roomDetails?.host_id === guest?.token ? (
                <button
                  onClick={handleResetToLobby}
                  className="btn-primary"
                  style={{ background: 'linear-gradient(135deg, #00cc66, #009944)', color: '#fff' }}
                >
                  🔄 Play Again
                </button>
              ) : (
                <p style={{ fontSize: 13, opacity: 0.5, margin: 0 }}>
                  Waiting for the host to start a new game...
                </p>
              )}
              <button
                onClick={handleLeaveRoom}
                className="btn-secondary"
                style={{ borderColor: 'rgba(255,51,51,0.3)', color: '#ff5555' }}
              >
                Leave Room
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flying card overlay — slides from hand position to discard pile position */}
      {flyingCardData && (
        <div
          className="card-slide-overlay"
          style={{
            left: flyingCardData.startX,
            top: flyingCardData.startY,
            width: flyingCardData.width,
            height: flyingCardData.height,
            '--slide-dx': `${flyingCardData.endX - flyingCardData.startX}px`,
            '--slide-dy': `${flyingCardData.endY - flyingCardData.startY}px`,
          } as React.CSSProperties}
        >
          {renderUnoCard(flyingCardData.card, undefined, { cursor: 'default', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }, 'flying', false, false)}
        </div>
      )}

      {/* Chat sliding drawer */}
      <div ref={chatRef} className={`chat-drawer ${isChatOpen ? 'open' : ''}`}>
        <div style={{
          padding: 16,
          borderBottom: '1px solid var(--border-glass)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <strong style={{ fontSize: 16 }}>Match Chat</strong>
          <button onClick={() => setIsChatOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        {/* Message Log */}
        <div className="chat-messages">
          {chatMessages.length === 0 ? (
            <p style={{ margin: 'auto', fontSize: 12, opacity: 0.4, textAlign: 'center' }}>
              No messages. Send a message to chat with friends!
            </p>
          ) : (
            chatMessages.map((msg, i) => (
              <div
                key={i}
                className="chat-message-bubble"
                style={{
                  alignSelf: msg.sender_id === guest?.token ? 'flex-end' : 'flex-start',
                  background: msg.sender_id === guest?.token ? 'rgba(51, 136, 255, 0.15)' : 'rgba(255,255,255,0.05)'
                }}
              >
                <div className="sender" style={{ color: msg.sender_id === guest?.token ? '#3388ff' : '#00cc66' }}>
                  {msg.sender_name}
                </div>
                <div>{msg.message}</div>
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <form onSubmit={handleSendChat} className="chat-input-row">
          <input
            type="text"
            className="input-text"
            placeholder="Type message..."
            style={{ padding: '8px 12px', fontSize: 14 }}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
          />
          <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '8px 16px', fontSize: 14, minHeight: 36 }}>
            Send
          </button>
        </form>
      </div>

      {/* Wild Card Color Picker Modal */}
      {pendingWildCard && (
        <div className="modal-overlay-animate" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: 24
        }}>
          <div className="glass-panel modal-content-animate" style={{
            padding: 32,
            maxWidth: 380,
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.15)'
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>
              {pendingWildCard.includes('WildDraw4') ? '⚡' : '🎨'}
            </div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: 20, fontWeight: 900 }}>
              {pendingWildCard.includes('WildDraw4') ? 'Wild +4' : 'Wild Card'}
            </h3>
            <p style={{ margin: '0 0 24px 0', fontSize: 13, opacity: 0.6 }}>
              Choose a color to continue
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { code: 'R', label: 'Red', bg: 'var(--color-red)', text: '#fff' },
                { code: 'Y', label: 'Yellow', bg: 'var(--color-yellow)', text: '#000' },
                { code: 'G', label: 'Green', bg: 'var(--color-green)', text: '#fff' },
                { code: 'B', label: 'Blue', bg: 'var(--color-blue)', text: '#fff' },
              ].map(({ code, label, bg, text }) => (
                <button
                  key={code}
                  onClick={() => submitWildCard(code)}
                  style={{
                    background: bg,
                    color: text,
                    border: '3px solid transparent',
                    borderRadius: 14,
                    padding: '18px 12px',
                    fontSize: 16,
                    fontWeight: 900,
                    cursor: 'pointer',
                    transition: 'transform 0.15s, box-shadow 0.15s',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.3)',
                    letterSpacing: 1
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.07)';
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 8px 25px rgba(0,0,0,0.5)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)';
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setPendingWildCard(null)}
              className="btn-secondary"
              style={{ marginTop: 16, width: '100%', minHeight: 40, fontSize: 13 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal Overlay */}
      {activeConfirm && (
        <div className="modal-overlay-animate" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: 24
        }}>
          <div className="glass-panel modal-content-animate" style={{
            padding: 28,
            maxWidth: 400,
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 18, fontWeight: 800 }}>Confirm Action</h3>
            <p style={{ margin: '0 0 24px 0', fontSize: 14, opacity: 0.8, lineHeight: 1.5 }}>
              {activeConfirm.message}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => {
                  activeConfirm.onConfirm();
                  setActiveConfirm(null);
                }}
                className="btn-primary"
                style={{ flex: 1, minHeight: 40, background: '#ff3333', color: '#fff' }}
              >
                Yes, Proceed
              </button>
              <button
                onClick={() => setActiveConfirm(null)}
                className="btn-secondary"
                style={{ flex: 1, minHeight: 40 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
