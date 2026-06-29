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

export interface ProfileResponse {
  token: string;
  nickname: string;
  email: string | null;
  is_registered: boolean;
  avatar: string | null;
  avatar_url: string | null;
  created_at: string;
}

export async function sendOtp(email: string): Promise<{ message: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/send-otp/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to send OTP.');
  }
  return res.json();
}

export async function checkEmail(email: string): Promise<{ exists: boolean; has_password: boolean; nickname?: string }> {
  const res = await fetch(`${BASE_URL}/api/auth/check-email/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to check email.');
  }
  return res.json();
}

export async function loginWithPassword(email: string, password: string): Promise<{ token: string; user: ProfileResponse }> {
  const res = await fetch(`${BASE_URL}/api/auth/login-password/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to login with password.');
  }
  const data = await res.json();
  setStoredGuest(data.token, data.user.nickname);
  if (data.user.avatar_url) {
    localStorage.setItem('uno_guest_avatar', data.user.avatar_url);
  } else {
    localStorage.removeItem('uno_guest_avatar');
  }
  return data;
}

export async function verifyOtp(email: string, otp: string, nickname?: string, password?: string): Promise<{ token: string; user: ProfileResponse }> {
  const res = await fetch(`${BASE_URL}/api/auth/verify-otp/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp, nickname, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to verify OTP.');
  }
  const data = await res.json();
  setStoredGuest(data.token, data.user.nickname);
  if (data.user.avatar_url) {
    localStorage.setItem('uno_guest_avatar', data.user.avatar_url);
  } else {
    localStorage.removeItem('uno_guest_avatar');
  }
  return data;
}

export async function getUserProfile(): Promise<ProfileResponse> {
  const res = await fetch(`${BASE_URL}/api/user/profile/`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to get user profile.');
  }
  return res.json();
}

export async function updateUserProfile(nickname: string, avatarFile?: File): Promise<ProfileResponse> {
  const formData = new FormData();
  if (nickname) formData.append('nickname', nickname);
  if (avatarFile) formData.append('avatar', avatarFile);

  const token = typeof window !== 'undefined' ? localStorage.getItem('uno_guest_token') : null;
  const headers: HeadersInit = {};
  if (token) {
    headers['Authorization'] = `Token ${token}`;
  }

  const res = await fetch(`${BASE_URL}/api/user/profile/`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update profile.');
  }
  const data: ProfileResponse = await res.json();
  setStoredGuest(data.token, data.nickname);
  if (data.avatar_url) {
    localStorage.setItem('uno_guest_avatar', data.avatar_url);
  } else {
    localStorage.removeItem('uno_guest_avatar');
  }
  return data;
}

