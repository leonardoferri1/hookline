import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyAddress,
  isBlockedAddress,
} from '../../src/modules/dispatch/infrastructure/address-policy';

test('classifies IPv4 ranges a webhook must never reach', () => {
  const cases: Array<[string, string]> = [
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.254', 'private'],
    ['192.168.1.10', 'private'],
    // The cloud metadata endpoint, the most abused SSRF target.
    ['169.254.169.254', 'link-local'],
    ['100.64.0.1', 'shared'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
  ];
  for (const [address, expected] of cases)
    assert.equal(classifyAddress(address), expected, address);
});

test('treats genuinely routable IPv4 addresses as public', () => {
  for (const address of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '172.15.0.1', '192.167.1.1'])
    assert.equal(classifyAddress(address), 'public', address);
});

test('classifies IPv6 ranges, including forms that tunnel to IPv4', () => {
  const cases: Array<[string, string]> = [
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fe8a::1', 'link-local'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'reserved'],
    ['2606:4700:4700::1111', 'public'],
    // An IPv4-mapped address reaches the same host, so it inherits the IPv4 verdict.
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:169.254.169.254', 'link-local'],
    ['::ffff:8.8.8.8', 'public'],
  ];
  for (const [address, expected] of cases)
    assert.equal(classifyAddress(address), expected, address);
});

test('refuses anything that is not a usable address literal', () => {
  for (const value of ['example.test', '', 'not-an-ip', '999.1.1.1'])
    assert.equal(isBlockedAddress(value), true, value);
});

test('blocks every non-public class', () => {
  assert.equal(isBlockedAddress('127.0.0.1'), true);
  assert.equal(isBlockedAddress('169.254.169.254'), true);
  assert.equal(isBlockedAddress('203.0.113.9'), false);
});
