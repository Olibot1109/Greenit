const fs = require('fs');
const steal = [
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/babyShark.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/blobfish.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/clownfish.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/crab.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/dolphin.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/frog.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/jellyfish.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/megalodon.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/narwhal.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/octopus.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/oldBoot.svg",
    "https://blooket.s3.us-east-2.amazonaws.com/blooks/aquatic/pufferFish.svg"
]

const cooks = `bcid=%7B%22i%22%3A%20%22482adf46-7025-40fa-a480-9ebd375c6c01%22%2C%20%22r%22%3A%201774733674842%7D; cookieyes-consent=consentid:NXZJMlBxc2lZZXNDbGVBMnlKWjZ6UmJJRjhUdTFtVmQ,consent:yes,action:yes,necessary:yes,analytics:yes,advertisement:yes,lastRenewedDate:1752694071000; _b2_csrf_id=MTc3MjE0MTk1NHxJbXBTVjNCYWJtdEZMMlo0UnpkT1Iwc3dhVXh4TnpCVWRUUmljSGxCTkZkVU4zRkJiblZ2ZWpGalFsVTlJZ289fAay3_yIe33eTISv-uKB1g_9PSjxo4BLRMBFNhRcLdfm; bsid=MTc3MjE0MTk1NHxEZ0psQ01fZFJ1dTl1U3VzVVpTUFZfXzhrYkk1dG1DRmpLd3FpNmJKcUlESV9Za0RTV2k4aEU4Z0JHdz18f0Zi5JxC3ohOKmB8H2z3ZofSGXiv4xtJ55tkgWNkiZ0=; _ga=GA1.1.493974714.1772143583; _cfuvid=Dumt5itp3r82BcXnI2zcaCwtuqIGRpTU3DO4S6Utmk4-1772310599313-0.0.1.1-604800000; _ga_XPTRQH7XY5=GS2.1.s1772319795$o8$g1$t1772319971$j60$l0$h0; cf_clearance=4oC7_sFajlQhW6k4966L7.D8LvQ.2sLU6XrSDdLUWMw-1772320553-1.2.1.1-YddPn.iWoFCDZ1sjmsBuPFtDUZQueVnPC6W1DHB1yw5bq.0l1lZd6P3r64UndcnwdS5TC26dXmw1hdt3vpppkS6l8VdrvKHu0VCBfBuAfFrStAmWWszhoCJ0FvOFl99MeLCftx4ymo0bFMN3iIQ0jx9.J4DmJjr20KWvp2UAi.yCwPhQUDFLaRr0QjMXv9qTgTu.Da3SUqvm7zKtmYAbOQ7ww0izonkbrQWi0zQoKEg; __cf_bm=rUU6742zHwAIagiFAefBzLb9nzr63SNR01jonaIWqRs-1772320960-1.0.1.1-2lItuugioDYB1r73o6lOt8DdOo1W1wpHDl97vbfwtLEBgYcFO9f0RykV0VdGUojXZ2aXfoPdlr49vTM.E.HkElRu6LqbLz65MCV7N06QfUg`

// fetch the image and save it to the local filesystem
steal.forEach(async (url) => {
    // addd cookie header
    const headers = {
            "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "pragma": "no-cache",
    "priority": "i",
    "sec-ch-ua": "\"Not:A-Brand\";v=\"99\", \"Google Chrome\";v=\"145\", \"Chromium\";v=\"145\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "image",
    "sec-fetch-mode": "no-cors",
    "sec-fetch-site": "same-site",
    "cookie": "bcid=%7B%22i%22%3A%20%22482adf46-7025-40fa-a480-9ebd375c6c01%22%2C%20%22r%22%3A%201774733674842%7D; cookieyes-consent=consentid:NXZJMlBxc2lZZXNDbGVBMnlKWjZ6UmJJRjhUdTFtVmQ,consent:yes,action:yes,necessary:yes,analytics:yes,advertisement:yes,lastRenewedDate:1752694071000; _b2_csrf_id=MTc3MjE0MTk1NHxJbXBTVjNCYWJtdEZMMlo0UnpkT1Iwc3dhVXh4TnpCVWRUUmljSGxCTkZkVU4zRkJiblZ2ZWpGalFsVTlJZ289fAay3_yIe33eTISv-uKB1g_9PSjxo4BLRMBFNhRcLdfm; bsid=MTc3MjE0MTk1NHxEZ0psQ01fZFJ1dTl1U3VzVVpTUFZfXzhrYkk1dG1DRmpLd3FpNmJKcUlESV9Za0RTV2k4aEU4Z0JHdz18f0Zi5JxC3ohOKmB8H2z3ZofSGXiv4xtJ55tkgWNkiZ0=; _ga=GA1.1.493974714.1772143583; _cfuvid=Dumt5itp3r82BcXnI2zcaCwtuqIGRpTU3DO4S6Utmk4-1772310599313-0.0.1.1-604800000; _ga_XPTRQH7XY5=GS2.1.s1772319795$o8$g1$t1772319971$j60$l0$h0; cf_clearance=4oC7_sFajlQhW6k4966L7.D8LvQ.2sLU6XrSDdLUWMw-1772320553-1.2.1.1-YddPn.iWoFCDZ1sjmsBuPFtDUZQueVnPC6W1DHB1yw5bq.0l1lZd6P3r64UndcnwdS5TC26dXmw1hdt3vpppkS6l8VdrvKHu0VCBfBuAfFrStAmWWszhoCJ0FvOFl99MeLCftx4ymo0bFMN3iIQ0jx9.J4DmJjr20KWvp2UAi.yCwPhQUDFLaRr0QjMXv9qTgTu.Da3SUqvm7zKtmYAbOQ7ww0izonkbrQWi0zQoKEg; __cf_bm=rUU6742zHwAIagiFAefBzLb9nzr63SNR01jonaIWqRs-1772320960-1.0.1.1-2lItuugioDYB1r73o6lOt8DdOo1W1wpHDl97vbfwtLEBgYcFO9f0RykV0VdGUojXZ2aXfoPdlr49vTM.E.HkElRu6LqbLz65MCV7N06QfUg"
    }
    const res = await fetch(url , { headers });
    const data = await res.arrayBuffer();
    const filename = `icons/${url.split('/').pop()}`;
    fs.writeFileSync(filename, Buffer.from(data));
    console.log(res.status, filename);
});