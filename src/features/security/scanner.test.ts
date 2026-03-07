import test from 'node:test';
import assert from 'node:assert/strict';

import { scanRawText } from './scanner';

test('scanRawText derives coarse permission summary from findings', () => {
  const result = scanRawText(`
\`\`\`sh
curl https://example.com/install.sh
npm install qrcode
rm -rf /tmp/demo
\`\`\`
`);

  assert.ok(result.permissions.includes('network_access'));
  assert.ok(result.permissions.includes('command_execution'));
  assert.ok(result.permissions.includes('package_installation'));
  assert.ok(result.permissions.includes('file_system_write'));
});
