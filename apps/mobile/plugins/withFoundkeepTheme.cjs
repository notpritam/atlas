const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');
const palettes = require('../src/palettes.json');
function androidColor(value) {
  if (value.startsWith('#')) return value;
  const [r,g,b,a] = value.match(/[\d.]+/g).map(Number);
  return '#' + [Math.round(a*255),r,g,b].map(value=>value.toString(16).padStart(2,'0')).join('');
}
module.exports = config => withDangerousMod(config, ['android', async mod => {
  for (const [scheme, palette] of Object.entries(palettes)) {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res', scheme === 'dark' ? 'values-night' : 'values');
    fs.mkdirSync(directory, {recursive:true});
    fs.writeFileSync(path.join(directory,'foundkeep_colors.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' + Object.entries(palette).map(([key,value])=>`  <color name="foundkeep_${key.toLowerCase()}">${androidColor(value)}</color>`).join('\n') + '\n</resources>\n');
  }
  return mod;
}]);
