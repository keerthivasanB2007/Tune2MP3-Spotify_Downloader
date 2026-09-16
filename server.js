const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fetch = require('isomorphic-unfetch');
const { getDetails, getTracks, getData } = require('spotify-url-info')(fetch);

const app = express();
const PORT = process.env.PORT || 3000;

const sseClients = new Map();

// Helper to ensure tmp dir exists
const tmpDir = path.join(__dirname, 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

let ytDlpExe = 'yt-dlp';
let ffmpegExe = 'ffmpeg';
let isYtDlpAvailable = false;
let isFfmpegAvailable = false;

const findWinGetPackageExe = (fileName, preferGyan = false) => {
    if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return null;
    const wingetDir = path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    if (!fs.existsSync(wingetDir)) return null;

    let foundPaths = [];
    const searchRecursively = (dir) => {
        try {
            const files = fs.readdirSync(dir, { withFileTypes: true });
            for (const file of files) {
                if (file.isDirectory()) {
                    searchRecursively(path.join(dir, file.name));
                } else if (file.name.toLowerCase() === fileName.toLowerCase()) {
                    foundPaths.push(path.join(dir, file.name));
                }
            }
        } catch (e) {
            // Ignore permissions or recursive folder read errors
        }
    };
    
    searchRecursively(wingetDir);
    if (foundPaths.length === 0) return null;

    if (preferGyan && fileName.toLowerCase() === 'ffmpeg.exe') {
        const gyanPath = foundPaths.find(p => p.includes('Gyan.FFmpeg'));
        if (gyanPath) return gyanPath;
    }

    return foundPaths[0]; // fallback to first match
};

let denoExe = 'deno';
let isDenoAvailable = false;

try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
        try {
            ytDlpExe = execSync('where.exe yt-dlp', { stdio: 'pipe' }).toString().split(/\r?\n/)[0].trim();
        } catch (e) {
            const wgPath = findWinGetPackageExe('yt-dlp.exe');
            if (wgPath) ytDlpExe = wgPath;
        }
        
        try {
            ffmpegExe = execSync('where.exe ffmpeg', { stdio: 'pipe' }).toString().split(/\r?\n/)[0].trim();
        } catch (e) {
            const wgPath = findWinGetPackageExe('ffmpeg.exe', true);
            if (wgPath) ffmpegExe = wgPath;
        }

        try { denoExe = execSync('where.exe deno', { stdio: 'pipe' }).toString().split(/\r?\n/)[0].trim(); } catch(e) {}
    } else {
        try { ytDlpExe = execSync('which yt-dlp', { stdio: 'pipe' }).toString().split('\n')[0].trim(); } catch (e) {}
        try { ffmpegExe = execSync('which ffmpeg', { stdio: 'pipe' }).toString().split('\n')[0].trim(); } catch (e) {}
        
        denoExe = '/usr/local/bin/deno';
        try { 
            if (!fs.existsSync(denoExe)) {
                denoExe = execSync('which deno', { stdio: 'pipe' }).toString().split('\n')[0].trim();
            }
        } catch (e) {}
    }
} catch (e) { }

isYtDlpAvailable = (ytDlpExe !== 'yt-dlp' && fs.existsSync(ytDlpExe)) || process.platform !== 'win32';
isFfmpegAvailable = (ffmpegExe !== 'ffmpeg' && fs.existsSync(ffmpegExe)) || process.platform !== 'win32';
isDenoAvailable = (denoExe !== 'deno' && fs.existsSync(denoExe)) || process.platform !== 'win32';

if (isYtDlpAvailable && isFfmpegAvailable) {
    console.log(`[INFO] yt-dlp resolved: ${ytDlpExe}`);
    console.log(`[INFO] FFmpeg resolved: ${ffmpegExe}`);
    
    let localDenoVer = 'unknown';
    try { 
        localDenoVer = require('child_process').execSync(`"${denoExe}" --version`, { stdio: 'pipe' }).toString().split('\n')[0].trim(); 
    } catch(e) {
        localDenoVer = (e.stderr ? e.stderr.toString().trim() : e.message) || 'Error getting version';
    }
    
    console.log(`[INFO] Deno resolved: ${isDenoAvailable ? denoExe : 'NOT FOUND'}`);
    console.log(`[INFO] Deno version: ${localDenoVer}`);
} else {
    console.warn(`[WARNING] Executable resolution failed.`);
}

