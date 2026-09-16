const fetch = require('isomorphic-unfetch');
const { getDetails, getData } = require('spotify-url-info')(fetch);
const fs = require('fs');

async function test() {
    try {
        const details = await getDetails('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
        const data = await getData('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
        
        fs.writeFileSync('details_full.json', JSON.stringify(details, null, 2));
        fs.writeFileSync('data_full.json', JSON.stringify(data, null, 2));
    } catch(e) {
        console.error(e);
    }
}
test();
