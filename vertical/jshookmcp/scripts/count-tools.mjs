import fs from 'fs';
import path from 'path';

const domainsDir = 'src/server/domains';
let total = 0;

for (const domain of fs.readdirSync(domainsDir).toSorted()) {
  const defFile = path.join(domainsDir, domain, 'definitions.ts');
  if (!fs.existsSync(defFile)) continue;
  const content = fs.readFileSync(defFile, 'utf8');
  // Count tool('name' or { name: 'xxx' occurrences
  const matches = content.match(/tool\(['"`][^'"`]+['"`]/g);
  const count = matches ? matches.length : 0;
  if (count > 0) {
    console.log(`${domain}: ${count} tools`);
    total += count;
  }
}
console.log(`\nTotal: ${total} tools`);
