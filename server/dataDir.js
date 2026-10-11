const fs = require('fs');
const path = require('path');

const STAT_FILES = ['strategy-state.json', 'learner-state.json', 'rng-intel.json'];

function dataDir() {
  const env = process.env.DATA_DIR;
  const dir = env ? path.resolve(env) : path.join(__dirname, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dataFile(name) {
  const dest = path.join(dataDir(), name);
  const bundled = path.join(__dirname, 'data', name);
  if (path.resolve(dest) !== path.resolve(bundled) && !fs.existsSync(dest) && fs.existsSync(bundled)) {
    try {
      fs.copyFileSync(bundled, dest);
    } catch {
      // start empty if the volume is not writable yet
    }
  }
  return dest;
}

if (process.env.RESET_STATS === '1') {
  for (const name of STAT_FILES) {
    try {
      fs.unlinkSync(path.join(dataDir(), name));
    } catch {
      // already empty
    }
  }
}

module.exports = { dataDir, dataFile };
