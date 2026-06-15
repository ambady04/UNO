const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface GuestResponse {
  token: string;
  nickname: string;
  created_at: string;
}

export interface PlayerInfo {
  user_id: string;
  nickname: string;
  slot_index: number;
}

export interface RoomResponse {
  code: string;
  status: 'LOBBY' | 'PLAYING' | 'FINISHED';
  host_id: string;
  host_nickname: string;
  players: PlayerInfo[];
  created_at: string;
}

export interface HistoryResponse {
  room_code: string;
  winner_name: string;
  duration_seconds: number;
  played_at: string;
}

// Helper to get headers with guest token
export function getHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('uno_guest_token') : null;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Token ${token}`;
  }
  return headers;
}

export function getStoredGuest(): { token: string; nickname: string } | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('uno_guest_token');
  const nickname = localStorage.getItem('uno_guest_nickname');
  if (token && nickname) {
    return { token, nickname };
  }
  return null;
}

export function setStoredGuest(token: string, nickname: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('uno_guest_token', token);
  localStorage.setItem('uno_guest_nickname', nickname);
}

export async function registerGuest(nickname: string): Promise<GuestResponse> {
  const res = await fetch(`${BASE_URL}/api/auth/guest/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to register guest user.');
  }
  const data: GuestResponse = await res.json();
  setStoredGuest(data.token, data.nickname);
  return data;
}

export async function createRoom(): Promise<RoomResponse> {
  const res = await fetch(`${BASE_URL}/api/rooms/`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create room.');
  }
  return res.json();
}

export async function joinRoom(code: string): Promise<RoomResponse> {
  const res = await fetch(`${BASE_URL}/api/rooms/${code.toUpperCase()}/join/`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to join room.');
  }
  return res.json();
}

export async function getRoomDetails(code: string): Promise<RoomResponse> {
  const res = await fetch(`${BASE_URL}/api/rooms/${code.toUpperCase()}/`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to fetch room details.');
  }
  return res.json();
}

export async function getGameHistory(): Promise<HistoryResponse[]> {
  const res = await fetch(`${BASE_URL}/api/history/`, {
    method: 'GET',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch game history.');
  }
  return res.json();
}
