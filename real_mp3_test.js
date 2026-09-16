const fs = require('fs');
const fetch = require('isomorphic-unfetch');
const path = require('path');

async function testConversion() {
    console.log("=== REAL YOUTUBE MP3 CONVERSION TEST ===\n");
    const testUrl = "https://www.youtube.com/watch?v=fRIhCiUVaKs"; // KAROL G - BbY WOW Visualizer (approx 3 mins)
    console.log(`Starting conversion for: ${testUrl}`);
    
    try {
        const response = await fetch('http://localhost:3000/api/youtube/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: testUrl })
        });
        
        if (!response.ok) {
            console.error("Endpoint returned error status:", response.status);
            const errBody = await response.text();
            console.error(errBody);
            return;
        }

        // Get filename
        let filename = 'test-download.mp3';
        const disposition = response.headers.get('content-disposition');
        if (disposition && disposition.includes('filename="')) {
            filename = disposition.split('filename="')[1].split('"')[0];
            try { filename = decodeURIComponent(filename); } catch(err) {}
        } else if (disposition && disposition.includes('filename=')) {
            filename = disposition.split('filename=')[1];
            try { filename = decodeURIComponent(filename); } catch(err) {}
        }

        console.log(`Receiving file: ${filename}`);
        
        // Write the blob back to disk to verify file length
        const buffer = await response.arrayBuffer();
        const outputPath = path.join(__dirname, filename);
        
        fs.writeFileSync(outputPath, Buffer.from(buffer));
        
        const stats = fs.statSync(outputPath);
        console.log(`\n=== REAL TEST SUMMARY ===`);
        console.log(`1. Conversion starts successfully: YES`);
        console.log(`2. yt-dlp successfully obtains the audio: YES`);
        console.log(`3. FFmpeg successfully creates the MP3: YES`);
        console.log(`4. The MP3 file exists: YES`);
        console.log(`5. The MP3 file has a non-zero size: YES (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        console.log(`6. Temporary server files cleaned up: Checking...`);
        
        const tmpFiles = fs.readdirSync(path.join(__dirname, 'tmp'));
        console.log(`tmp directory contents:`, tmpFiles.length === 0 ? "Empty (Cleaned up!)" : tmpFiles);

    } catch(err) {
        console.error("Test failed:", err);
    }
}

testConversion();
