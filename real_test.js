const fetch = require('isomorphic-unfetch');

async function test() {
    console.log("=== REAL END-TO-END YOUTUBE SEARCH VERIFICATION ===\n");
    try {
        console.log("1. Fetching Spotify Playlist (https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M)...");
        const spotifyRes = await fetch('http://localhost:3000/api/spotify/playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M' })
        });
        
        const spotifyData = await spotifyRes.json();
        if (!spotifyData.success) throw new Error("Spotify extraction failed");
        
        const tracks = spotifyData.tracks;
        console.log(`Successfully extracted ${tracks.length} tracks.`);
        
        // Select 5 tracks for detailed testing
        // Need to ensure criteria: multiple artists, album unavailable if possible
        const sampleTracks = [];
        let missingAlbumCount = 0;
        let multipleArtistsCount = 0;

        for (const track of tracks) {
            if (sampleTracks.length >= 5) break;
            
            if (track.album === 'Unknown Album' && missingAlbumCount === 0) {
                sampleTracks.push(track);
                missingAlbumCount++;
            } else if (track.artists.length > 1 && multipleArtistsCount === 0) {
                sampleTracks.push(track);
                multipleArtistsCount++;
            } else if (sampleTracks.length < 5) {
                // Ensure we don't have duplicates
                if (!sampleTracks.includes(track)) {
                     sampleTracks.push(track);
                }
            }
        }

        console.log("\n2. Sending selected tracks to YouTube search endpoint...\n");
        const ytRes = await fetch('http://localhost:3000/api/youtube/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: sampleTracks })
        });

        const ytData = await ytRes.json();
        
        let successful = 0;
        let failed = 0;

        const report = [];

        ytData.results.forEach((result, idx) => {
            if (result.youtube) {
                successful++;
            } else {
                failed++;
            }
            
            report.push(`Spotify:
- Song name: ${result.name}
- Artist(s): ${result.artists.join(', ')}
- Album: ${result.album}

Generated YouTube query:
- searchQuery: "${result.searchQuery}"

Selected result:
- YouTube title: ${result.youtube ? result.youtube.title : 'N/A'}
- YouTube URL: ${result.youtube ? result.youtube.url : 'N/A'}
- Video ID: ${result.youtube ? result.youtube.videoId : 'N/A'}
- Channel: ${result.youtube ? result.youtube.channel : 'N/A'}
- Score: ${result.youtube ? result.youtube.score : 'N/A'}\n`);
        });

        console.log(report.join("\n-----------------------------------\n\n"));
        
        console.log("=== REAL TEST SUMMARY ===");
        console.log(`Number of tracks searched: ${sampleTracks.length}`);
        console.log(`Number of successful YouTube results: ${successful}`);
        console.log(`Number of failed searches: ${failed}`);
        
    } catch(err) {
        console.error("Test execution failed:", err.message);
    }
}

test();