// URL validation helper for youtube
const isValidYoutubeUrl = (url) => {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname !== 'www.youtube.com' && parsedUrl.hostname !== 'youtube.com' && parsedUrl.hostname !== 'youtu.be') {
            return false;
        }
        return true;
    } catch (err) {
        return false;
    }
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get('/api/youtube/diagnostics', async (req, res) => {
    try {
        const { execSync } = require('child_process');
        let ytVersion = 'unknown';
        let denoVersion = 'unknown';
        try { ytVersion = execSync(`"${ytDlpExe}" --version`, { stdio: 'pipe' }).toString().trim(); } catch(e){}
        
        try { 
            denoVersion = execSync(`"${denoExe}" --version`, { stdio: 'pipe' }).toString().split('\n')[0].trim(); 
        } catch(e) {
            denoVersion = (e.stderr ? e.stderr.toString().trim() : e.message) || 'Error executing Deno';
        }
        
        res.json({
            ytDlpAvailable: isYtDlpAvailable,
            ffmpegAvailable: isFfmpegAvailable,
            denoAvailable: isDenoAvailable,
            ytDlpPath: ytDlpExe,
            ffmpegPath: ffmpegExe,
            denoPath: denoExe,
            ytDlpVersion: ytVersion,
            denoVersion: denoVersion
        });
    } catch(e) {
        res.status(500).json({ error: 'Diagnostics failed' });
    }
});

app.get('/api/youtube/test-conversion', async (req, res) => {
    const url = 'https://www.youtube.com/watch?v=fRIhCiUVaKs';
    let videoId = Date.now().toString() + '-' + Math.round(Math.random()*1e9);
    const outputPath = path.join(tmpDir, `${videoId}.%(ext)s`);
    const mp3Path = path.join(tmpDir, `${videoId}.mp3`);
    
    // Exact args from convert-track
    const ytdlpArgs = ['--ffmpeg-location', ffmpegExe, '--js-runtimes', 'deno', '--remote-components', 'ejs:npm', '--extractor-args', 'youtube:player_client=android,web', '-x', '--audio-format', 'mp3', '-o', outputPath, url];
    
    let result = {
        command: ytDlpExe,
        args: ytdlpArgs.join(' '),
        deno: denoExe,
        ffmpeg: ffmpegExe,
        url: url,
        spawnError: null,
        exitCode: null,
        stdout: "",
        stderr: "",
        mp3Exists: false,
        mp3Size: 0,
        ytDlpVersion: "unknown",
        denoVersion: "unknown",
        ffmpegVersion: "unknown"
    };

    try { result.ytDlpVersion = require('child_process').execSync(`"${ytDlpExe}" --version`, { stdio: 'pipe' }).toString().trim(); } catch(e){}
    try { result.denoVersion = require('child_process').execSync(`"${denoExe}" --version`, { stdio: 'pipe' }).toString().split('\n')[0].trim(); } catch(e){}
    try { result.ffmpegVersion = require('child_process').execSync(`"${ffmpegExe}" -version`, { stdio: 'pipe' }).toString().split('\n')[0].trim(); } catch(e){}

    try {
        const ytdlp = spawn(ytDlpExe, ytdlpArgs);
        
        ytdlp.stdout.on('data', (data) => { result.stdout += data.toString(); });
        ytdlp.stderr.on('data', (data) => { result.stderr += data.toString(); });
        
        ytdlp.on('error', (err) => {
            result.spawnError = err.message;
            if (!res.headersSent) res.json(result);
        });
        
        ytdlp.on('close', (code) => {
            result.exitCode = code;
            if (fs.existsSync(mp3Path)) {
                result.mp3Exists = true;
                const stats = fs.statSync(mp3Path);
                result.mp3Size = stats.size;
                try { fs.unlinkSync(mp3Path); } catch (e) {}
            }
            if (!res.headersSent) res.json(result);
        });
    } catch (err) {
        result.spawnError = err.message;
        if (!res.headersSent) res.json(result);
    }
});

// URL validation helper
const isValidSpotifyPlaylistUrl = (url) => {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname !== 'open.spotify.com') return false;
        
        const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
        if (pathParts.length !== 2 || pathParts[0] !== 'playlist') return false;
        
        return true;
    } catch (err) {
        return false;
    }
};

