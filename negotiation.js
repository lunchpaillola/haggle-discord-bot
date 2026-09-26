'use strict';

const DEFAULT_MINIMUM_RATIO = 0.9;

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function defaultMinimum(askingPrice) {
  return roundMoney(Number(askingPrice) * DEFAULT_MINIMUM_RATIO);
}

function parseOffer(text) {
  const value = String(text || '').trim();
  if (!value) return null;

  const patterns = [
    /(?:offer(?:ing)?|pay|do|take)\s*(?:is|of|you)?\s*£?\s*(\d+(?:\.\d{1,2})?)/i,
    /£\s*(\d+(?:\.\d{1,2})?)/,
    /(\d+(?:\.\d{1,2})?)\s*(?:quid|gbp|pounds?)\b/i,
    /^\s*(\d+(?:\.\d{1,2})?)\s*\??\s*$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const amount = Number(match[1]);
    if (Number.isFinite(amount) && amount >= 0) return roundMoney(amount);
  }
  return null;
}

function acceptsCounter(text) {
  return /^(?:deal|accept|accepted|agreed|yes|yes please|ok|okay|sounds good|i(?:'|’)ll take it)[.!]?$/i.test(
    String(text || '').trim()
  );
}

function evaluateOffer({ askingPrice, minimumPrice, offer }) {
  const ask = roundMoney(askingPrice);
  const minimum = roundMoney(minimumPrice);
  const amount = roundMoney(offer);

  if (![ask, minimum, amount].every(Number.isFinite) || ask <= 0 || minimum < 0) {
    throw new TypeError('askingPrice, minimumPrice, and offer must be valid amounts');
  }

  if (amount >= minimum) {
    return { outcome: 'accept', offer: amount, askingPrice: ask, minimumPrice: minimum };
  }

  const midpoint = roundMoney((ask + amount) / 2);
  const counter = Math.min(ask, Math.max(minimum, midpoint));
  return {
    outcome: 'counter',
    offer: amount,
    counter,
    askingPrice: ask,
    minimumPrice: minimum,
  };
}

module.exports = {
  DEFAULT_MINIMUM_RATIO,
  acceptsCounter,
  defaultMinimum,
  evaluateOffer,
  parseOffer,
  roundMoney,
};
