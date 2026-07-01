"use client";

/* eslint-disable react-hooks/set-state-in-effect, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @next/next/no-img-element */

import { useState, useEffect, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  registerGuest,
  createRoom,
  joinRoom,
  getStoredGuest,
  sendOtp,
  verifyOtp,
  updateUserProfile,
  getUserProfile,
  checkEmail,
  loginWithPassword,
  HistoryResponse,
} from "./api";

function getAbsoluteAvatarUrl(url: string | null) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  return `${BASE_URL}${url}`;
}

function compressImage(file: File, maxWidth: number = 256, maxHeight: number = 256): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name, {
                type: "image/jpeg",
                lastModified: Date.now(),
              });
              resolve(compressedFile);
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          0.85
        );
      };
      img.onerror = () => reject(new Error("Failed to load image."));
    };
    reader.onerror = (err) => reject(err);
  });
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectCode = searchParams.get("redirect");

  // State variables
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [emailChecked, setEmailChecked] = useState(false);
  const [emailExists, setEmailExists] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [loginWithOtpInstead, setLoginWithOtpInstead] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [isEmailAuth, setIsEmailAuth] = useState(false);

  const [roomCode, setRoomCode] = useState(redirectCode || "");
  const [guest, setGuest] = useState<{
    token: string;
    nickname: string;
  } | null>(null);

  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [editNickname, setEditNickname] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // On mount, check if guest is registered.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const msg = localStorage.getItem("uno_kicked_message");
      if (msg) {
        setError(msg);
        localStorage.removeItem("uno_kicked_message");
      }
      const avatar = localStorage.getItem("uno_guest_avatar");
      if (avatar) {
        setProfileAvatarUrl(avatar);
      }
    }
    const stored = getStoredGuest();
    if (stored) {
      setGuest(stored);
      setNickname(stored.nickname);
      setEditNickname(stored.nickname);

      // Proactively fetch updated user profile to sync avatar/nickname from backend
      getUserProfile()
        .then((profile) => {
          setProfileAvatarUrl(profile.avatar_url);
          setNickname(profile.nickname);
          setEditNickname(profile.nickname);
        })
        .catch((e) => console.log("Failed to sync profile on mount:", e));

      if (redirectCode) {
        router.replace(`/room/${redirectCode.toUpperCase()}`);
      }
    }
  }, []);

  const handleEmailChange = (val: string) => {
    setEmail(val);
    setEmailChecked(false);
    setEmailExists(false);
    setHasPassword(false);
    setOtpSent(false);
    setLoginWithOtpInstead(false);
    setPassword("");
    setOtp("");
  };

  async function handleCheckEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await checkEmail(email.trim().toLowerCase());
      setEmailChecked(true);
      setEmailExists(res.exists);
      setHasPassword(res.has_password);
      if (res.exists && res.nickname) {
        setNickname(res.nickname);
      }
    } catch (err: any) {
      setError(err.message || "Failed to check email status.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim()) return;
    setError("");
    setLoading(true);
    try {
      const data = await registerGuest(nickname.trim());
      setGuest({ token: data.token, nickname: data.nickname });
      setEditNickname(data.nickname);
      setProfileAvatarUrl(null);

      if (redirectCode) {
        try {
          await joinRoom(redirectCode.toUpperCase());
          router.push(`/room/${redirectCode.toUpperCase()}`);
        } catch {
          router.push(`/room/${redirectCode.toUpperCase()}`);
        }
      }
    } catch (err: any) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError("");
    setLoading(true);
    try {
      await sendOtp(email.trim().toLowerCase());
      setOtpSent(true);
    } catch (err: any) {
      setError(err.message || "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !otp.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await verifyOtp(
        email.trim().toLowerCase(),
        otp.trim(),
        nickname.trim() || undefined,
        password.trim() || undefined
      );
      setGuest({ token: res.token, nickname: res.user.nickname });
      setNickname(res.user.nickname);
      setEditNickname(res.user.nickname);
      setProfileAvatarUrl(res.user.avatar_url);

      if (redirectCode) {
        try {
          await joinRoom(redirectCode.toUpperCase());
          router.push(`/room/${redirectCode.toUpperCase()}`);
        } catch {
          router.push(`/room/${redirectCode.toUpperCase()}`);
        }
      }
    } catch (err: any) {
      setError(err.message || "OTP verification failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await loginWithPassword(email.trim().toLowerCase(), password.trim());
      setGuest({ token: res.token, nickname: res.user.nickname });
      setNickname(res.user.nickname);
      setEditNickname(res.user.nickname);
      setProfileAvatarUrl(res.user.avatar_url);

      if (redirectCode) {
        try {
          await joinRoom(redirectCode.toUpperCase());
          router.push(`/room/${redirectCode.toUpperCase()}`);
        } catch {
          router.push(`/room/${redirectCode.toUpperCase()}`);
        }
      }
    } catch (err: any) {
      setError(err.message || "Invalid password.");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!editNickname.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await updateUserProfile(editNickname.trim(), avatarFile || undefined);
      setGuest({ token: res.token, nickname: res.nickname });
      setNickname(res.nickname);
      setProfileAvatarUrl(res.avatar_url);
      setShowProfileEdit(false);
      setAvatarFile(null);
      setAvatarPreview(null);
    } catch (err: any) {
      setError(err.message || "Failed to update profile.");
    } finally {
      setLoading(false);
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setError("");
      try {
        const compressed = await compressImage(file);
        setAvatarFile(compressed);
        const reader = new FileReader();
        reader.onloadend = () => {
          setAvatarPreview(reader.result as string);
        };
        reader.readAsDataURL(compressed);
      } catch (err: any) {
        setError("Failed to process image: " + (err.message || err));
      }
    }
  }

  function handleLogOut() {
    localStorage.removeItem("uno_guest_token");
    localStorage.removeItem("uno_guest_nickname");
    localStorage.removeItem("uno_guest_avatar");
    setGuest(null);
    setNickname("");
    setEditNickname("");
    setRoomCode("");
    setEmail("");
    setOtp("");
    setPassword("");
    setEmailChecked(false);
    setEmailExists(false);
    setHasPassword(false);
    setLoginWithOtpInstead(false);
    setOtpSent(false);
    setProfileAvatarUrl(null);
  }

  async function handleCreateRoom() {
    setError("");
    setLoading(true);
    try {
      const room = await createRoom();
      router.push(`/room/${room.code}`);
    } catch (err: any) {
      setError(err.message || "Failed to create room.");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const formattedCode = roomCode.trim().toUpperCase();
    if (!formattedCode || formattedCode.length !== 6) {
      setError("Please enter a valid 6-letter room code.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const room = await joinRoom(formattedCode);
      router.push(`/room/${room.code}`);
    } catch (err: any) {
      setError(err.message || "Failed to join room.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lobby-container">
      {/* Title */}
      <div
        style={{
          textAlign: "center",
          marginBottom: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <img
          src="/uno-logo.svg"
          alt="UNO Logo"
          className="lobby-logo"
          style={{
            width: 130,
            height: 130,
            marginBottom: 16,
            filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.4))",
          }}
        />
        <h1 className="lobby-title">UNO! MULTIPLAYER</h1>
        <p style={{ margin: "4px 0 0 0", opacity: 0.6, fontSize: 14 }}>
          Real-time Card Game
        </p>
      </div>

      {/* Error alert */}
      {error && (
        <div
          style={{
            width: "100%",
            background: "rgba(255, 51, 51, 0.15)",
            border: "1px solid #ff3333",
            color: "#ff9999",
            padding: 12,
            borderRadius: 12,
            marginBottom: 16,
            fontSize: 14,
            boxSizing: "border-box",
          }}
        >
          {error}
        </div>
      )}

      {/* Step 1: Register / Login */}
      {!guest ? (
        <div
          className="glass-panel"
          style={{ width: "100%", padding: 24, boxSizing: "border-box" }}
        >
          {redirectCode ? (
            <div
              style={{
                marginBottom: 16,
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(51,136,255,0.12)",
                border: "1px solid rgba(51,136,255,0.3)",
                fontSize: 13,
              }}
            >
              🔗 You were invited to room{" "}
              <strong style={{ color: "#3388ff", letterSpacing: 1 }}>
                {redirectCode.toUpperCase()}
              </strong>
              . Choose a profile to join!
            </div>
          ) : null}

          {/* Toggle Tab Row */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, background: "rgba(255,255,255,0.06)", padding: 4, borderRadius: 12 }}>
            <button
              onClick={() => { setIsEmailAuth(false); setError(""); }}
              style={{
                flex: 1,
                border: "none",
                borderRadius: 9,
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                background: !isEmailAuth ? "rgba(255,255,255,0.12)" : "transparent",
                color: !isEmailAuth ? "#fff" : "rgba(255,255,255,0.6)",
                transition: "all 0.2s"
              }}
            >
              Guest Play
            </button>
            <button
              onClick={() => { setIsEmailAuth(true); setError(""); }}
              style={{
                flex: 1,
                border: "none",
                borderRadius: 9,
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                background: isEmailAuth ? "rgba(255,255,255,0.12)" : "transparent",
                color: isEmailAuth ? "#fff" : "rgba(255,255,255,0.6)",
                transition: "all 0.2s"
              }}
            >
              Login / Register
            </button>
          </div>

          {!isEmailAuth ? (
            /* Guest Flow */
            <form onSubmit={handleRegister}>
              <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>
                Nickname
              </h2>
              <div style={{ marginBottom: 16 }}>
                <input
                  type="text"
                  className="input-text"
                  placeholder="Enter nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  disabled={loading}
                  maxLength={50}
                  required
                />
              </div>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Registering..." : "Play as Guest"}
              </button>
            </form>
          ) : (
            /* Email Auth Flow (Checking -> Password -> OTP Sign Up) */
            <div>
              {!emailChecked ? (
                /* Step 1: Input Email */
                <form onSubmit={handleCheckEmail}>
                  <h2 style={{ margin: "0 0 16px 0", fontSize: 18, fontWeight: 700 }}>
                    Enter Email
                  </h2>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 6 }}>Email Address</label>
                    <input
                      type="email"
                      className="input-text"
                      placeholder="Enter email address"
                      value={email}
                      onChange={(e) => handleEmailChange(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                  <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? "Checking..." : "Continue"}
                  </button>
                </form>
              ) : emailExists && hasPassword && !loginWithOtpInstead ? (
                /* Step 2A: Password Login */
                <form onSubmit={handlePasswordLogin}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Welcome Back</h2>
                    <button
                      type="button"
                      onClick={() => setEmailChecked(false)}
                      style={{ background: "none", border: "none", color: "#3388ff", fontSize: 12, cursor: "pointer" }}
                    >
                      Change Email
                    </button>
                  </div>
                  <div style={{ marginBottom: 16, fontSize: 14, opacity: 0.8 }}>
                    Logging in as <strong>{nickname}</strong> ({email})
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 6 }}>Password</label>
                    <input
                      type="password"
                      className="input-text"
                      placeholder=""
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      required
                    />
                  </div>
                  <button type="submit" className="btn-primary" style={{ marginBottom: 12 }} disabled={loading}>
                    {loading ? "Logging in..." : "Log In"}
                  </button>
                  <div style={{ textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setLoginWithOtpInstead(true);
                        setOtpSent(false);
                      }}
                      style={{ background: "none", border: "none", color: "#64748b", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                    >
                      Login with OTP code instead
                    </button>
                  </div>
                </form>
              ) : (
                /* Step 2B: Register (Get OTP with Nickname & Password) or Login with OTP */
                <form onSubmit={otpSent ? handleVerifyOtp : handleSendOtp}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                      {otpSent ? "Verify Code" : loginWithOtpInstead ? "Get Verification Code" : "Create Account"}
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        setEmailChecked(false);
                        setLoginWithOtpInstead(false);
                      }}
                      style={{ background: "none", border: "none", color: "#3388ff", fontSize: 12, cursor: "pointer" }}
                    >
                      Change Email
                    </button>
                  </div>

                  {!otpSent ? (
                    <>
                      <div style={{ marginBottom: 12, fontSize: 14, opacity: 0.8 }}>
                        Email: <strong>{email}</strong>
                      </div>

                      {!loginWithOtpInstead && (
                        <>
                          <div style={{ marginBottom: 12 }}>
                            <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 6 }}>Display Name</label>
                            <input
                              type="text"
                              className="input-text"
                              placeholder="e.g. John Doe"
                              value={nickname}
                              onChange={(e) => setNickname(e.target.value)}
                              disabled={loading}
                              required
                            />
                          </div>
                          <div style={{ marginBottom: 20 }}>
                            <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 6 }}>Password</label>
                            <input
                              type="password"
                              className="input-text"
                              placeholder="Create a password"
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              disabled={loading}
                              required
                            />
                          </div>
                        </>
                      )}

                      <button type="submit" className="btn-primary" disabled={loading}>
                        {loading ? "Sending..." : "Get OTP Code"}
                      </button>

                      {loginWithOtpInstead && (
                        <div style={{ textAlign: "center", marginTop: 12 }}>
                          <button
                            type="button"
                            onClick={() => setLoginWithOtpInstead(false)}
                            style={{ background: "none", border: "none", color: "#3388ff", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
                          >
                            Back to password login
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ marginBottom: 12, padding: "10px 12px", background: "rgba(0, 204, 102, 0.08)", border: "1px solid rgba(0, 204, 102, 0.25)", borderRadius: 10, fontSize: 13, color: "#66ffaa" }}>
                        📧 OTP sent to {email}. Check your email!
                      </div>
                      <div style={{ marginBottom: 20 }}>
                        <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 6 }}>Enter 6-Digit OTP</label>
                        <input
                          type="text"
                          className="input-text"
                          placeholder="123456"
                          maxLength={6}
                          style={{ textAlign: "center", letterSpacing: 6, fontWeight: 700 }}
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          disabled={loading}
                          required
                        />
                      </div>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ flex: 1 }}
                          onClick={() => setOtpSent(false)}
                          disabled={loading}
                        >
                          Back
                        </button>
                        <button type="submit" className="btn-primary" style={{ flex: 2 }} disabled={loading}>
                          {loading ? "Verifying..." : "Verify & Finish"}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Step 2: Main Menu & Room Options */
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* User Profile Card */}
          <div
            className="glass-panel"
            style={{
              padding: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              boxSizing: "border-box",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {profileAvatarUrl ? (
                <img
                  src={getAbsoluteAvatarUrl(profileAvatarUrl) || ""}
                  alt="Avatar"
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "2px solid #3388ff",
                    boxShadow: "0 0 10px rgba(51,136,255,0.4)"
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.08)",
                    border: "1.5px dashed rgba(255,255,255,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20
                  }}
                >
                  👤
                </div>
              )}
              <div>
                <span style={{ fontSize: 11, opacity: 0.5, display: "block" }}>
                  Signed in as:
                </span>
                <strong style={{ fontSize: 16, color: "#3388ff" }}>
                  {guest.nickname}
                </strong>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => {
                  setEditNickname(nickname);
                  setShowProfileEdit(true);
                }}
                style={{
                  background: "rgba(51,136,255,0.12)",
                  border: "1px solid rgba(51,136,255,0.3)",
                  borderRadius: 8,
                  color: "#3388ff",
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                Edit Profile
              </button>
              <button
                onClick={handleLogOut}
                style={{
                  background: "none",
                  border: "none",
                  color: "#ff5555",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Logout
              </button>
            </div>
          </div>

          {/* Action: Play vs Bot */}
          <div
            className="glass-panel"
            style={{ padding: 20, boxSizing: "border-box" }}
          >
            <h3 style={{ margin: "0 0 8px 0", fontSize: 18, fontWeight: 700 }}>
              🤖 Play vs Bot
            </h3>
            <p style={{ margin: "0 0 16px 0", fontSize: 13, opacity: 0.6 }}>
              Quick 1v1 match against an AI opponent. No waiting, start
              instantly!
            </p>
            <button
              onClick={() => router.push("/bot")}
              className="btn-secondary"
              style={{
                background: "rgba(51,136,255,0.12)",
                borderColor: "rgba(51,136,255,0.4)",
                color: "#5599ff",
              }}
            >
              Play vs Bot
            </button>
          </div>

          {/* Action: Create Room */}
          <div
            className="glass-panel"
            style={{ padding: 20, boxSizing: "border-box" }}
          >
            <h3 style={{ margin: "0 0 8px 0", fontSize: 18, fontWeight: 700 }}>
              Host a Private Match
            </h3>
            <p style={{ margin: "0 0 16px 0", fontSize: 13, opacity: 0.6 }}>
              Create a custom private game room and share the invite link to
              play with friends.
            </p>
            <button
              onClick={handleCreateRoom}
              className="btn-primary"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Private Room"}
            </button>
          </div>

          {/* Action: Join Room */}
          <div
            className="glass-panel"
            style={{ padding: 20, boxSizing: "border-box" }}
          >
            <h3 style={{ margin: "0 0 8px 0", fontSize: 18, fontWeight: 700 }}>
              Join Match
            </h3>
            <p style={{ margin: "0 0 16px 0", fontSize: 13, opacity: 0.6 }}>
              Enter a 6-letter room code to connect to an ongoing lobby.
            </p>
            <form
              onSubmit={handleJoinRoom}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <input
                type="text"
                className="input-text"
                placeholder="ROOM CODE"
                style={{
                  textAlign: "center",
                  letterSpacing: 3,
                  fontWeight: 700,
                  fontSize: 18,
                }}
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                disabled={loading}
                maxLength={6}
                required
              />
              <button
                type="submit"
                className="btn-secondary"
                disabled={loading}
                style={
                  roomCode.length === 6
                    ? {
                      background: "rgba(0, 204, 102, 0.18)",
                      borderColor: "#00cc66",
                      color: "#00ee77",
                      boxShadow: "0 0 14px rgba(0, 204, 102, 0.25)",
                      transition:
                        "background 0.3s, border-color 0.3s, box-shadow 0.3s, color 0.3s",
                    }
                    : {
                      transition:
                        "background 0.3s, border-color 0.3s, box-shadow 0.3s, color 0.3s",
                    }
                }
              >
                Join Room
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showProfileEdit && (
        <div
          className="modal-overlay-animate"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(12px)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 99999,
            padding: 24,
            boxSizing: "border-box"
          }}
        >
          <form
            onSubmit={handleUpdateProfile}
            className="glass-panel modal-content-animate"
            style={{
              padding: 28,
              maxWidth: 400,
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
              border: "1px solid rgba(255,255,255,0.15)",
              boxSizing: "border-box"
            }}
          >
            <h3 style={{ margin: "0 0 20px 0", fontSize: 20, fontWeight: 900, textAlign: "center" }}>
              👤 Update Profile
            </h3>

            {/* Avatar Uploader UI */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 20 }}>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  cursor: "pointer",
                  position: "relative",
                  overflow: "hidden",
                  border: "3px solid #3388ff",
                  background: "rgba(255, 255, 255, 0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 0 16px rgba(51,136,255,0.3)"
                }}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : profileAvatarUrl ? (
                  <img src={getAbsoluteAvatarUrl(profileAvatarUrl) || ""} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: 32 }}>👤</span>
                )}
                {/* Upload Overlay */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    width: "100%",
                    background: "rgba(0,0,0,0.6)",
                    color: "#fff",
                    fontSize: 9,
                    textAlign: "center",
                    padding: "3px 0",
                    fontWeight: 700
                  }}
                >
                  UPLOAD
                </div>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                accept="image/*"
                onChange={handleAvatarChange}
              />
              <span style={{ fontSize: 11, opacity: 0.5, marginTop: 8 }}>Click to upload profile photo</span>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 12, opacity: 0.7, display: "block", marginBottom: 6 }}>Nickname</label>
              <input
                type="text"
                className="input-text"
                placeholder="Enter nickname"
                value={editNickname}
                onChange={(e) => setEditNickname(e.target.value)}
                disabled={loading}
                maxLength={50}
                required
              />
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  setShowProfileEdit(false);
                  setAvatarFile(null);
                  setAvatarPreview(null);
                }}
                disabled={loading}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" style={{ flex: 2 }} disabled={loading}>
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: "flex",
            height: "100vh",
            justifyContent: "center",
            alignItems: "center",
            color: "#fff",
          }}
        >
          <h2>Loading...</h2>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
