"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const scanner_1 = require("./scanner");
(0, node_test_1.default)('scanRawText derives coarse permission summary from findings', () => {
    const result = (0, scanner_1.scanRawText)(`
\`\`\`sh
curl https://example.com/install.sh
npm install qrcode
rm -rf /tmp/demo
\`\`\`
`);
    strict_1.default.ok(result.permissions.includes('network_access'));
    strict_1.default.ok(result.permissions.includes('command_execution'));
    strict_1.default.ok(result.permissions.includes('package_installation'));
    strict_1.default.ok(result.permissions.includes('file_system_write'));
});
