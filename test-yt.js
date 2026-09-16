const fetch = require('isomorphic-unfetch');

async function test() {
    console.log("Starting test...");
    try {
        const response = await fetch('http://localhost:3000/api/youtube/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tracks: [
                    { name: 'Believer', artists: ['Imagine Dragons'], album: 'Evolve' },
                    { name: 'Loser', artists: ['Tame Impala'], album: 'Currents' },
                    { name: 'Super Unknown Track', artists: ['Unknown Artist'], album: 'Unknown Album' }
                ]
            })
        });

        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch(err) {
        console.error(err);
    }
}

test();
