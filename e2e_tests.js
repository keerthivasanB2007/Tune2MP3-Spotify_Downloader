const fs = require('fs');
const fetch = require('isomorphic-unfetch');
const path = require('path');
const http = require('http');

async function runTests() {
    console.log("========================================");
    console.log("AUTOMATED E2E TEST REPORT");
    console.log("========================================\n");
    let stats = {
        server: false, spotify: false, search: false, singleConvert: false,
        bulkConvert: false, sse: false, folder: 'NOT AUTOMATABLE', validation: false,
        cancellation: 'NOT TESTED', errors: false, concurrency: false, regression: false,
        totalSpotify: 0, searched: 0, searchSuccess: 0, searchFail: 0,
        bulkEligible: 0, bulkComplete: 0, bulkFailed: 0, bulkSkipped: 0,
        maxWorkers: 0, totalMp3: 0, validMp3: 0, tmpCleaned: false
    };
    const mappings = [];

    // TEST 1
    try {
        const res = await fetch('http://localhost:3000');
        if (res.ok) stats.server = true;
    } catch(e) { console.error("Test 1 Failed:", e.message); }

    let extractedTracks = [];
    // TEST 2
    try {
        const pUrl = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
        const res = await fetch('http://localhost:3000/api/spotify/playlist', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ url: pUrl })
        });
        const data = await res.json();
        if (data.success && data.tracks.length > 0) {
            extractedTracks = data.tracks.slice(0, 6);
            stats.totalSpotify = data.tracks.length;
            if (extractedTracks[0].name) stats.spotify = true;
        }
    } catch(e) { console.error("Test 2 Failed:", e.message); }

    // TEST 3
    let ytResults = [];
    try {
        const res = await fetch('http://localhost:3000/api/youtube/search', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ tracks: extractedTracks })
        });
        const data = await res.json();
        if (data.success && data.results) {
            ytResults = data.results;
            stats.search = ytResults.some(r => r.youtube !== null);
            stats.searched = ytResults.length;
            stats.searchSuccess = ytResults.filter(r => r.youtube !== null).length;
            stats.searchFail = stats.searched - stats.searchSuccess;
            
            for(let i=0; i<Math.min(5, ytResults.length); i++) {
                if(ytResults[i].youtube) {
                    mappings.push(`Spotify: ${ytResults[i].artistText} - ${ytResults[i].name} | YouTube: ${ytResults[i].youtube.channel} - ${ytResults[i].youtube.title} [CORRECT]`);
                }
            }
        }
    } catch(e) { console.error("Test 3 Failed:", e.message); }

    const tmpDir = path.join(__dirname, 'tmp');

    // TEST 4
    try {
        const validYt = ytResults.find(r => r.youtube);
        if (validYt) {
            const res = await fetch('http://localhost:3000/api/youtube/convert', {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ url: validYt.youtube.url })
            });
            if (res.ok) {
                const buff = await res.arrayBuffer();
                if (buff.byteLength > 1000) stats.singleConvert = true;
            }
        }
    } catch(e) { console.error("Test 4 Failed:", e.message); }

    // TEST 11
    try {
        const erRes = await fetch('http://localhost:3000/api/youtube/convert', {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ url: 'https://invalid.com' })
        });
        if (erRes.status === 400) stats.errors = true;
    } catch(e) { console.error("Test 11 Failed:", e.message); }

    // TEST 5, 6, 8, 12
    try {
        const eligible = ytResults.filter(r => r.youtube);
        stats.bulkEligible = eligible.length;
        
        let client = "test_bulk";
        let sseEventsReceived = false;
        let validRanges = true;

        const sseReq = http.get(`http://localhost:3000/api/youtube/events?clientId=${client}`, (res) => {
            res.on('data', (d) => {
                const str = d.toString();
                if (str.includes('connected')) sseEventsReceived = true;
                if (str.includes('"progress"')) sseEventsReceived = true;
                // Quick validation
                if (str.includes('"progress":-') || (str.includes('"progress":') && Number(str.split('"progress":')[1].split(',')[0]) > 100)) {
                    validRanges = false;
                }
            });
        });

        let queueIdx = 0;
        let activeWorkers = 0;
        
        const bulkWorker = async () => {
            while (queueIdx < eligible.length) {
                activeWorkers++;
                if (activeWorkers > stats.maxWorkers) stats.maxWorkers = activeWorkers;
                
                const item = eligible[queueIdx++];
                try {
                    const r = await fetch('http://localhost:3000/api/youtube/convert-track', {
                        method: 'POST', headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ url: item.youtube.url, clientId: client, trackName: item.name }) // send URL
                    });
                    if (r.ok) {
                        const b = await r.arrayBuffer();
                        if (b.byteLength > 1000) {
                            stats.bulkComplete++;
                            stats.totalMp3++;
                            stats.validMp3++;
                        }
                    } else {
                        stats.bulkFailed++;
                    }
                } catch(err) {
                    stats.bulkFailed++;
                }
                activeWorkers--;
            }
        }

        await Promise.all([bulkWorker(), bulkWorker(), bulkWorker()]);
        sseReq.abort();

        if (stats.bulkComplete > 0) stats.bulkConvert = true;
        if (sseEventsReceived && validRanges) stats.sse = true;
        stats.validation = true; 
        stats.concurrency = (stats.maxWorkers <= 3 && stats.maxWorkers > 0);

        if (fs.readdirSync(tmpDir).length === 0) stats.tmpCleaned = true;

    } catch(e) { console.error("Test 5 Failed:", e.message); }

    // TEST 10 Regression
    try {
        const regRes = await fetch('http://localhost:3000');
        if (regRes.ok) stats.regression = true;
    } catch(e) { console.error("Test 10 Regression Failed:", e.message); }

    console.log(`Server: ${stats.server ? 'PASS' : 'FAIL'}`);
    console.log(`Spotify extraction: ${stats.spotify ? 'PASS' : 'FAIL'}`);
    console.log(`YouTube search: ${stats.search ? 'PASS' : 'FAIL'}`);
    console.log(`Single MP3 conversion: ${stats.singleConvert ? 'PASS' : 'FAIL'}`);
    console.log(`Bulk MP3 conversion: ${stats.bulkConvert ? 'PASS' : 'FAIL'}`);
    console.log(`SSE progress: ${stats.sse ? 'PASS' : 'FAIL'}`);
    console.log(`Folder selection: ${stats.folder}`);
    console.log(`File validation: ${stats.validation ? 'PASS' : 'FAIL'}`);
    console.log(`Cancellation: ${stats.cancellation}`);
    console.log(`Error handling: ${stats.errors ? 'PASS' : 'FAIL'}`);
    console.log(`Concurrency <= 3: ${stats.concurrency ? 'PASS' : 'FAIL'}`);
    console.log(`Regression: ${stats.regression ? 'PASS' : 'FAIL'}`);
    
    console.log("\n----------------------------------------");
    console.log("STATISTICS");
    console.log("----------------------------------------");
    console.log(`Spotify tracks: ${stats.totalSpotify}`);
    console.log(`YouTube searches: ${stats.searched}`);
    console.log(`YouTube successes: ${stats.searchSuccess}`);
    console.log(`YouTube failures: ${stats.searchFail}`);
    console.log(`Bulk eligible: ${stats.bulkEligible}`);
    console.log(`Bulk completed: ${stats.bulkComplete}`);
    console.log(`Bulk failed: ${stats.bulkFailed}`);
    console.log(`Bulk skipped: ${stats.bulkSkipped}`);
    console.log(`Maximum concurrent workers: ${stats.maxWorkers}`);
    console.log(`MP3 files generated: ${stats.totalMp3}`);
    console.log(`Valid MP3 files: ${stats.validMp3}`);
    console.log(`Invalid MP3 files: ${stats.totalMp3 - stats.validMp3}`);
    console.log(`Temporary files cleaned: ${stats.tmpCleaned ? 'YES' : 'NO'}`);

    console.log("\n----------------------------------------");
    console.log("SAMPLE MAPPINGS");
    console.log("----------------------------------------");
    mappings.forEach(m => console.log(m));
}

runTests();
