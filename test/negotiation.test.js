'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  acceptsCounter,
  defaultMinimum,
  evaluateOffer,
  parseOffer,
} = require('../negotiation');

test('recognizes acceptance of the agent previous counter', () => {
  assert.equal(acceptsCounter('deal'), true);
  assert.equal(acceptsCounter('Sounds good!'), true);
  assert.equal(acceptsCounter('maybe later'), false);
});

test('parses common buyer offer messages', () => {
  assert.equal(parseOffer('I can offer £18.50'), 18.5);
  assert.equal(parseOffer('would you take 20?'), 20);
  assert.equal(parseOffer('17 quid'), 17);
  assert.equal(parseOffer('22?'), 22);
  assert.equal(parseOffer('Can you meet in London?'), null);
});

test('defaults the private acceptance minimum to 90% of ask', () => {
  assert.equal(defaultMinimum(22), 19.8);
});

test('accepts an offer at the minimum', () => {
  assert.deepEqual(evaluateOffer({ askingPrice: 30, minimumPrice: 25, offer: 25 }), {
    outcome: 'accept',
    offer: 25,
    askingPrice: 30,
    minimumPrice: 25,
  });
});

test('counters below-minimum offers without revealing the floor', () => {
  assert.deepEqual(evaluateOffer({ askingPrice: 30, minimumPrice: 25, offer: 20 }), {
    outcome: 'counter',
    offer: 20,
    counter: 25,
    askingPrice: 30,
    minimumPrice: 25,
  });
});
