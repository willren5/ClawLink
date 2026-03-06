"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const connectionImport_1 = require("./connectionImport");
(0, node_test_1.default)('parses bootstrap terminal output into gateway fields', () => {
    const result = (0, connectionImport_1.parseGatewayImport)(`
    Gateway Host: 192.168.1.8
    Port: 18789
    API Token: ocg_live_token_123
  `);
    strict_1.default.deepEqual(result, {
        host: '192.168.1.8',
        port: 18789,
        token: 'ocg_live_token_123',
    });
});
(0, node_test_1.default)('parses clawlink connect deep links', () => {
    const result = (0, connectionImport_1.parseGatewayImport)('clawlink://connect?host=gateway.local&port=443&token=abc123&tls=true&name=Office');
    strict_1.default.deepEqual(result, {
        host: 'gateway.local',
        port: 443,
        token: 'abc123',
        tls: true,
        name: 'Office',
    });
});
(0, node_test_1.default)('parses JSON import payloads', () => {
    const result = (0, connectionImport_1.parseGatewayImport)(JSON.stringify({
        uri: 'https://gateway.example.com:8443',
        token: 'json-token',
        name: 'Prod',
    }));
    strict_1.default.deepEqual(result, {
        host: 'gateway.example.com',
        port: 8443,
        tls: true,
        token: 'json-token',
        name: 'Prod',
    });
});