const normalizeTrack = (rawTrack) => {
    if (!rawTrack) return null;

    // Artists extraction
    let artists = [];
    if (Array.isArray(rawTrack.artists)) {
        artists = rawTrack.artists.map(a => typeof a === 'string' ? a : a?.name).filter(Boolean);
    } else if (rawTrack.album && Array.isArray(rawTrack.album.artists)) {
        artists = rawTrack.album.artists.map(a => typeof a === 'string' ? a : a?.name).filter(Boolean);
    }
    
    // Check fallback string formats from getDetails or getData
    if (artists.length === 0) {
        if (typeof rawTrack.artist === 'string') {
            artists = rawTrack.artist.split(',').map(s => s.trim());
        } else if (typeof rawTrack.subtitle === 'string') {
            artists = rawTrack.subtitle.split(',').map(s => s.trim());
        }
    }

    if (artists.length === 0) {
        artists = ["Unknown Artist"];
    }
    const artistText = artists.join(', ');

    // Album extraction
    const album = rawTrack.album?.name || "Unknown Album";

    // Track title extraction
    const name = rawTrack.name || rawTrack.title || "Unknown Track";

    // Spotify URL extraction
    let spotifyUrl = null;
    if (rawTrack.external_urls?.spotify) {
        spotifyUrl = rawTrack.external_urls.spotify;
    } else if (rawTrack.id && typeof rawTrack.id === 'string' && !rawTrack.id.includes('local')) {
        spotifyUrl = `https://open.spotify.com/track/${rawTrack.id}`;
    } else if (rawTrack.uri && typeof rawTrack.uri === 'string' && rawTrack.uri.startsWith('spotify:track:')) {
        const parts = rawTrack.uri.split(':');
        spotifyUrl = `https://open.spotify.com/track/${parts[2]}`;
    }

    // Image extraction
    let image = null;
    if (rawTrack.album?.images && Array.isArray(rawTrack.album.images) && rawTrack.album.images.length > 0) {
        image = rawTrack.album.images[0].url; 
    } else if (rawTrack.coverArt && Array.isArray(rawTrack.coverArt?.sources) && rawTrack.coverArt.sources.length > 0) {
        image = rawTrack.coverArt.sources[0].url;
    }

    return {
        name,
        artists,
        artistText,
        album,
        spotifyUrl,
        image
    };
};

const ytSearch = require('yt-search');

