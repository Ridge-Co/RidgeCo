// Test helper: worker.js functions are pulled out and run in new Function() sandboxes, which look free
// names up on the global object. Defining WOStatus there (from the REAL wo-status.js, not a copy) lets
// those sandboxes run code that reads WOStatus.sets.* exactly as the Worker does.
import fs from 'fs';
const src = fs.readFileSync(new URL('../wo-status.js', import.meta.url), 'utf8');
globalThis.WOStatus = new Function(src + '\nreturn WOStatus;')();
