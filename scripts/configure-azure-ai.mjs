import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function azureAISettings(env) {
  const required = ['AZURE_AI_ENDPOINT', 'AZURE_AI_API_KEY', 'AZURE_AI_MODEL'];
  if (env.AI_PROVIDER !== 'azure-foundry' || required.some(name => !env[name]?.trim())) {
    throw new Error('Azure AI deployment settings are incomplete. Check the repository variables and encrypted API key secret.');
  }
  let endpoint;
  try { endpoint = new URL(env.AZURE_AI_ENDPOINT); } catch { /* Report no setting values. */ }
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !['.services.ai.azure.com', '.openai.azure.com', '.cognitiveservices.azure.com', '.models.ai.azure.com', '.inference.ai.azure.com'].some(suffix => endpoint.hostname.endsWith(suffix))) {
    throw new Error('Azure AI endpoint must be an Azure resource HTTPS URL.');
  }
  const settings = { AI_PROVIDER: 'azure-foundry' };
  const names = [...required, 'AZURE_AI_API_STYLE', 'AZURE_AI_VISION_MODEL', 'AZURE_AI_RESPONSE_FORMAT', 'AZURE_AI_MAX_OUTPUT_TOKENS', 'AZURE_AI_API_VERSION'];
  for (const name of names) {
    if (env[name]?.trim()) settings[name] = env[name].trim();
  }
  return settings;
}

export function configureAzureAI(env = process.env, run = spawnSync) {
  const settings = azureAISettings(env);
  if (!env.AZURE_WEBAPP_NAME || !env.AZURE_RESOURCE_GROUP) throw new Error('Azure Web App target is missing.');
  const directory = mkdtempSync(join(tmpdir(), 'idrmm-ai-settings-'));
  const path = join(directory, 'settings.json');
  try {
    // Only this allowlist is transferred. Never log the file or put secrets in process arguments.
    writeFileSync(path, JSON.stringify(settings), { mode: 0o600 });
    const result = run('az', ['webapp', 'config', 'appsettings', 'set',
      '--name', env.AZURE_WEBAPP_NAME, '--resource-group', env.AZURE_RESOURCE_GROUP,
      '--settings', `@${path}`, '--output', 'none', '--only-show-errors'], { stdio: 'pipe' });
    if (result.status !== 0) throw new Error('Could not configure Azure AI app settings. Check the deployment identity permissions.');
    console.log('Azure AI app settings applied. Credentials were not logged.');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { configureAzureAI(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