const normalizeTitle = (title) => {
    if (!title || typeof title !== 'string') return '';
    return title
        .toLowerCase()
        .replace(/\(official.*?\)/g, '')
        .replace(/\[official.*?\]/g, '')
        .replace(/\(music video\)/g, '')
        .replace(/\[music video\]/g, '')
        .replace(/[^\w\s]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const buildYouTubeSearchQuery = (track) => {
    const parts = [
        track.name,
        ...(Array.isArray(track.artists) ? track.artists : []),
        track.album
    ];

    return parts
        .filter(value =>
            value &&
            typeof value === "string" &&
            !/^unknown/i.test(value.trim())
        )
        .map(value => value.trim())
        .filter(Boolean)
        .join(" ");
};

const scoreYouTubeResult = (result, track) => {
    let score = 0;
    const resultTitle = normalizeTitle(result.title);
    const trackName = normalizeTitle(track.name);
    
    // Title match
    if (resultTitle.includes(trackName)) {
        score += 5;
    }
    if (resultTitle === trackName) {
        score += 5;
    }

    // Artist match
    if (Array.isArray(track.artists)) {
        for (const artist of track.artists) {
            if (artist === 'Unknown Artist') continue;
            const artistNorm = normalizeTitle(artist);
            if (resultTitle.includes(artistNorm) || normalizeTitle(result.author?.name || '').includes(artistNorm)) {
                score += 3;
            }
        }
    }

    // Penalties
    const penalties = ['cover', 'karaoke', 'remix', 'live', 'slowed', 'sped up', 'nightcore', '8d', 'instrumental'];
    for (const penalty of penalties) {
        if (resultTitle.includes(penalty)) {
            // Check if track name actually contains this word (e.g., if the original song is a remix, don't penalize)
            if (!trackName.includes(penalty)) {
                score -= 5;
            }
        }
    }

    return score;
};

app.post('/api/youtube/search', async (req, res) => {
    const { tracks } = req.body;

    if (!tracks || !Array.isArray(tracks)) {
        return res.status(400).json({ success: false, error: 'Invalid payload. "tracks" array required.' });
    }

    if (tracks.length > 20) {
        return res.status(400).json({ success: false, error: 'Too many tracks in a single request. Please chunk on the client side.' });
    }

    const results = [];

    // Process sequentially to avoid aggressive rate limits
    for (const track of tracks) {
        if (!track.name) {
            results.push({ ...track, youtube: null, error: 'Missing track name' });
            continue;
        }

        const query = buildYouTubeSearchQuery(track);
        let bestMatch = null;
        let bestScore = -Infinity;

        try {
            const searchResult = await ytSearch(query);
            const videos = searchResult.videos.slice(0, 5); // top 5
            
            for (const video of videos) {
                const score = scoreYouTubeResult(video, track);
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = video;
                }
            }

            if (bestMatch) {
                results.push({
                    name: track.name,
                    artists: track.artists,
                    album: track.album,
                    searchQuery: query,
                    youtube: {
                        title: bestMatch.title,
                        url: bestMatch.url,
                        videoId: bestMatch.videoId,
                        channel: bestMatch.author?.name || null,
                        duration: bestMatch.timestamp || null,
                        thumbnail: bestMatch.thumbnail || null,
                        score: bestScore
                    }
                });
            } else {
                results.push({
                    name: track.name,
                    artists: track.artists,
                    album: track.album,
                    searchQuery: query,
                    youtube: null,
                    error: 'No suitable match found'
                });
            }

        } catch (err) {
            console.error(`YouTube search failed for query: ${query}`, err.message);
            results.push({
                name: track.name,
                artists: track.artists,
                album: track.album,
                searchQuery: query,
                youtube: null,
                error: 'YouTube search failed'
            });
        }
    }

    return res.json({ success: true, results });
});

app.get('/api/youtube/events', (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) {
        return res.status(400).end();
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial connection dummy event to flush headers
    res.write(`data: ${JSON.stringify({ status: 'connected' })}\n\n`);

    sseClients.set(clientId, res);
    
    req.on('close', () => {
        sseClients.delete(clientId);
    });
});

const sendSse = (clientId, data) => {
    const client = sseClients.get(clientId);
    if (client) {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    }
};

app.post('/api/youtube/convert-track', async (req, res) => {
    const { url, clientId, trackIndex, trackName } = req.body;
    if (!url || !isValidYoutubeUrl(url)) {
        if(clientId) sendSse(clientId, { trackIndex, trackName, status: 'failed', progress: 0, error: 'Invalid URL' });
        return res.status(400).json({ error: 'Invalid YouTube URL provided.' });
    }

    if (!isYtDlpAvailable) {
        if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'failed', progress: 0, error: 'yt-dlp missing' });
        return res.status(500).json({ error: 'yt-dlp is not available. Please install yt-dlp and ensure it is available in PATH.' });
    }
    if (!isFfmpegAvailable) {
        if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'failed', progress: 0, error: 'ffmpeg missing' });
        return res.status(500).json({ error: 'FFmpeg is not available. Please install FFmpeg and ensure it is available in PATH.' });
    }

    let safeTitle = trackName ? trackName.replace(/[^a-zA-Z0-9 ]/g, "").trim().substring(0, 50) : 'audio';
    let videoId = Date.now().toString() + '-' + Math.round(Math.random()*1e9);

    const outputPath = path.join(tmpDir, `${videoId}.%(ext)s`);
    const mp3Path = path.join(tmpDir, `${videoId}.mp3`);

    if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'downloading', progress: 0 });

    try {
        let stdoutLog = "";
        let stderrLog = "";
        
        // Use basic yt-dlp command. Add EJS components if needed for Render JS execution handling.
        const ytdlpArgs = ['--ffmpeg-location', ffmpegExe, '--js-runtimes', 'deno', '--remote-components', 'ejs:npm', '--extractor-args', 'youtube:player_client=android,web', '-x', '--audio-format', 'mp3', '-o', outputPath, url];

        console.log(`[CONVERT-TRACK] executable: ${ytDlpExe}`);
        console.log(`[CONVERT-TRACK] args: ${ytdlpArgs.join(' ')}`);
        console.log(`[CONVERT-TRACK] deno: ${denoExe}`);
        console.log(`[CONVERT-TRACK] ffmpeg: ${ffmpegExe}`);

        const ytdlp = spawn(ytDlpExe, ytdlpArgs);

        ytdlp.stdout.on('data', (data) => {
            const output = data.toString();
            stdoutLog += output;
            const match = output.match(/\[download\]\s+([\d\.]+)%/);
            if (match && match[1]) {
                if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'downloading', progress: parseFloat(match[1]) });
            }
            if (output.includes('[ExtractAudio]')) {
                if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'converting...', progress: null });
            }
        });

        ytdlp.stderr.on('data', (data) => {
            const output = data.toString();
            stderrLog += output; // Capture stderr logs completely
            
            const match = output.match(/\[download\]\s+([\d\.]+)%/);
            if (match && match[1]) {
                if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'downloading', progress: parseFloat(match[1]) });
            }
            if (output.includes('[ExtractAudio]')) {
                if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'converting...', progress: null });
            }
        });

        ytdlp.on('close', (code) => {
            if (code !== 0) {
                console.error(`[CONVERT-TRACK] track name: ${trackName}`);
                console.error(`[CONVERT-TRACK] YouTube URL: ${url}`);
                console.error(`[CONVERT-TRACK] yt-dlp exit code: ${code}`);
                console.error(`[CONVERT-TRACK] stderr:\n${stderrLog}`);
                
                if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'failed', progress: 0, error: 'code ' + code });
                
                const files = fs.readdirSync(tmpDir);
                for (const file of files) {
                    if (file.startsWith(videoId)) {
                        try { fs.unlinkSync(path.join(tmpDir, file)); } catch(e) {}
                    }
                }
                
                if (!res.headersSent) {
                    return res.status(500).json({ 
                        error: 'yt-dlp conversion failed',
                        exitCode: code,
                        details: stderrLog.trim(),
                        stdout: stdoutLog.trim()
                    });
                }
                return;
            }
            
            if (!fs.existsSync(mp3Path)) {
                if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'failed', progress: 0, error: 'Missing MP3' });
                if (!res.headersSent) return res.status(500).json({ error: 'File not created' });
                return;
            }

            res.download(mp3Path, `${safeTitle}.mp3`, (err) => {
                fs.unlink(mp3Path, () => {});
            });
        });
        
        ytdlp.on('error', (err) => {
            console.error(`[CONVERT-TRACK] track name: ${trackName}, err: ${err.message}`);
            if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'failed', progress: 0, error: err.message });
            if (!res.headersSent) res.status(500).json({ error: 'Spawn failed' });
        });

    } catch (err) {
        if (clientId) sendSse(clientId, { trackIndex, trackName, status: 'failed', progress: 0, error: err.message });
        if (!res.headersSent) res.status(500).json({ error: 'Internal failure' });
    }
});

