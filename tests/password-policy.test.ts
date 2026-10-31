import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
test('both password inputs allow eight characters and do not require special symbols',async()=>{const ui=await fs.readFile(new URL('../web/src/pages/SettingsPage.tsx',import.meta.url),'utf8');assert(!ui.includes('minLength={12}'));assert.equal((ui.match(/minLength=\{8\}/g)??[]).length,2);assert(ui.includes('至少 8 位'));});

test('setup form allows eight character passwords and uses password confirmation',async()=>{
 const ui=await fs.readFile(new URL('../web/src/InitialSetup.tsx',import.meta.url),'utf8');
 assert.equal((ui.match(/minLength=\{8\}/g)??[]).length,2);
 assert(ui.includes('name="confirmPassword"'));assert(ui.includes('autoComplete="new-password"'));
});
