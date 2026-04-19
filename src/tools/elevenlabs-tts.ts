import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';

export interface ElevenLabsTtsDeps {
  getApiKey: () => string | undefined;
}

function speak(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform;
    let cmd: string;
    if (platform === 'darwin') {
      cmd = `afplay "${filePath}"`;
    } else if (platform === 'linux') {
      cmd = `aplay "${filePath}" 2>/dev/null || paplay "${filePath}" 2>/dev/null || mpv --no-video "${filePath}"`;
    } else {
      cmd = `powershell -c "(New-Object Media.SoundPlayer '${filePath}').PlaySync()"`;
    }
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

function ttsRequest(
  apiKey: string,
  voiceId: string,
  text: string,
  model: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });
    const req = https.request(
      {
        hostname: 'api.elevenlabs.io',
        path: `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200) {
            reject(new Error(`ElevenLabs API ${res.statusCode}: ${buf.toString('utf8').slice(0, 200)}`));
            return;
          }
          resolve(buf);
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('ElevenLabs request timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export function createSpeakHandler(deps: ElevenLabsTtsDeps) {
  return async (kwargs: Record<string, unknown>): Promise<string> => {
    const text = String(kwargs.text || '').trim();
    if (!text) return '[ERROR] Missing required argument: text';

    const apiKey = deps.getApiKey();
    if (!apiKey) return '[ERROR] ELEVENLABS_API_KEY not set. Ask the user to provide it or set it in their environment.';

    const voiceId = String(kwargs.voice_id || 'JBFqnCBsd6RMkjVDRZzb').trim();
    const model = String(kwargs.model || 'eleven_multilingual_v2').trim();

    const audio = await ttsRequest(apiKey, voiceId, text, model);
    const tmpFile = path.join(os.tmpdir(), `clodcode-tts-${Date.now()}.mp3`);
    fs.writeFileSync(tmpFile, audio);

    try {
      await speak(tmpFile);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* cleanup best-effort */ }
    }

    return `Spoke aloud: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`;
  };
}
