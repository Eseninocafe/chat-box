// Pulls the real tally/tier code out of script.js and exercises it. Fails loudly if
// the thresholds or the multi-key merge ever drift.
const fs = require('fs'), assert = require('assert');
const src = fs.readFileSync('script.js', 'utf8');
const grab = (re, what) => { const m = src.match(re); assert(m, 'not found in script.js: ' + what); return m[0]; };
eval(
  grab(/const twitchBitsMap = new Map\(\);/, 'twitchBitsMap') +
  grab(/const BIT_TIERS = \[.*\];/, 'BIT_TIERS') +
  grab(/function AddTwitchBits[\s\S]*?\n}/, 'AddTwitchBits') +
  grab(/function LookupTwitchBits[\s\S]*?\n}/, 'LookupTwitchBits') +
  grab(/function BitTierColor[\s\S]*?\n}/, 'BitTierColor')
);

// tier boundaries, both sides of every edge
assert.strictEqual(BitTierColor(0), null, 'no badge below 1 bit');
for (const [bits, want] of [[1,'gray'],[99,'gray'],[100,'purple'],[999,'purple'],
                            [1000,'green'],[4999,'green'],[5000,'blue'],[9999,'blue'],
                            [10000,'red'],[999999,'red']])
  assert.strictEqual(BitTierColor(bits), want, `${bits} bits -> ${want}`);

// accumulates across cheers, and a cheer keyed by login is found again by user id
AddTwitchBits(50, '123', 'someone', 'SomeOne');
assert.strictEqual(BitTierColor(LookupTwitchBits('123')), 'gray');
AddTwitchBits(60, 'someone');                      // cheer payload, login only
assert.strictEqual(LookupTwitchBits('SOMEONE'), 110, 'case-insensitive');
assert.strictEqual(LookupTwitchBits('123'), 110, 'merged back onto the id key');
assert.strictEqual(BitTierColor(LookupTwitchBits('123')), 'purple', '110 crosses into purple');

// junk in, nothing out
AddTwitchBits(0, 'x'); AddTwitchBits(-5, 'x'); AddTwitchBits(undefined, 'x'); AddTwitchBits('nope', 'x');
assert.strictEqual(LookupTwitchBits('x'), 0);

// two aliases that grew apart get merged, not one of them dropped
AddTwitchBits(100, 'idA');            // id only
AddTwitchBits(200, 'loginA');         // login only, looks like a different person
AddTwitchBits(1, 'idA', 'loginA');    // now seen together
assert.strictEqual(LookupTwitchBits('idA'), 301, 'merged both records');
assert.strictEqual(LookupTwitchBits('loginA'), 301, 'both aliases agree');
AddTwitchBits(9699, 'loginA');
assert.strictEqual(BitTierColor(LookupTwitchBits('idA')), 'red', '10000 via the other alias');
assert.strictEqual(LookupTwitchBits(null, undefined, ''), 0, 'no keys -> no badge');

// the official-bits-badge filter: drops Twitch's gem, keeps everything else
eval(grab(/function BadgeIs[\s\S]*?\n}/, 'BadgeIs'));
const IsTwitchBitsBadge = b => BadgeIs(b, 'bits');
for (const b of [{name:'bits', version:'10000', imageUrl:'x'}, {setId:'Bits'}, {name:'BITS'}])
  assert.strictEqual(IsTwitchBitsBadge(b), true, 'should drop ' + JSON.stringify(b));
for (const b of [{name:'moderator'}, {name:'bits-leader'}, {name:'subscriber', version:'bits2'},
                 {imageUrl:'https://cdn/bits/3'}, {}, null, undefined])
  assert.strictEqual(IsTwitchBitsBadge(b), false, 'should keep ' + JSON.stringify(b));

// badge memory: one user's chat badges must be findable by any of their keys
eval([grab(/const twitchBadgeMap = new Map\(\);/, 'twitchBadgeMap'),
      grab(/function RememberTwitchBadges[\s\S]*?\n}/, 'RememberTwitchBadges'),
      grab(/function LookupTwitchBadges[\s\S]*?\n}/, 'LookupTwitchBadges')].join('\n'));
