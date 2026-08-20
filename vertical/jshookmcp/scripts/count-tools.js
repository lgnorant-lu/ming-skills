// Count tools in each domain
const fs = require('fs');
const path = require('path');

const domainsDir = 'src/server/domains';
let total = 0;

// Loaded patterns from manifest files too
for (const domain of fs.readdirSync(domainsDir).toSorted()) {
  const defFile = path.join(domainsDir, domain, 'definitions.ts');
  if (!fs.existsSync(defFile)) continue;
  const content = fs.readFileSync(defFile, 'utf8');
  // Count tool('name' occurrences
  const matches = content.match(/tool\(['"][^'"]+['"]/g);
  const count = matches ? matches.length : 0;
  if (count > 0) {
    console.log(`${domain}: ${count} tools`);
    total += count;
  }
}
console.log(`\nTotal: ${total} tools`);
