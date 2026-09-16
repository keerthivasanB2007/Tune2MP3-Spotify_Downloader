document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('url-form');
    const urlInput = document.getElementById('playlist-url');
    const submitBtn = document.getElementById('submit-btn');
    const loadingState = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    const resultsContainer = document.getElementById('results');
    const playlistInfo = document.getElementById('playlist-info');
    const extractionStats = document.getElementById('extraction-stats');
    const tracksList = document.getElementById('tracks-list');
    const limitationWarning = document.getElementById('limitation-warning');
    
    const youtubeSearchContainer = document.getElementById('youtube-search-container');
    const searchYoutubeBtn = document.getElementById('search-youtube-btn');
    const youtubeProgress = document.getElementById('youtube-progress');
    const bulkDownloadContainer = document.getElementById('bulk-download-container');
    const downloadAllBtn = document.getElementById('download-all-btn');
    const bulkProgressUi = document.getElementById('bulk-progress-ui');
    const bulkDownloadedCount = document.getElementById('bulk-downloaded-count');
    const bulkRemainingCount = document.getElementById('bulk-remaining-count');
    const currentTrackName = document.getElementById('current-track-name');
    const currentTrackProgress = document.getElementById('current-track-progress');
    const currentTrackPct = document.getElementById('current-track-pct');
    const cancelBulkBtn = document.getElementById('cancel-bulk-btn');

    let currentTracks = [];
    let isBulkCancelled = false;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const url = urlInput.value.trim();
        if (!url) return;

        // Reset UI
        errorMessage.classList.add('hidden');
        resultsContainer.classList.add('hidden');
        limitationWarning.classList.add('hidden');
        loadingState.classList.remove('hidden');
        extractionStats.classList.add('hidden');
        youtubeSearchContainer.classList.add('hidden');
        youtubeProgress.classList.add('hidden');
        bulkDownloadContainer.classList.add('hidden');
        bulkProgressUi.classList.add('hidden');
        searchYoutubeBtn.disabled = false;
        searchYoutubeBtn.style.display = 'inline-block';
        downloadAllBtn.style.display = 'inline-block';
        submitBtn.disabled = true;

        try {
            const response = await fetch('/api/spotify/playlist', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'An unexpected error occurred while fetching the playlist.');
            }

            currentTracks = data.tracks;
            renderPlaylist(data.playlist);
            renderStats(data.stats, data.tracks.length);
            renderTracks(data.tracks);
            
            // Handle limitation of 100 tracks
            if (data.tracks.length >= 100) {
                limitationWarning.classList.remove('hidden');
            }
            
            resultsContainer.classList.remove('hidden');
            if (currentTracks.length > 0) {
                youtubeSearchContainer.classList.remove('hidden');
            }
            
        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.classList.remove('hidden');
        } finally {
            loadingState.classList.add('hidden');
            submitBtn.disabled = false;
        }
    });

    function renderPlaylist(playlist) {
        let html = '';
        
        if (playlist.image) {
            html += `<img src="${escapeHtml(playlist.image)}" alt="Playlist cover" class="playlist-image">`;
        }
        
        html += `
            <div class="playlist-details">
                <h2>${escapeHtml(playlist.name)}</h2>
                ${playlist.description ? `<p class="description">${escapeHtml(playlist.description)}</p>` : ''}
                <p class="meta">${playlist.totalTracks} playlist total tracks</p>
            </div>
        `;
        
        playlistInfo.innerHTML = html;
    }

    function renderStats(stats, returnedCount) {
        if (!stats) return;

        let html = `
            <div class="stats-item">
                <span class="stats-number">${returnedCount}</span>
                <span class="stats-label">tracks returned</span>
            </div>
            <div class="stats-item">
                <span class="stats-number">${stats.availableTracks}</span>
                <span class="stats-label">available</span>
            </div>
        `;

        if (stats.skippedTracks > 0) {
            html += `
            <div class="stats-item">
                <span class="stats-number warning">${stats.skippedTracks}</span>
                <span class="stats-label">unavailable</span>
            </div>
            `;
        }
        
        extractionStats.innerHTML = html;
        extractionStats.classList.remove('hidden');
    }

    function renderTracks(tracks) {
        if (!tracks || tracks.length === 0) {
            tracksList.innerHTML = '<li style="padding: 1rem;">No tracks could be loaded from this playlist.</li>';
            return;
        }

        const tracksHtml = tracks.map((track, i) => {
            const nameEl = track.spotifyUrl 
                ? `<a href="${escapeHtml(track.spotifyUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(track.name)}</a>`
                : escapeHtml(track.name);
            
            const imageEl = track.image
                ? `<img src="${escapeHtml(track.image)}" class="track-thumb" alt="Album Cover">`
                : `<div class="track-thumb placeholder">🎵</div>`;

            return `
                <li class="track-item" id="track-item-${i}">
                    <span class="track-index">#${i + 1}</span>
                    ${imageEl}
                    <div class="track-info">
                        <div class="track-title">${nameEl}</div>
                        <div class="track-meta">
                            ${escapeHtml(track.artistText)} &bull; ${escapeHtml(track.album)}
                        </div>
                    </div>
                </li>
            `;
        }).join('');

        tracksList.innerHTML = tracksHtml;
    }

    searchYoutubeBtn.addEventListener('click', async () => {
        searchYoutubeBtn.disabled = true;
        youtubeProgress.classList.remove('hidden');
        
        let completed = 0;
        const batchSize = 5; // Batch control
        
        youtubeProgress.textContent = `Searching YouTube... ${completed} / ${currentTracks.length} completed`;
        
        for (let i = 0; i < currentTracks.length; i += batchSize) {
            const chunk = currentTracks.slice(i, i + batchSize);
            
            try {
                const response = await fetch('/api/youtube/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tracks: chunk })
                });
                
                const data = await response.json();
                
                if (data.success && data.results) {
                    data.results.forEach((result, idx) => {
                        const globalIdx = i + idx;
                        const li = document.getElementById(`track-item-${globalIdx}`);
                        if (!li) return;
                        
                        const infoDiv = li.querySelector('.track-info');
                        if (!infoDiv) return;

                        if (infoDiv.querySelector('.youtube-result')) return;

                        // CRITICAL FIX: Assign the result back to the global tracker!
                        currentTracks[globalIdx].youtube = result.youtube || null;

                        const ytDiv = document.createElement('div');
                        if (result.youtube) {
                            // As soon as one positive youtube result hits, unhide the container
                            bulkDownloadContainer.classList.remove('hidden');

                            ytDiv.className = 'youtube-result';
                            ytDiv.innerHTML = `&#9658; YouTube: <a href="${escapeHtml(result.youtube.url)}" target="_blank">${escapeHtml(result.youtube.title)}</a> 
                            <button class="download-mp3-btn secondary-btn" style="margin-left: 15px; font-size: 0.75em; padding: 0.25rem 0.75rem;" data-url="${escapeHtml(result.youtube.url)}">Download MP3</button>
                            <div class="bulk-status-msg" style="font-size: 0.85em; font-weight: bold; margin-top: 5px;"></div>`;
                        } else {
                            ytDiv.className = 'youtube-result error';
                            ytDiv.innerHTML = `${result.error || 'No YouTube result found'} <div class="bulk-status-msg" style="font-size: 0.85em; font-weight: bold; margin-top: 5px;"></div>`;
                        }
                        infoDiv.appendChild(ytDiv);
                    });
                }
            } catch (err) {
                console.error("YouTube search batch failed", err);
            }
            
            completed += chunk.length;
            youtubeProgress.textContent = `Searching YouTube... ${Math.min(completed, currentTracks.length)} / ${currentTracks.length} completed`;
        }
        
        youtubeProgress.textContent = `YouTube search completed for ${currentTracks.length} tracks.`;
        searchYoutubeBtn.style.display = 'none';
    });

    tracksList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('download-mp3-btn')) {
            const btn = e.target;
            const url = btn.getAttribute('data-url');
            if (!url) return;
            
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Converting...';

            try {
                const res = await fetch('/api/youtube/convert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Conversion process failed.');
                }

                const blob = await res.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                
                let filename = 'audio.mp3';
                const disposition = res.headers.get('Content-Disposition');
                if (disposition && disposition.includes('filename="')) {
                    filename = disposition.split('filename="')[1].split('"')[0];
                    try { filename = decodeURIComponent(filename); } catch(err) {}
                } else if (disposition && disposition.includes('filename=')) {
                    filename = disposition.split('filename=')[1];
                    try { filename = decodeURIComponent(filename); } catch(err) {}
                }
                
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = downloadUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                    window.URL.revokeObjectURL(downloadUrl);
                    a.remove();
                }, 100);
                
                btn.textContent = 'Downloaded!';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 3000);

            } catch (err) {
                console.error("Download failed:", err);
                btn.textContent = 'Error';
                const errorMsg = document.createElement('span');
                errorMsg.className = 'error';
                errorMsg.style.fontSize = '0.8em';
                errorMsg.style.marginLeft = '10px';
                errorMsg.style.backgroundColor = 'transparent';
                errorMsg.style.padding = '0';
                errorMsg.textContent = err.message;
                btn.parentElement.appendChild(errorMsg);
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                    if(errorMsg.parentElement) errorMsg.remove();
                }, 5000);
            }
        }
    });

    // BULK DOWNLOAD ACTION
    downloadAllBtn.addEventListener('click', async () => {
        if (!window.showDirectoryPicker) {
            alert('Your browser does not support the File System Access API. Please use Chrome or Edge (Desktop) to use the Bulk Download feature.');
            return;
        }

        let dirHandle;
        try {
            dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        } catch (err) {
            console.error("Directory picker cancelled or failed:", err);
            return;
        }

        bulkProgressUi.classList.remove('hidden');
        downloadAllBtn.style.display = 'none';
        isBulkCancelled = false;

        const queue = currentTracks.map((track, index) => ({ track, index })).filter(item => item.track.youtube);
        const totalEligible = queue.length;
        
        let completedCount = 0;
        let failedCount = 0;
        let currentIndex = 0;

        const updateOverallStats = () => {
            bulkDownloadedCount.textContent = `Overall: ${completedCount}/${totalEligible}`;
            bulkRemainingCount.textContent = `Remaining: ${totalEligible - (completedCount + failedCount)}`;
        };

        const updateTrackStatus = (index, statusHtml) => {
            const li = document.getElementById(`track-item-${index}`);
            if (li) {
                const msgDiv = li.querySelector('.bulk-status-msg');
                if (msgDiv) msgDiv.innerHTML = statusHtml;
            }
        };

        currentTracks.forEach((t, i) => {
            if (!t.youtube) {
                updateTrackStatus(i, `<span style="color: #888;">— Skipped (No YouTube result)</span>`);
            } else {
                updateTrackStatus(i, `<span style="color: #666;">○ Waiting</span>`);
            }
        });
        updateOverallStats();

        const clientId = Math.random().toString(36).substring(2, 15);
        const eventSource = new EventSource(`/api/youtube/events?clientId=${clientId}`);
        
        eventSource.onmessage = (e) => {
            const data = JSON.parse(e.data);
            if (data.status === 'connected') return;
            
            if (data.status === 'downloading' || data.status === 'converting...') {
                const pctText = data.progress !== null ? `${data.progress}%` : '';
                updateTrackStatus(data.trackIndex, `<span style="color: #1DB954;">↓ Downloading... ${pctText}</span>`);
                
                currentTrackName.textContent = `Downloading: ${data.trackName}`;
                if (data.progress !== null) {
                    currentTrackProgress.value = data.progress;
                    currentTrackPct.textContent = `${data.progress}%`;
                } else {
                    currentTrackProgress.removeAttribute('value');
                    currentTrackPct.textContent = `Converting...`;
                }
            }
        };

        cancelBulkBtn.onclick = () => {
            isBulkCancelled = true;
            cancelBulkBtn.disabled = true;
            cancelBulkBtn.textContent = 'Cancelling...';
        };

        const runWorker = async () => {
            while (currentIndex < queue.length && !isBulkCancelled) {
                const item = queue[currentIndex++];
                updateTrackStatus(item.index, `<span style="color: #1DB954;">↓ Preparing...</span>`);
                
                try {
                    const res = await fetch('/api/youtube/convert-track', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: item.track.youtube.url, clientId, trackIndex: item.index, trackName: item.track.name })
                    });
                    
                    if (!res.ok) throw new Error('Backend failed');
                    const blob = await res.blob();
                    
                    const safeTitle = item.track.name.replace(/[<>:"/\\|?*]/g, "").trim() || 'audio';
                    const safeArtist = item.track.artists[0] ? item.track.artists[0].replace(/[<>:"/\\|?*]/g, "").trim() : 'Unknown';
                    let filename = `${(item.index + 1).toString().padStart(2, '0')} - ${safeArtist} - ${safeTitle}.mp3`;
                    
                    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    
                    updateTrackStatus(item.index, `<span style="color: #1DB954;">✓ Completed</span>`);
                    completedCount++;
                } catch (err) {
                    console.error("Failed item:", item.track.name, err);
                    updateTrackStatus(item.index, `<span style="color: #d32f2f;">✕ Failed</span>`);
                    failedCount++;
                }
                updateOverallStats();
            }
        };

        const workers = [];
        for (let i = 0; i < 3; i++) workers.push(runWorker());
        await Promise.all(workers);
        
        eventSource.close();
        
        currentTrackName.textContent = isBulkCancelled ? 'Download Cancelled' : 'Download Complete';
        currentTrackPct.textContent = '';
        currentTrackProgress.value = 100;
        cancelBulkBtn.style.display = 'none';

        if (isBulkCancelled) {
             while (currentIndex < queue.length) {
                 const skippedItem = queue[currentIndex++];
                 updateTrackStatus(skippedItem.index, `<span style="color: #f57c00;">⚠ Cancelled/Waiting</span>`);
             }
        }
    });

    // Basic HTML sanitizer for text content
    function escapeHtml(unsafe) {
        if (!unsafe || typeof unsafe !== 'string') return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
