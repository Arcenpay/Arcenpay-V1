import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const artifactsBase = path.join(root, '..', 'packages', 'contracts', 'artifacts', 'contracts', 'core');
const outDir = path.join(root, 'abis');

const contracts = [
  ['PlanFactory.sol', 'PlanFactory.json'],
  ['SubscriptionRegistry.sol', 'SubscriptionRegistry.json'],
  ['SessionVault.sol', 'SessionVault.json'],
  ['ZKUsageVerifier.sol', 'ZKUsageVerifier.json'],
  ['FeeCollector.sol', 'FeeCollector.json'],
];

fs.mkdirSync(outDir, { recursive: true });

for (const [folder, file] of contracts) {
  const src = path.join(artifactsBase, folder, file);
  const dest = path.join(outDir, file);

  if (!fs.existsSync(src)) {
    throw new Error(`Missing artifact: ${src}`);
  }

  const artifact = JSON.parse(fs.readFileSync(src, 'utf8'));
  fs.writeFileSync(dest, JSON.stringify({ abi: artifact.abi }, null, 2));
  console.log(`synced ${file}`);
}
