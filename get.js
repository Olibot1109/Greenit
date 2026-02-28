const fs = require('fs');
const blookSeeds = [
  'Nova',
  'Atlas',
  'Pixel',
  'Orbit',
  'Flare',
  'Echo',
  'Blitz',
  'Comet',
  'Sage',
  'Raven',
  'Mango',
  'Frost',
  'Viper',
  'Drift',
  'Quartz',
  'Neon',
  'Titan',
  'Cinder',
  'Onyx',
  'Lynx',
  'Basil',
  'Rogue',
  'Ember',
  'Jade',
  'Bolt',
  'Skye',
  'Rune',
  'Panda',
  'Mocha',
  'Cobra',
  'Iris',
  'Koda',
  'Zippy',
  'Marble',
  'Indigo',
  'Cocoa',
  'Poppy',
  'Noodle',
  'Aero',
  'Dune',
  'Moss',
  'Nimbus',
  'Sparky',
  'Velvet',
  'Pebble',
  'Tango',
  'Cosmo',
  'Jinx',
  'Sunny',
  'Willow',
  'Copper',
  'Hazel',
  'Miso',
  'Pico',
  'Rascal',
  'Bingo',
  'Fable',
  'Olive',
  'Rocket',
  'Sprout',
  'Tom',
  'Kirk'
];

async function work() {
    for (const seed of blookSeeds) {
        const url = `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}`;
        console.log(url);
        const res = await fetch(url);
        if (res.status !== 200) {
            console.log(`Failed to fetch ${url}`);
            continue;
        } else {
            console.log(`Done`);
            // save to file in pfp folder
            const data = await res.arrayBuffer();
            const filename = `pfp/${seed}.svg`;
            fs.writeFileSync(filename, Buffer.from(data));
        }
    }
}

work();