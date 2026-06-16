'use client';

/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element */

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  registerGuest,
  createRoom,
  joinRoom,
  getStoredGuest,
  getGameHistory,
  HistoryResponse
} from './api';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectCode = searchParams.get('redirect');

  // State variables
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState(redirectCode || '');
  const [guest, setGuest] = useState<{ token: string; nickname: string } | null>(null);
  const [history, setHistory] = useState<HistoryResponse[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // On mount, check if guest is registered.
  // If they already have a token and arrived via an invite link, go straight to the room.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const msg = localStorage.getItem('uno_kicked_message');
      if (msg) {
        setError(msg);
        localStorage.removeItem('uno_kicked_message');
      }
    }
    const stored = getStoredGuest();
    if (stored) {
      setGuest(stored);
      setNickname(stored.nickname);
      if (redirectCode) {
        // Already registered — auto-navigate to the room they were invited to
        router.replace(`/room/${redirectCode.toUpperCase()}`);
      }
    }
  }, []);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim()) return;
    setError('');
    setLoading(true);
    try {
      const data = await registerGuest(nickname.trim());
      setGuest({ token: data.token, nickname: data.nickname });

      // If the user came from an invite link, join that room and navigate there
      if (redirectCode) {
        try {
          await joinRoom(redirectCode.toUpperCase());
          router.push(`/room/${redirectCode.toUpperCase()}`);
        } catch {
          // Room may already include them or they navigate manually — just go there
          router.push(`/room/${redirectCode.toUpperCase()}`);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRoom() {
    setError('');
    setLoading(true);
    try {
      const room = await createRoom();
      router.push(`/room/${room.code}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create room.');
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const formattedCode = roomCode.trim().toUpperCase();
    if (!formattedCode || formattedCode.length !== 6) {
      setError('Please enter a valid 6-letter room code.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const room = await joinRoom(formattedCode);
      router.push(`/room/${room.code}`);
    } catch (err: any) {
      setError(err.message || 'Failed to join room.');
    } finally {
      setLoading(false);
    }
  }

  function handleLogOut() {
    localStorage.removeItem('uno_guest_token');
    localStorage.removeItem('uno_guest_nickname');
    setGuest(null);
    setNickname('');
    setRoomCode('');
  }

  return (
    <div className="lobby-container">
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: 24, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <img
          src="/uno-logo.svg"
          alt="UNO Logo"
          className="lobby-logo"
          style={{
            width: 130,
            height: 130,
            marginBottom: 16,
            filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.4))'
          }}
        />
        <h1 style={{
          fontSize: 36,
          margin: 0,
          fontWeight: 900,
          letterSpacing: 2,
          background: 'linear-gradient(135deg, #ffee33 0%, #ff9900 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textShadow: '0 4px 12px rgba(0,0,0,0.3)'
        }}>
          UNO! MULTIPLAYER
        </h1>
        <p style={{ margin: '4px 0 0 0', opacity: 0.6, fontSize: 14 }}>
          Real-time Card Game
        </p>
      </div>

      {/* Error alert */}
      {error && (
        <div style={{
          width: '100%',
          background: 'rgba(255, 51, 51, 0.15)',
          border: '1px solid #ff3333',
          color: '#ff9999',
          padding: 12,
          borderRadius: 12,
          marginBottom: 16,
          fontSize: 14,
          boxSizing: 'border-box'
        }}>
          {error}
        </div>
      )}

      {/* Step 1: Create Guest User */}
      {!guest ? (
        <form onSubmit={handleRegister} className="glass-panel" style={{ width: '100%', padding: 24, boxSizing: 'border-box' }}>
          {redirectCode ? (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(51,136,255,0.12)', border: '1px solid rgba(51,136,255,0.3)', fontSize: 13 }}>
              🔗 You were invited to room <strong style={{ color: '#3388ff', letterSpacing: 1 }}>{redirectCode.toUpperCase()}</strong>. Choose a nickname to join!
            </div>
          ) : null}
          <h2 style={{ margin: '0 0 16px 0', fontSize: 20, fontWeight: 700 }}>Choose a Nickname</h2>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              className="input-text"
              placeholder="Enter your name"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              disabled={loading}
              maxLength={50}
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? (redirectCode ? 'Joining Room...' : 'Registering...') : (redirectCode ? `Join Room ${redirectCode.toUpperCase()}` : 'Play as Guest')}
          </button>
        </form>
      ) : (
        /* Step 2: Create or Join Game Room */
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Guest Card */}
          <div className="glass-panel" style={{
            padding: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxSizing: 'border-box'
          }}>
            <div>
              <span style={{ fontSize: 13, opacity: 0.5, display: 'block' }}>Signed in as:</span>
              <strong style={{ fontSize: 18, color: '#3388ff' }}>{guest.nickname}</strong>
            </div>
            <button
              onClick={handleLogOut}
              style={{
                background: 'none',
                border: 'none',
                color: '#ff3333',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600
              }}
            >
              Logout
            </button>
          </div>

          {/* Action: Create Room */}
          <div className="glass-panel" style={{ padding: 20, boxSizing: 'border-box' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700 }}>Host a Private Match</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.6 }}>
              Create a custom private game room and share the invite link to play with friends.
            </p>
            <button onClick={handleCreateRoom} className="btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Private Room'}
            </button>
          </div>

          {/* Action: Join Room */}
          <div className="glass-panel" style={{ padding: 20, boxSizing: 'border-box' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 18, fontWeight: 700 }}>Join Match</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.6 }}>
              Enter a 6-letter room code to connect to an ongoing lobby.
            </p>
            <form onSubmit={handleJoinRoom} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="text"
                className="input-text"
                placeholder="ROOM CODE"
                style={{ textAlign: 'center', letterSpacing: 3, fontWeight: 700, fontSize: 18 }}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                disabled={loading}
                maxLength={6}
                required
              />
              <button type="submit" className="btn-secondary" disabled={loading}>
                Join Room
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', color: '#fff' }}><h2>Loading...</h2></div>}>
      <HomeContent />
    </Suspense>
  );
}
