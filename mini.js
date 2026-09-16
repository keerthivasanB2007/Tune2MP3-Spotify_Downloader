const fetch = require('isomorphic-unfetch');

async function testSingle() {
    console.log("Testing Single MP3...");
    const res = await fetch('http://localhost:3000/api/youtube/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: "https://www.youtube.com/watch?v=fRIhCiUVaKs" })
    });
    
    if (!res.ok) {
        console.error("Single HTTP Error:", res.status, await res.text());
        return;
    }
    const buff = await res.arrayBuffer();
    console.log("Single Bytes received:", buff.byteLength);
}

testSingle();