app.post('/api/youtube/convert', async (req, res) => {
    console.log('[REQUEST] POST /api/youtube/convert received');
    const { url } = req.body;
    if (!url || !isValidYoutubeUrl(url)) {
        return res.status(400).json({ error: 'Invalid YouTube URL provided.' });
    }

    if (!isYtDlpAvailable) {
        return res.status(500).json({ error: 'yt-dlp is not available. Please install yt-dlp and ensure it is available in PATH.' });
    }
    if (!isFfmpegAvailable) {
        return res.status(500).json({ error: 'FFmpeg is not available. Please install FFmpeg and ensure it is available in PATH.' });
    }

    let safeTitle = 'audio';
    let videoId = Date.now().toString() + '-' + Math.round(Math.random()*1e9);

    console.log(`[CONVERT] YouTube URL: ${url}`);
    console.log(`[CONVERT] yt-dlp path: ${ytDlpExe}`);
    console.log(`[CONVERT] ffmpeg path: ${ffmpegExe}`);
    console.log(`[CONVERT] deno path: ${denoExe}`);

    try {
        console.log(`[CONVERT] Fetching metadata for ${url}...`);
        const { stdout: metadataStr } = await execPromise(`"${ytDlpExe}" --js-runtimes deno --remote-components ejs:npm --extractor-args youtube:player_client=android,web -j "${url}"`);
        const metadata = JSON.parse(metadataStr);
        safeTitle = metadata.title.replace(/[^a-zA-Z0-9 ]/g, "").trim().substring(0, 50) || 'audio';
        if (metadata.id) videoId = metadata.id + '-' + Math.round(Math.random()*1e5);
    } catch (err) {
        console.error(`[CONVERT] Metadata yt-dlp failed`);
        console.error(`[CONVERT] exit code: ${err.code || 'unknown'}`);
        console.error(`[CONVERT] stderr: ${err.stderr || err.message}`);
    }

    const outputPath = path.join(tmpDir, `${videoId}.%(ext)s`);
    const mp3Path = path.join(tmpDir, `${videoId}.mp3`);

    console.log(`[CONVERT] Starting conversion to MP3 for ${safeTitle}...`);
    try {
        await execPromise(`"${ytDlpExe}" --ffmpeg-location "${ffmpegExe}" --js-runtimes deno --remote-components ejs:npm --extractor-args youtube:player_client=android,web -x --audio-format mp3 -o "${outputPath}" "${url}"`);
        
        if (!fs.existsSync(mp3Path)) {
            throw new Error(`File was not created at ${mp3Path}`);
        }

        res.download(mp3Path, `${safeTitle}.mp3`, (err) => {
            if (err) {
                console.error("[CONVERT] Error sending file to client:", err.message);
            }
            // Cleanup Temp File
            fs.unlink(mp3Path, (unlinkErr) => {
                if (unlinkErr) console.error("[CONVERT] Error cleaning up tmp file:", unlinkErr);
            });
            console.log(`[CONVERT] Successfully served and cleaned up ${safeTitle}.mp3`);
        });

    } catch (err) {
        console.error(`[CONVERT] Conversion yt-dlp/ffmpeg failed`);
        console.error(`[CONVERT] exit code: ${err.code || 'unknown'}`);
        console.error(`[CONVERT] stderr: ${err.stderr || err.message}`);
        
        // Clean up strictly any orphaned file exactly matching the output ID
        const files = fs.readdirSync(tmpDir);
        for (const file of files) {
            if (file.startsWith(videoId)) {
                try {
                    fs.unlinkSync(path.join(tmpDir, file));
                } catch(e) {}
            }
        }
        
        return res.status(500).json({ 
            error: 'Failed to convert video to MP3.',
            details: String(err.stderr || err.message).trim().substring(0, 500)
        });
    }
});

