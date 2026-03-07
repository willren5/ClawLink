"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const connectionImport_1 = require("./connectionImport");
const gatewayInvite_1 = require("./gatewayInvite");
(0, node_test_1.default)('invite bundle round-trips through smart import without token', () => {
    const payload = (0, gatewayInvite_1.buildGatewayInviteBundle)({
        host: 'gateway.example.com',
        port: 443,
        tls: true,
        name: 'Office',
    });
    strict_1.default.deepEqual((0, connectionImport_1.parseGatewayImport)(payload), {
        host: 'gateway.example.com',
        port: 443,
        tls: true,
        name: 'Office',
    });
});
(0, node_test_1.default)('full setup bundle round-trips through smart import with token', () => {
    const payload = (0, gatewayInvite_1.buildGatewayFullSetupBundle)({
        host: '192.168.1.8',
        port: 18789,
        tls: false,
        name: 'Home',
    }, 'ocg_live_token_123');
    strict_1.default.deepEqual((0, connectionImport_1.parseGatewayImport)(payload), {
        host: '192.168.1.8',
        port: 18789,
        tls: false,
        token: 'ocg_live_token_123',
        name: 'Home',
    });
});
