import { spawn } from 'node:child_process';

/**
 * The owner's own ffmpeg and ffprobe (D-086): not bundled or redistributed. Every call is a
 * spawn with an argument list (no shell), killed when the job's signal aborts, and bounded.
 */
export interface VideoTools {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  /** Font family for the Thai subtitles; fontconfig or CoreText fills in missing glyphs. */
  readonly subtitleFont: string;
}

/** The tool is not installed (or not where FFMPEG_PATH says). Permanent: a retry cannot help. */
export class VideoToolMissing extends Error {
  constructor(readonly tool: string) {
    super(`${tool} was not found`);
    this.name = 'VideoToolMissing';
  }
}

/** The tool ran and failed. `detail` is the end of its error output, for the log only. */
export class VideoToolFailed extends Error {
  constructor(
    readonly tool: string,
    readonly detail: string,
  ) {
    super(`${tool} failed`);
    this.name = 'VideoToolFailed';
  }
}

const MAX_OUTPUT = 64 * 1024;

export function runTool(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly signal: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(options.signal.reason instanceof Error ? options.signal.reason : new Error('aborted'));
      return;
    }
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    const onAbort = () => child.kill('SIGKILL');
    options.signal.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error: NodeJS.ErrnoException) => {
      options.signal.removeEventListener('abort', onAbort);
      reject(error.code === 'ENOENT' ? new VideoToolMissing(command) : error);
    });
    child.on('close', (code) => {
      options.signal.removeEventListener('abort', onAbort);
      if (options.signal.aborted) {
        reject(
          options.signal.reason instanceof Error ? options.signal.reason : new Error('aborted'),
        );
      } else if (code === 0) {
        resolve(stdout);
      } else {
        reject(new VideoToolFailed(command, stderr));
      }
    });
  });
}

export interface ProbeResult {
  readonly durationMs: number;
  readonly hasAudio: boolean;
  readonly hasVideo: boolean;
}

export async function probe(
  tools: VideoTools,
  file: string,
  options: { readonly cwd: string; readonly signal: AbortSignal },
): Promise<ProbeResult> {
  const out = await runTool(
    tools.ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file],
    options,
  );
  const parsed = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: { codec_type?: string }[];
  };
  const seconds = Number(parsed.format?.duration ?? '0');
  const types = (parsed.streams ?? []).map((stream) => stream.codec_type);
  return {
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0,
    hasAudio: types.includes('audio'),
    hasVideo: types.includes('video'),
  };
}

/**
 * The ffmpeg arguments that turn the clips into one 1080x1920 MP4: each clip scaled and padded to
 * fit, 30 fps, silent audio where a clip has none, joined in order, subtitles burned in when a
 * subtitle file is given (a plain name in the working directory, so it needs no escaping).
 */
export function assembleArgs(
  clips: readonly {
    readonly file: string;
    readonly durationMs: number;
    readonly hasAudio: boolean;
  }[],
  options: { readonly subtitleFile: string | null; readonly output: string },
): string[] {
  const args: string[] = ['-hide_banner', '-nostdin', '-y'];
  for (const clip of clips) args.push('-i', clip.file);
  // One silent track per clip without audio, as its own input after the clips.
  const silentIndex = new Map<number, number>();
  clips.forEach((clip, index) => {
    if (!clip.hasAudio) {
      silentIndex.set(index, clips.length + silentIndex.size);
      args.push(
        '-f',
        'lavfi',
        '-t',
        (Math.max(clip.durationMs, 1) / 1000).toFixed(3),
        '-i',
        'anullsrc=r=48000:cl=stereo',
      );
    }
  });
  const parts: string[] = [];
  const pairs: string[] = [];
  clips.forEach((_clip, index) => {
    parts.push(
      `[${index}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${index}]`,
    );
    const audio = silentIndex.get(index) ?? index;
    parts.push(
      `[${audio}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${index}]`,
    );
    pairs.push(`[v${index}][a${index}]`);
  });
  const joined = options.subtitleFile === null ? '[vout]' : '[vjoined]';
  parts.push(`${pairs.join('')}concat=n=${clips.length}:v=1:a=1${joined}[aout]`);
  if (options.subtitleFile !== null) {
    parts.push(`[vjoined]subtitles=${options.subtitleFile}[vout]`);
  }
  args.push(
    '-filter_complex',
    parts.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    options.output,
  );
  return args;
}