const worn = [{name:'moderator', imageUrl:'m'}, {name:'bits', imageUrl:'b'}];
RememberTwitchBadges(worn, '99', 'someone', 'SomeOne');
assert.deepStrictEqual(LookupTwitchBadges('99'), worn, 'found by id');
assert.deepStrictEqual(LookupTwitchBadges('SOMEONE'), worn, 'case-insensitive');
assert.deepStrictEqual(LookupTwitchBadges('nobody'), [], 'unknown user -> no badges');
assert.deepStrictEqual(LookupTwitchBadges(null, undefined, ''), [], 'no keys -> no badges');
RememberTwitchBadges([], 'x'); RememberTwitchBadges(null, 'x');
assert.deepStrictEqual(LookupTwitchBadges('x'), [], 'empty payload is not remembered');

// the broadcaster swap matches the same way, and nothing else is mistaken for it
assert.strictEqual(BadgeIs({name:'broadcaster', imageUrl:'x'}, 'broadcaster'), true);
assert.strictEqual(BadgeIs({name:'moderator', imageUrl:'broadcaster.png'}, 'broadcaster'), false);

// one colour pipeline: chat lines, event cards and featured messages all resolve a
// username through usernameChatColor, so the same name is the same colour everywhere.
// (const declarations do not leak out of eval, so the floor is read back explicitly.)
const LUM_MIN_OUTLINE = eval([
      'const contrastOutline = true;',
      grab(/const USERNAME_LUM_MAX = [^\n]*/, 'LUM_MAX'),
      grab(/const USERNAME_LUM_MAX_OUTLINE = [^\n]*/, 'LUM_MAX_OUTLINE'),
      grab(/const USERNAME_LUM_MIN = [^\n]*/, 'LUM_MIN'),
      grab(/const USERNAME_LUM_MIN_OUTLINE = [^\n]*/, 'LUM_MIN_OUTLINE'),
      grab(/const USERNAME_INK_KEEP = [^\n]*/, 'INK_KEEP'),
      grab(/const USERNAME_INK_SCALE = [^\n]*/, 'INK_SCALE'),
      grab(/function usernameInk[\s\S]*?\n}/, 'usernameInk'),
      grab(/function tameUsernameColor[\s\S]*?\n}/, 'tameUsernameColor'),
      grab(/function usernameChatColor[\s\S]*?\n}/, 'usernameChatColor'),
      'USERNAME_LUM_MIN_OUTLINE'].join('\n'));

assert.strictEqual(LUM_MIN_OUTLINE, 0.05, 'dark floor lowered');
assert.strictEqual(usernameChatColor('#A644FF'), '#A644FF', 'mid-luminance colour passes through');
assert.strictEqual(usernameChatColor('#9146FF'), '#9146FF', 'a chosen colour is never rewritten');
assert.ok(usernameChatColor('#000000') !== '#000000', 'pure black is lifted to the floor');
assert.ok(usernameChatColor('#FFFFFF') !== '#FFFFFF', 'pure white is capped');

// outline ink: the name's own colour taken right down, from either form the colour
// pipeline can hand over (#rrggbb passed through, or the rgb() a tamed colour becomes)
assert.strictEqual(usernameInk('#FFFFFF'), 'rgb(64, 64, 64)', 'hex form');
assert.strictEqual(usernameInk('#fff'), 'rgb(64, 64, 64)', 'short hex');
assert.strictEqual(usernameInk('rgb(255, 127, 80)'), 'rgb(64, 32, 20)', 'rgb form');
assert.strictEqual(usernameInk('#000000'), 'rgb(0, 0, 0)', 'black stays black');
for (const bad of [null, undefined, 42, '', 'chartreuse', 'var(--x)'])
  assert.strictEqual(usernameInk(bad), null, 'unparseable -> null, caller keeps the global ink');
// ink must always be strictly darker than the name it outlines, or it stops separating
for (const c of ['#FF7F50','#0000FF','#00FF7F','#8A2BE2']) {
  const m = usernameInk(c).match(/\d+/g).map(Number);
  const src = [1,3,5].map(i => parseInt(c.slice(i, i+2),16));
  assert.ok(m.every((v,i) => v <= src[i]), 'ink darker than ' + c);
}
// no bare tameUsernameColor callers left: that was the chat/card mismatch
const bare = src.split('\n').filter(l => /tameUsernameColor\(/.test(l)
  && !/function tameUsernameColor/.test(l) && !/USERNAME_LUM_/.test(l) && !/^\s*\/\//.test(l));
assert.strictEqual(bare.length, 0, 'event cards must not call tameUsernameColor directly:\n' + bare.join('\n'));

console.log('bit badge: all checks passed');
