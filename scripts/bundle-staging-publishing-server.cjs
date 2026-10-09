const fs = require('node:fs');
const path = require('node:path');

// SSH uses node's stdin rather than installing maintenance code on the host.
function bundle() {
  const helper = fs.readFileSync(path.join(__dirname, 'staging-source-retention.cjs'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'staging-publishing-server.cjs'), 'utf8');
  return server.replace("require('./staging-source-retention.cjs')",
    `(() => { const module = { exports: {} };\n${helper}\nreturn module.exports; })()`);
}
module.exports = { bundle };
if (require.main === module) process.stdout.write(bundle());
