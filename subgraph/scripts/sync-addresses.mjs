import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = { deployment: '', network: '' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--deployment') {
      out.deployment = argv[i + 1] || '';
      i += 1;
    } else if (argv[i] === '--network') {
      out.network = argv[i + 1] || '';
      i += 1;
    }
  }
  return out;
}

const { deployment, network } = parseArgs(process.argv);
if (!deployment) {
  throw new Error('Missing --deployment <path>');
}
if (!network) {
  throw new Error('Missing --network <name>');
}

const root = path.resolve(process.cwd());
const deploymentPath = path.resolve(root, deployment);
const yamlPath = path.join(root, 'subgraph.yaml');

if (!fs.existsSync(deploymentPath)) {
  throw new Error(`Deployment file not found: ${deploymentPath}`);
}
if (!fs.existsSync(yamlPath)) {
  throw new Error(`subgraph.yaml not found: ${yamlPath}`);
}

const deploymentJson = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const contracts = deploymentJson.contracts || {};
const addressMap = {
  PlanFactory: contracts.PlanFactory,
  SubscriptionRegistry: contracts.SubscriptionRegistry,
  SessionVault: contracts.SessionVault,
  ZKUsageVerifier: contracts.ZKUsageVerifier,
  FeeCollector: contracts.FeeCollector,
};

let yaml = fs.readFileSync(yamlPath, 'utf8');
yaml = yaml.replace(/network: .*/g, `network: ${network}`);

for (const [name, address] of Object.entries(addressMap)) {
  if (!address) {
    throw new Error(`Missing contract address for ${name} in deployment file.`);
  }
  const pattern = new RegExp(`name: ${name}[\\s\\S]*?address: \"0x[a-fA-F0-9]{40}\"`, 'm');
  yaml = yaml.replace(pattern, (match) => match.replace(/address: \"0x[a-fA-F0-9]{40}\"/, `address: \"${address}\"`));
}

fs.writeFileSync(yamlPath, yaml);
console.log(`Updated subgraph.yaml using ${deploymentPath}`);
