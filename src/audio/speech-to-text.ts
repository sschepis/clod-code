import { spawn, execSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../shared/logger';

const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
const WHISPER_MODEL_FILE = 'ggml-base.en.bin';

export type RecordingStatus = 'idle' | 'recording' | 'transcribing' | 'error';

export interface SpeechToTextCallbacks {
  onStatusChange: (status: RecordingStatus, message?: string) => void;
  onTranscript: (text: string) => void;
  onError: (error: string) => void;
}

function which(cmd: string): string | null {
  try {
    return execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string, redirects = 0) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      https.get(u, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          follow(res.headers.location, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => { out.close(); resolve(); });
        out.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

export class SpeechToText {
  private storageDir: string;
  private recProcess: ChildProcess | null = null;
  private recording = false;
  private tempFile: string | null = null;
  private callbacks: SpeechToTextCallbacks | null = null;

  private recorderBin: string | null = null;
  private whisperBin: string | null = null;
  private modelPath: string | null = null;

  constructor(storageDir: string) {
    this.storageDir = path.join(storageDir, 'whisper');
  }

  setCallbacks(cb: SpeechToTextCallbacks): void {
    this.callbacks = cb;
  }

  async ensureReady(): Promise<{ available: boolean; reason?: string }> {
    this.recorderBin = which('rec') ?? which('sox');
    if (!this.recorderBin) {
      const ffmpeg = which('ffmpeg');
      if (ffmpeg) {
        this.recorderBin = ffmpeg;
      } else {
        return { available: false, reason: 'No audio recorder found. Install sox (`brew install sox` / `apt install sox`) or ffmpeg.' };
      }
    }

    this.whisperBin = which('whisper-cli') ?? which('whisper') ?? which('main');
    if (!this.whisperBin) {
      const localBin = path.join(this.storageDir, 'whisper-cli');
      if (fs.existsSync(localBin)) {
        this.whisperBin = localBin;
      }
    }

    if (!this.whisperBin) {
      return { available: false, reason: 'Whisper not found. Install whisper.cpp and ensure `whisper-cli` is on PATH, or place the binary in the extension storage.' };
    }

    fs.mkdirSync(this.storageDir, { recursive: true });
    this.modelPath = path.join(this.storageDir, WHISPER_MODEL_FILE);
    if (!fs.existsSync(this.modelPath)) {
      logger.info('[speech] Downloading whisper model...');
      this.callbacks?.onStatusChange('transcribing', 'Downloading whisper model (first-time setup)...');
      try {
        await downloadFile(WHISPER_MODEL_URL, this.modelPath);
        logger.info('[speech] Model downloaded');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('[speech] Model download failed', err);
        return { available: false, reason: `Failed to download whisper model: ${msg}` };
      }
    }

    return { available: true };
  }

  isRecording(): boolean {
    return this.recording;
  }

  async startRecording(): Promise<void> {
    if (this.recording) return;

    const ready = await this.ensureReady();
    if (!ready.available) {
      this.callbacks?.onError(ready.reason!);
      return;
    }

    this.tempFile = path.join(os.tmpdir(), `obotovs-rec-${Date.now()}.wav`);

    const isFfmpeg = this.recorderBin!.includes('ffmpeg');
    let args: string[];

    if (isFfmpeg) {
      args = ['-y', '-f'];
      if (process.platform === 'darwin') args.push('avfoundation', '-i', ':0');
      else if (process.platform === 'linux') args.push('pulse', '-i', 'default');
      else args.push('dshow', '-i', 'audio=default');
      args.push('-ar', '16000', '-ac', '1', '-t', '120', this.tempFile);
    } else {
      args = ['-q', '-r', '16000', '-c', '1', this.tempFile, 'trim', '0', '120'];
    }

    logger.info(`[speech] Starting recorder: ${this.recorderBin} ${args.join(' ')}`);

    this.recProcess = spawn(this.recorderBin!, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.recProcess.on('error', (err) => {
      logger.error('[speech] Recorder error', err);
      this.callbacks?.onError(`Recorder failed: ${err.message}`);
      this.recording = false;
      this.callbacks?.onStatusChange('error', err.message);
    });

    this.recording = true;
    this.callbacks?.onStatusChange('recording');
  }

  async stopRecording(): Promise<void> {
    if (!this.recording || !this.recProcess) return;

    this.recording = false;

    const proc = this.recProcess;
    this.recProcess = null;

    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve());
      proc.kill('SIGTERM');
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        resolve();
      }, 3000);
    });

    if (!this.tempFile || !fs.existsSync(this.tempFile)) {
      this.callbacks?.onError('No audio recorded');
      this.callbacks?.onStatusChange('idle');
      return;
    }

    const stat = fs.statSync(this.tempFile);
    if (stat.size < 1000) {
      this.cleanup();
      this.callbacks?.onError('Recording too short');
      this.callbacks?.onStatusChange('idle');
      return;
    }

    this.callbacks?.onStatusChange('transcribing');

    try {
      const text = await this.transcribe(this.tempFile);
      if (text.trim()) {
        this.callbacks?.onTranscript(text.trim());
      } else {
        this.callbacks?.onError('No speech detected');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('[speech] Transcription failed', err);
      this.callbacks?.onError(`Transcription failed: ${msg}`);
    } finally {
      this.cleanup();
      this.callbacks?.onStatusChange('idle');
    }
  }

  private transcribe(audioFile: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        '-m', this.modelPath!,
        '-f', audioFile,
        '--no-timestamps',
        '-l', 'en',
        '--output-txt',
      ];

      logger.info(`[speech] Transcribing: ${this.whisperBin} ${args.join(' ')}`);

      const proc = spawn(this.whisperBin!, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60000,
      });

      const stdout: string[] = [];
      const stderr: string[] = [];
      proc.stdout?.on('data', (d) => stdout.push(d.toString()));
      proc.stderr?.on('data', (d) => stderr.push(d.toString()));

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`whisper exited ${code}: ${stderr.join('')}`));
          return;
        }
        const txtFile = audioFile + '.txt';
        if (fs.existsSync(txtFile)) {
          const text = fs.readFileSync(txtFile, 'utf8');
          try { fs.unlinkSync(txtFile); } catch { /* best-effort */ }
          resolve(text);
        } else {
          resolve(stdout.join(''));
        }
      });

      proc.on('error', reject);
    });
  }

  private cleanup(): void {
    if (this.tempFile) {
      try { fs.unlinkSync(this.tempFile); } catch { /* best-effort */ }
      const txtFile = this.tempFile + '.txt';
      try { fs.unlinkSync(txtFile); } catch { /* best-effort */ }
      this.tempFile = null;
    }
  }

  dispose(): void {
    if (this.recProcess) {
      try { this.recProcess.kill('SIGKILL'); } catch { /* ignore */ }
      this.recProcess = null;
    }
    this.recording = false;
    this.cleanup();
  }
}
