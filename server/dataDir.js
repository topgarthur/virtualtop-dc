const fs = require('fs');
const path = require('path');

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

module.exports = { dataDir, dataFile };
