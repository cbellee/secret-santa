import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameKey, nameSchema, priceToCents, wishlistSchema } from './domain.ts';

const gift = (url = 'https://shop.example/gift', priceCents = 5000) => ({ url, priceCents, description: '' });

test('budget is per gift: three $50 options are valid, but $50.01 is not', () => {
  assert.equal(wishlistSchema.safeParse([gift('https://a.example'), gift('https://b.example'), gift('https://c.example')]).success, true);
  for (const price of [0, -1, 5001, 49.5, NaN]) assert.equal(wishlistSchema.safeParse([gift(undefined, price)]).success, false);
  assert.equal(priceToCents('49.99'), 4999);
  assert.equal(priceToCents('50'), 5000);
  assert.equal(Number.isNaN(priceToCents('4.999')), true);
  assert.equal(Number.isNaN(priceToCents('')), true);
});

test('wishlists allow zero to three distinct links and preserve preference order', () => {
  assert.deepEqual(wishlistSchema.parse([]), []);
  const gifts = [gift('https://b.example'), gift('https://a.example')];
  assert.deepEqual(wishlistSchema.parse(gifts).map(item => item.url), ['https://b.example/', 'https://a.example/']);
  assert.equal(wishlistSchema.safeParse([...gifts, gift('https://c.example'), gift('https://d.example')]).success, false);
  assert.equal(wishlistSchema.safeParse([gift('https://SHOP.example:443/a#one'), gift('https://shop.example/a#two')]).success, false);
});

test('gift cards may leave the link blank; ordinary gifts may not', () => {
  const card = { url: '', priceCents: 5000, description: 'Bunnings', giftCard: true };
  assert.equal(wishlistSchema.safeParse([card, { ...card, description: 'JB Hi-Fi' }]).success, true);
  assert.equal(wishlistSchema.safeParse([{ ...card, giftCard: false }]).success, false);
  assert.equal(wishlistSchema.safeParse([{ ...card, priceCents: 5001 }]).success, false);
  assert.equal(wishlistSchema.parse([{ ...card, url: 'https://shop.example/cards' }])[0]?.url, 'https://shop.example/cards');
  assert.equal(wishlistSchema.safeParse([{ ...card, url: 'javascript:alert(1)' }]).success, false);
  assert.equal(wishlistSchema.parse([gift()])[0]?.giftCard, false);
});

test('reject unsafe links, excessive details and blank names', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@shop.example', 'not-a-link']) {
    assert.equal(wishlistSchema.safeParse([gift(url)]).success, false);
  }
  assert.equal(wishlistSchema.safeParse([{ ...gift(), description: 'x'.repeat(301) }]).success, false);
  assert.equal(nameSchema.safeParse('   ').success, false);
  assert.equal(nameSchema.parse('  Chris  '), 'Chris');
});

test('names reject hidden characters and compare case- and width-insensitively', () => {
  for (const name of ['Ch\u200Bris', '\u202Esirhc', 'Chris\u0000', 'Ch\u2028ris']) assert.equal(nameSchema.safeParse(name).success, false);
  assert.equal(nameSchema.parse('Ｃｈｒｉｓ'), 'Chris');
  assert.equal(nameKey('CHRIS'), nameKey(' chris '));
  assert.equal(nameKey('Mary  Jane'), nameKey('mary jane'));
  assert.notEqual(nameKey('Chris'), nameKey('Chriss'));
});
