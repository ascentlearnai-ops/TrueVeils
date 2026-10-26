'use strict';

const { performance } = require('node:perf_hooks');
const { check } = require('./validation');

function createTokenBudget(limits, now = () => performance.now()) {
  const byIp = new Map();
  let recent = [];
  let lifetime = 0;
  return {
    consume(ip) {
      const time = now();
      recent = recent.filter(at => time - at < limits.tokenBudgetWindowMs);
      for (const [address, times] of byIp) {
        const active = times.filter(at => time - at < limits.tokenBudgetWindowMs);
        if (active.length) byIp.set(address, active);
        else byIp.delete(address);
      }
      const times = byIp.get(ip) || [];
      check(lifetime < limits.maxTokensLifetime, 'Relay lifetime token budget exhausted.');
      check(recent.length < limits.maxTokensPerServerWindow, 'Relay token budget throttled.');
      check(times.length < limits.maxTokensPerIpWindow, 'IP token budget throttled.');
      // Reserve synchronously before provider IO. Failures and cancellation cannot refund spend.
      lifetime++;
      recent.push(time);
      times.push(time);
      byIp.set(ip, times);
    }
  };
}

module.exports = { createTokenBudget };
