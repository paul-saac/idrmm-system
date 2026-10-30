import test from 'node:test';
import assert from 'node:assert/strict';
import { getPasswordError, generateTemporaryPassword } from './password-policy.ts';

test('password length accepts 8 through 64 characters and rejects short, oversized and missing values',()=>{
  const minimum='Cedar1!x';
  assert.equal(minimum.length,8);
  assert.equal(getPasswordError(minimum),null);
  assert.match(getPasswordError(minimum.slice(0,-1)),/8 and 64/);
  const maximum='Cedar!Harbor2026'+'x'.repeat(48);
  assert.equal(maximum.length,64);
  assert.equal(getPasswordError(maximum),null);
  assert.ok(getPasswordError(maximum+'x'));
  for(const value of['',null,undefined,123])assert.ok(getPasswordError(value));
});

test('each character class is enforced; spaces cannot replace the required symbol',()=>{
  for(const [password,message] of[
    ['cedar!harbor2026','uppercase'],
    ['CEDAR!HARBOR2026','lowercase'],
    ['Cedar!HarborCoast','number'],
    ['Cedar Harbor2026','symbol'],
  ])assert.match(getPasswordError(password),new RegExp(message));
  assert.equal(getPasswordError('Cedar harbor breeze 2026!'),null);
});

test('common-password variations and repeated patterns are rejected even when they meet character rules',()=>{
  for(const password of['Password123456789!','Welcome20262026!','Qwertyuiop123456!','Aa1!Aa1!Aa1!Aa1!'])
    assert.match(getPasswordError(password),/predictable/);
});

test('Unicode passwords respect the bcrypt byte limit and control characters are rejected without truncation',()=>{
  assert.equal(getPasswordError('Cedar!Harbor2026'+'é'.repeat(28)),null);
  assert.match(getPasswordError('Cedar!Harbor2026'+'é'.repeat(29)),/too long/);
  assert.match(getPasswordError('Cedar!Harbor2026\u0000'),/printable/);
  assert.match(getPasswordError('Cedar!Harbor2026\n'),/printable/);
});

test('generated temporary passwords always satisfy the shared policy',()=>{
  for(let index=0;index<100;index++){
    const password=generateTemporaryPassword();
    assert.equal(password.length,20);
    assert.equal(getPasswordError(password),null);
  }
});
