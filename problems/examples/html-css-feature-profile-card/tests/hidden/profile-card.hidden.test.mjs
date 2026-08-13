import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readHtml = () => readFile(new URL('../../starter/index.html', import.meta.url), 'utf8');

test('画像altと1カラム用media ruleを持ちscriptを含まない', async () => {
  const html = await readHtml();
  assert.match(html, /<img\b(?=[^>]*\balt=["'][^"']+["'])[^>]*>/i);
  assert.match(
    html,
    /@media\s*\(\s*max-width\s*:\s*600px\s*\)[\s\S]*?\.profile-card\s*\{[^}]*grid-template-columns\s*:\s*1fr\s*;/i
  );
  assert.doesNotMatch(html, /<script\b/i);
});
