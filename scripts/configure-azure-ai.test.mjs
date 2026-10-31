import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { azureAISettings, configureAzureAI } from './configure-azure-ai.mjs';

const env = { AI_PROVIDER: 'azure-foundry', AZURE_AI_ENDPOINT: 'https://fixture.services.ai.azure.com/openai/v1',
  AZURE_AI_API_KEY: 'private-fixture-key', AZURE_AI_MODEL: 'fixture-model', AZURE_AI_API_STYLE: 'openai',
  AZURE_WEBAPP_NAME: 'fixture-app', AZURE_RESOURCE_GROUP: 'fixture-group',
  SUPABASE_SECRET_KEY: 'unrelated-secret', BACKUP_ENCRYPTION_KEY: 'unrelated-backup' };

test('deployment refuses missing credentials or non-Azure endpoints before calling Azure', () => {
  for (const input of [{ ...env, AZURE_AI_API_KEY: '' }, { ...env, AI_PROVIDER: 'groq' },
    { ...env, AZURE_AI_ENDPOINT: 'https://example.com' }, { ...env, AZURE_AI_ENDPOINT: 'https://user:password@fixture.services.ai.azure.com' }]) {
    assert.throws(() => configureAzureAI(input, () => assert.fail('Must not call Azure')));
  }
  assert.equal(azureAISettings(env).SUPABASE_SECRET_KEY, undefined);
  assert.equal(azureAISettings(env).BACKUP_ENCRYPTION_KEY, undefined);
});

test('deployment transfers only AI settings using a private temporary file and removes it', () => {
  let path;
  configureAzureAI(env, (command, args, options) => {
    assert.equal(command, 'az');
    assert.ok(args.includes('fixture-app') && args.includes('fixture-group'));
    assert.equal(options.stdio, 'pipe');
    assert.ok(!args.join(' ').includes(env.AZURE_AI_API_KEY));
    path = args[args.indexOf('--settings') + 1].slice(1);
    const settings = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(settings.AZURE_AI_API_KEY, env.AZURE_AI_API_KEY);
    assert.equal(settings.AI_PROVIDER, 'azure-foundry');
    assert.equal(settings.SUPABASE_SECRET_KEY, undefined);
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
    return { status: 0 };
  });
  assert.equal(existsSync(path), false);
});

test('failed configuration removes the temporary key file and hides Azure diagnostics', () => {
  let path;
  assert.throws(() => configureAzureAI(env, (_command, args) => {
    path = args[args.indexOf('--settings') + 1].slice(1);
    return { status: 1, stderr: Buffer.from(env.AZURE_AI_API_KEY) };
  }), error => !error.message.includes(env.AZURE_AI_API_KEY) && /identity permissions/.test(error.message));
  assert.equal(existsSync(path), false);
});