app.post('/api/spotify/playlist', async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== 'string' || !isValidSpotifyPlaylistUrl(url)) {
        return res.status(400).json({ error: 'Invalid Spotify playlist URL. Please provide a URL in the format https://open.spotify.com/playlist/... ' });
    }

    console.log(`\nPlaylist extraction started`);
    console.log(`Playlist URL: ${url}`);
    
    try {
        let details = null;
        let tracksRaw = [];
        
        try {
            details = await getDetails(url);
            tracksRaw = details.tracks || [];
        } catch (err) {
            console.log("getDetails failed, attempting getTracks fallback.");
            try {
                tracksRaw = await getTracks(url);
            } catch (err2) {
                throw new Error("Unable to retrieve tracks from playlist.");
            }
        }
        
        const preview = details?.preview || {
            title: 'Unknown Playlist',
            description: '',
            image: null,
            track: tracksRaw.length
        };

        if (!tracksRaw || !Array.isArray(tracksRaw)) {
            throw new Error("Track list returned invalid format.");
        }
        
        console.log(`Tracks received: ${tracksRaw.length}`);

        const normalizedTracks = [];
        let availableTracks = 0;
        let skippedTracks = 0;
        let missingArtist = 0;
        let missingAlbum = 0;
        let missingUrl = 0;

        for (const rawTrack of tracksRaw) {
            const track = normalizeTrack(rawTrack);
            if (!track) {
                skippedTracks++;
                continue;
            }
            
            if (track.artists[0] === 'Unknown Artist') missingArtist++;
            if (track.album === 'Unknown Album') missingAlbum++;
            if (!track.spotifyUrl) missingUrl++;
            
            normalizedTracks.push(track);
            availableTracks++;
        }

        console.log(`Successfully normalized: ${availableTracks}`);
        console.log(`Skipped unavailable: ${skippedTracks}`);
        console.log(`Tracks missing artist: ${missingArtist}`);
        console.log(`Tracks missing album: ${missingAlbum}`);
        console.log(`Tracks missing Spotify URL: ${missingUrl}`);

        const playlist = {
            name: preview.title || 'Unknown Playlist',
            description: preview.description || '',
            image: preview.image || null,
            totalTracks: tracksRaw.length
        };

        return res.json({
            success: true,
            playlist,
            stats: {
                availableTracks,
                skippedTracks
            },
            tracks: normalizedTracks
        });

    } catch (err) {
        console.error("Error fetching spotify info:", err.message);
        return res.status(500).json({
            error: 'Failed to retrieve playlist information. It might be private, deleted, or network failed.'
        });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on 0.0.0.0:${PORT}`);
});
