'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const HLS_DIR = path.join(PUBLIC, 'hls');
const WORK_DIR = path.join(ROOT, 'work');
const env = (key, fallback) => process.env[key] || fallback;
const intEnv = (key, fallback) => {
  const value = Number.parseInt(env(key, String(fallback)), 10);
  if (!Number.isFinite(value) || value < 1) throw new Error(`${key} must be a positive integer`);
  return value;
};
const settings = {
  width: intEnv('OUTPUT_WIDTH', 854),
  height: intEnv('OUTPUT_HEIGHT', 480),
  fps: intEnv('OUTPUT_FPS', 25),
  segmentSeconds: intEnv('HLS_SEGMENT_SECONDS', 4),
  playlistSize: intEnv('HLS_PLAYLIST_SIZE', 8),
  videoBitrate: env('VIDEO_BITRATE', '1100k'),
  audioBitrate: env('AUDIO_BITRATE', '96k'),
  adLogo: path.resolve(ROOT, env('AD_LOGO', 'assets/reklam-logo.png')),
  broadcastLogo: path.resolve(ROOT, env('BROADCAST_LOGO', 'assets/yayin-logo.png')),
};

function runProbe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', chunk => output += chunk);
    child.stderr.setEncoding('utf8').on('data', chunk => errors += chunk);
    child.on('error', reject);
    child.on('close', code => {
      const duration = Number.parseFloat(output.trim());
      if (code !== 0 || !Number.isFinite(duration) || duration <= 0) reject(new Error(`ffprobe failed for ${path.basename(file)}: ${errors.trim()}`));
      else resolve(duration);
    });
  });
}

function ffconcatQuote(file) {
  return file.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

async function buildPlaylist() {
  const listPath = path.join(ROOT, 'playlist.txt');
  const lines = fs.readFileSync(listPath, 'utf8').split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('#'));
  if (!lines.length) throw new Error('playlist.txt has no video entries');

  const items = [];
  for (const entry of lines) {
    if (path.isAbsolute(entry) || entry.includes('..') || entry.includes('/') || entry.includes('\\')) {
      throw new Error(`Use a video filename only in playlist.txt (files belong in videos/): ${entry}`);
    }
    const file = path.join(ROOT, 'videos', entry);
    if (!fs.existsSync(file)) throw new Error(`Missing playlist video: videos/${entry}`);
    items.push({ file, name: path.basename(entry).toLowerCase(), duration: await runProbe(file) });
  }

  fs.mkdirSync(WORK_DIR, { recursive: true });
  const concatPath = path.join(WORK_DIR, 'playlist.ffconcat');
  fs.writeFileSync(concatPath, 'ffconcat version 1.0\n' + items.map(x => `file '${ffconcatQuote(x.file)}'`).join('\n') + '\n');
  return { items, concatPath, totalDuration: items.reduce((sum, x) => sum + x.duration, 0) };
}

function adTimeline(items, totalDuration) {
  let cursor = 0;
  const adRanges = [];
  for (const item of items) {
    if (item.name === 'reklam.mp4') adRanges.push([cursor, cursor + item.duration]);
    cursor += item.duration;
  }
  if (!adRanges.length) return '0';
  return adRanges.map(([start, end]) => `between(mod(t\\,${totalDuration.toFixed(3)})\\,${start.toFixed(3)}\\,${end.toFixed(3)})`).join('+');
}

function startHttp() {
  const types = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, relative);
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': path.extname(file) === '.m3u8' ? 'no-store, no-cache, must-revalidate' : 'public, max-age=10',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  const port = intEnv('PORT', 3000);
  server.listen(port, '0.0.0.0', () => console.log(`HLS server listening on port ${port}; stream: /hls/index.m3u8`));
  return server;
}

async function main() {
  fs.mkdirSync(HLS_DIR, { recursive: true });
  if (!fs.existsSync(settings.adLogo)) throw new Error(`Missing ad logo: ${path.relative(ROOT, settings.adLogo)}`);
  if (!fs.existsSync(settings.broadcastLogo)) throw new Error(`Missing broadcast logo: ${path.relative(ROOT, settings.broadcastLogo)}`);
  const { items, concatPath, totalDuration } = await buildPlaylist();
  const timeline = adTimeline(items, totalDuration);
  const format = `${settings.width}:${settings.height}`;
  const graph = [
    `[0:v]scale=${format}:force_original_aspect_ratio=decrease,pad=${format}:(ow-iw)/2:(oh-ih)/2,fps=${settings.fps},format=yuv420p[base]`,
    `[1:v]scale=${settings.width}:${settings.height}:force_original_aspect_ratio=increase,crop=${format},format=rgba[adlogo]`,
    `[2:v]scale=${format}:force_original_aspect_ratio=increase,crop=${format},format=rgba[broadcastlogo]`,
    `[base][adlogo]overlay=0:0:enable='${timeline}'[ad]`,
    `[ad][broadcastlogo]overlay=0:0:enable='not(${timeline})',format=yuv420p[outv]`,
  ].join(';');
  const args = [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-stream_loop', '-1', '-re', '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-loop', '1', '-framerate', String(settings.fps), '-i', settings.adLogo,
    '-loop', '1', '-framerate', String(settings.fps), '-i', settings.broadcastLogo,
    '-filter_complex', graph, '-map', '[outv]', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-b:v', settings.videoBitrate,
    '-maxrate', settings.videoBitrate, '-bufsize', settings.videoBitrate,
    '-g', String(settings.fps * settings.segmentSeconds), '-keyint_min', String(settings.fps * settings.segmentSeconds), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', settings.audioBitrate, '-ar', '44100', '-ac', '2',
    '-f', 'hls', '-hls_time', String(settings.segmentSeconds), '-hls_list_size', String(settings.playlistSize),
    '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments+temp_file',
    '-hls_segment_filename', path.join(HLS_DIR, 'segment_%06d.ts'), path.join(HLS_DIR, 'index.m3u8'),
  ];

  const server = startHttp();
  console.log(`Playlist loaded (${items.length} entries, ${totalDuration.toFixed(1)}s per loop).`);
  console.log('Starting a single continuous FFmpeg process; wait for the first HLS segments before opening the stream.');
  const child = spawn(ffmpeg, args, { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  let shuttingDown = false;
  const stop = signal => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, stopping FFmpeg...`);
    child.kill('SIGTERM');
    server.close();
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  child.on('error', error => { console.error('Could not start FFmpeg:', error); process.exitCode = 1; server.close(); });
  child.on('close', code => {
    if (!shuttingDown) {
      console.error(`FFmpeg exited with code ${code}. Check that playlist videos share compatible codecs, resolution, and audio streams.`);
      server.close();
      process.exitCode = code || 1;
    }
  });
}

main().catch(error => { console.error(error.message); process.exit(1); });
