// Web Audio API Sound Generator for UNO Game

class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
  }

  public setMute(muted: boolean) {
    this.isMuted = muted;
    if (typeof window !== 'undefined') {
      localStorage.setItem('uno_muted', muted ? 'true' : 'false');
    }
  }

  public getMute(): boolean {
    return this.isMuted;
  }

  constructor() {
    if (typeof window !== 'undefined') {
      this.isMuted = localStorage.getItem('uno_muted') === 'true';
    }
  }

  public play(soundType: 'playCard' | 'drawCard' | 'myTurn' | 'unoShout' | 'gameStart' | 'gameWin' | 'gameOver' | 'chat' | 'alert') {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    // Resume context if suspended (browser security autoplays)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;

    switch (soundType) {
      case 'playCard': {
        // Snappy swoosh / play click
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.12);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        osc.start(now);
        osc.stop(now + 0.12);
        break;
      }
      case 'drawCard': {
        // Swoosh-click for card draw
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(330, now + 0.05);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.setValueAtTime(0.2, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

        osc.start(now);
        osc.stop(now + 0.12);
        break;
      }
      case 'myTurn': {
        // Friendly bright chime
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(523.25, now); // C5
        osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.15); // G5

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now); // E5
        osc2.frequency.exponentialRampToValueAtTime(987.77, now + 0.15); // B5

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.3);
        osc2.stop(now + 0.3);
        break;
      }
      case 'unoShout': {
        // Alert sound for UNO
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(698.46, now + 0.1); // F5
        osc.frequency.setValueAtTime(880.00, now + 0.2); // A5

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        osc.start(now);
        osc.stop(now + 0.4);
        break;
      }
      case 'gameStart': {
        // Energetic game start notes
        const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
        notes.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.connect(gain);
          gain.connect(this.ctx!.destination);

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);

          gain.gain.setValueAtTime(0.2, now + idx * 0.08);
          gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.08 + 0.2);

          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.2);
        });
        break;
      }
      case 'gameWin': {
        // Triumphant fanfare arpeggio
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.connect(gain);
          gain.connect(this.ctx!.destination);

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.1);

          gain.gain.setValueAtTime(0.2, now + idx * 0.1);
          gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.1 + 0.5);

          osc.start(now + idx * 0.1);
          osc.stop(now + idx * 0.1 + 0.5);
        });
        break;
      }
      case 'gameOver': {
        // Sad game over descending notes
        const notes = [392.00, 349.23, 311.13, 261.63]; // G4, F4, Eb4, C4
        notes.forEach((freq, idx) => {
          const osc = this.ctx!.createOscillator();
          const gain = this.ctx!.createGain();
          osc.connect(gain);
          gain.connect(this.ctx!.destination);

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, now + idx * 0.15);

          gain.gain.setValueAtTime(0.1, now + idx * 0.15);
          gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.15 + 0.4);

          osc.start(now + idx * 0.15);
          osc.stop(now + idx * 0.15 + 0.4);
        });
        break;
      }
      case 'chat': {
        // Soft bubble pop
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

        osc.start(now);
        osc.stop(now + 0.08);
        break;
      }
      case 'alert': {
        // Warning tone
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(330, now + 0.08);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

        osc.start(now);
        osc.stop(now + 0.2);
        break;
      }
    }
  }
}

export const gameSounds = new SoundManager();
