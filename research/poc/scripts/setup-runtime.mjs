import assert from 'node:assert/strict';
import { isInstalled, setup } from 'microsandbox';

if (!isInstalled()) await setup().version('0.5.10').install();
assert.equal(isInstalled(), true, 'Eve requires microsandbox.isInstalled() to pass');
console.log('Pinned microsandbox runtime installation verified.');
