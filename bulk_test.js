const fs = require('fs');
const fetch = require('isomorphic-unfetch');
const path = require('path');
const EventSource = require('eventsource');

async function testBulkConversion() {
    console.log("=== BULK CONVERSION INTEGRATION TEST ===\n");
    const bulkDir = path.join(__dirname, 'bulk_downloads');
    if (!fs.existsSync(bulkDir)) fs.mkdirSync(bulkDir);

    const testTracks = [
        { url: "https://www.youtube.com/watch?v=fRIhCiUVaKs", name: "BbY WOW", artists: ["KAROL G"] }, // 2:48
        { url: "https://www.youtube.com/watch?v=zPi4H9qRvyw", name: "Blinding Lights", artists: ["The Weeknd"] }, // 3:30
        { url: "https://www.youtube.com/watch?v=kffacxfA7G4", name: "Baby", artists: ["Justin Bieber"] }, // 3:39
        { url: "https://www.youtube.com/watch?v=YQHsXMglC9A", name: "Hello", artists: ["Adele"] }, // 6:06
        { url: "https://www.youtube.com/watch?v=JGwWNGJdvx8", name: "Shape of You", artists: ["Ed Sheeran"] } // 4:23
    ];
    
    // Simulate App.js logic
    const clientId = "test-bulk-" + Math.random().toString(36).substring(7);
    const es = new EventSource(`http://localhost:3000/api/youtube/events?clientId=${clientId}`);
    
    es.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.status !== "connected") {
            process.stdout.write(`[\x1b[36mTRACK ${data.trackIndex}\x1b[0m] ${data.trackName}: ${data.status} ${data.progress ? data.progress.toFixed(1) + '%' : ''}\n`);
        }
    };

    let completedCount = 0;
    let failedCount = 0;
    let currentIndex = 0;

    const runWorker = async () => {
        while (currentIndex < testTracks.length) {
            const index = currentIndex++;
            const t = testTracks[index];

            console.log(`Worker picked up Track ${index}: ${t.name}`);
            try {
                const res = await fetch('http://localhost:3000/api/youtube/convert-track', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: t.url, clientId, trackIndex: index, trackName: t.name })
                });

                if (!res.ok) throw new Error("Status " + res.status);
                
                const buffer = await res.arrayBuffer();
                const outPath = path.join(bulkDir, `${index+1} - ${t.artists[0]} - ${t.name}.mp3`);
                fs.writeFileSync(outPath, Buffer.from(buffer));
                
                completedCount++;
            } catch (err) {
                console.error(`Track ${index} Failed:`, err.message);
                failedCount++;
            }
        }
    };

    console.log("Starting 3 concurrent workers...\n");
    const workers = [runWorker(), runWorker(), runWorker()];
    
    await Promise.all(workers);
    es.close();

    console.log(`\n=== BULK TEST SUMMARY ===`);
    console.log(`Total Attempted: ${testTracks.length}`);
    console.log(`Successful: ${completedCount}`);
    console.log(`Failed: ${failedCount}`);

    const dirContents = fs.readdirSync(bulkDir);
    console.log(`Generated Files in bulk_downloads:`, dirContents);
}

testBulkConversion();
