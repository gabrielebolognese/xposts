// loads the browser scripts into Node's global scope
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function load(...files) {
  for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { filename: f });
};
