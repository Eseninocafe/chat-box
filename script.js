const dpr = window.devicePixelRatio || 1;
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

// Streamer.bot's websocket. It has no setting any more; an address or port from an
// older URL is still honoured, so existing browser sources keep connecting.
const sbServerAddress = urlParams.get("address") || "127.0.0.1";
const sbServerPort = urlParams.get("port") || "8080";

/* ── Layout ─────────────────────────────────────────────────────────────────
   Nothing scales: the chat is drawn at its design size and laid out to fill the
   browser source. With ?receipt=true it sits on the receipt, which is its
   background: a fixed 596px wide, black text, no contrast outline. Without it the
   background is transparent, the text is white with the outline, there's 32px
   clear all round, and a source 533px wide or less gets the compact sizes.
   ?preview is the settings page's preview (never in a copied URL). */
const receipt = GetBooleanParam("receipt", false);
const previewMode = urlParams.has("preview");
const contrastOutline = !receipt;
const COMPACT_MAX_W = 533;
let compact = !receipt && window.innerWidth <= COMPACT_MAX_W;
document.body.classList.toggle('receipt', receipt);
document.body.classList.toggle('compact', compact);
if (contrastOutline) document.body.classList.add('contrast-outline');

// Per-size artwork: assets/icons/normal and /compact (the compact ones are redrawn,
// not scaled). Icons carry data-icon, so a source resized across the breakpoint
// swaps them in place.
const iconSrc = (name) => `assets/icons/${compact ? 'compact' : 'normal'}/${name}.svg`;
const iconImg = (name, cls = '') => `<img src="${iconSrc(name)}" data-icon="${name}" class="${cls}">`;
function ApplyCompact() {
	const c = !receipt && window.innerWidth <= COMPACT_MAX_W;
	if (c === compact) return;
	compact = c;
	document.body.classList.toggle('compact', compact);
	document.querySelectorAll('img[data-icon]').forEach(img => { img.src = iconSrc(img.dataset.icon); });
}
window.addEventListener('resize', ApplyCompact);
// A resized source reflows every line, so a title or name that fitted may now be
// clipped (or the other way round): measure the scrolling windows again once it settles.
let remeasureTimer = 0;
window.addEventListener('resize', () => {
	clearTimeout(remeasureTimer);
	remeasureTimer = setTimeout(() => document.querySelectorAll('#messageList li.show').forEach(startCardMarquees), 150);
});

const showPlatform = GetBooleanParam("showPlatform", true);
const showAvatar = GetBooleanParam("showAvatar", true);
const showTimestamps = GetBooleanParam("showTimestamps", true);
const showBadges = GetBooleanParam("showBadges", true);
const showUsername = GetBooleanParam("showUsername", true);
/* ── Boil feel: two separate knobs ──────────────────────────────────────────
   boilFps  — how OFTEN the border is redrawn.
   boilStep — how DIFFERENT each redraw is from the one before it.

   These used to be the same knob, which is why the line looked like it was
   moving rather than being redrawn. The noise clock was wall time, so between
   two drawn frames the field advanced by noiseTimeScale/boilFps ≈ 0.04 — and 3D
   simplex decorrelates over roughly 1.0 of z, so each "new" drawing was a 4%
   nudge of the last one. Lowering boilFps alone just made that same smooth drift
   chug; it never got sketchier, because the shapes were still nearly identical.

   Driving the noise off the drawing COUNT instead of the clock separates them: a
   step of about 0.5 gives a fully independent drawing every time. Measured on
   these cards, 0.042 moves each point 0.14px between drawings; 0.178 moves it
   about 0.6px, roughly half of the distance two unrelated drawings sit apart —
   enough that each one reads as redrawn, close enough that they still look like
   the same hand drew them. Past ~0.5 there is nothing left to gain.

   Time is quantised to the drawing grid, so every boiling outline in the scene
   changes on the same beat — the way everything on an animator's sheet updates
   on the same frame — and the same expression gives both the noise coordinate
   and the redraw throttle: if the index has not moved, there is nothing new to
   draw.

   Shape is untouched: noiseAmp stays 1.5, so the card silhouette is the same as
   before. This changes how the line is *redrawn*, not how far it wanders.
   ?boilAmp=N raises the wander if you want it rougher still.

   To get the old smooth drift back exactly: ?boilFps=24&boilStep=0.042           */
const boilFps = Math.max(1, Math.min(60, GetIntParam("boilFps") || 7));
const boilStep = Math.max(0, Math.min(4, GetFloatParam("boilStep") ?? 0.178));

// Chat text is the receipt's ink, or white with the outline over the stream. The
// size follows normal / compact (22 / 18px); the outline is measured off it once.
const fontColor = receipt ? "#000000" : "#ffffff";
const fontSize = compact ? 18 : 22;

// Messages starting with "!" are always hidden; ?excludeCommands=false still turns
// that off. The chatters list (StreamElements, Streamlabs) is hidden entirely.
const excludeCommands = GetBooleanParam("excludeCommands", true);
const ignoreChatters = urlParams.get("ignoreChatters") ?? "StreamElements,Streamlabs";
const imageEmbedPermissionLevel = GetIntParam("imageEmbedPermissionLevel") || 20;

const showTwitchMessages = GetBooleanParam("showTwitchMessages", true);
const showTwitchAnnouncements = GetBooleanParam("showTwitchAnnouncements", true);
const showTwitchSubs = GetBooleanParam("showTwitchSubs", true);
const showTwitchRaids = GetBooleanParam("showTwitchRaids", true);
const showTwitchFollows = GetBooleanParam("showTwitchFollows", true);
const showTwitchCheers = GetBooleanParam("showTwitchCheers", true);
const showTwitchChannelPoints = GetBooleanParam("showTwitchChannelPoints", true);
const showTwitchWatchStreaks = GetBooleanParam("showTwitchWatchStreaks", true);

// Stinger sync: when ON, a Twitch sub/resub/gift/bomb or cheer fades the chat out,
// lets the separate stinger browser source play, then fades the chat back in and
// only THEN shows the alert card. Default OFF so existing links (no ?stingers) are
// unchanged — the settings page only appends ?stingers=true when it's enabled.
// Never with the receipt (the settings page hides the option then, too).
const stingersEnabled = GetBooleanParam("stingers", false) && !receipt;

const showYouTubeMessages = GetBooleanParam("showYouTubeMessages", true);
const showYouTubeSuperChats = GetBooleanParam("showYouTubeSuperChats", true);
const showYouTubeMemberships = GetBooleanParam("showYouTubeMemberships", true);

const showStreamlabsDonations = GetBooleanParam("showStreamlabsDonations", true);
const showStreamElementsTips = GetBooleanParam("showStreamElementsTips", true);

/* ── Reply arrow + line ──────────────────────────────────────────────────────
   Drawn as an inline SVG per glyph rather than a masked background, because the
   mask was a latent bug: Chrome treats every file:// document as its own opaque
   origin — so on a file:// browser source a mask from a file is cross-origin,
   computes to transparent, and the two glyphs vanish completely. An inline data:
   URI has no origin to fail.

   Each icon is a single stroked path (the paths in assets/icons/<size>/reply-*.svg), so
   with the outline on it is simply stroked twice: wide in the outline colour
   underneath, then at its true width in the text colour. Built for both sizes, so a
   source resized across the compact breakpoint picks the other pair up in CSS.
   The viewBox is padded by 3 on each side (::before is inset -3px to match) so the
   wide stroke has room without moving the glyph. */
{
	const _rHr = contrastOutline ? Math.max(0.5, 0.05 * fontSize) : 0;
	const _rSvg = (w, h, sw, d) => {
		const ow = (sw + 2 * _rHr).toFixed(2);
		return 'url("data:image/svg+xml,' + encodeURIComponent(
			`<svg xmlns='http://www.w3.org/2000/svg' width='${w + 6}' height='${h + 6}' viewBox='-3 -3 ${w + 6} ${h + 6}'>` +
			(_rHr > 0
				? `<path d='${d}' fill='none' stroke='#000000' stroke-width='${ow}' stroke-linecap='round' stroke-linejoin='round'/>`
				: '') +
			`<path d='${d}' fill='none' stroke='${fontColor}' stroke-width='${sw}' stroke-linecap='round' stroke-linejoin='round'/>` +
			`</svg>`) + '")';
	};
	const root = document.documentElement.style;
	root.setProperty('--o-reply-arrow', _rSvg(36, 28, 3,
		'M18 6V9.48872C18 12.2857 19.7143 14.0301 22.5715 14.0301L29.8974 14.0301M26.5143 10.0602L29.8974 14.0301L26.5143 18'));
	root.setProperty('--o-reply-line', _rSvg(36, 28, 3, 'M18 6L18 22'));
	root.setProperty('--o-reply-arrow-compact', _rSvg(28, 22, 2.5,
		'M14 3V6.48872C14 9.28571 15.7143 11.0301 18.5715 11.0301L25.8974 11.0301M22.5143 7.06015L25.8974 11.0301L22.5143 15'));
	root.setProperty('--o-reply-line-compact', _rSvg(28, 22, 2.5, 'M14 4L14 18'));
}

/* The extrude chain, still carrying its unresolved var(--o-colour).

   A custom property resolves the var()s inside its OWN value at the element where it
   is declared — so the copy on :root bakes in root's black before it ever inherits.
   Re-declaring this same string on a username element makes it resolve against that
   element's --o-colour instead, which is how a name gets a 3D in its own ink. */
let _oTextExtrudeTemplate = '';

if (contrastOutline) {

	/* ══ Contrast outline + 3D extrude ═══════════════════════════════════════════
	   Behind ?contrastOutline, and chat messages only; the bordered cards have their
	   own solid backgrounds and are untouched.

	   Four techniques, because four different kinds of shape:
	     text / usernames   16-copy text-shadow ring, then a filter extrude
	     reply arrow + line  one inline SVG drawing the path twice (wide dark, then light)
	     badges + platform   one SVG filter: blur SourceAlpha, threshold it, merge
	     avatars             box-shadow rings (a disc IS its border box)

	   Two rasteriser facts drive the whole design:

	   1. Chained drop-shadow offsets are FLOORED to whole pixels. A fractional per-pass
	      offset therefore contributes nothing at all, and 1.01px through 1.99px all
	      contribute exactly one pixel. So the extrude is built as N passes of exactly
	      1px and the DEPTH is varied by changing N, not by scaling the offset.
	   2. Chained passes compose as a Minkowski sum, so ±1px in x and y makes a SQUARE
	      dilation whose corner pixel is a tooth on any 45° contour — and each extrude
	      pass then carries that tooth another pixel down. This is only a problem for a
	      RING; the extrude itself runs straight down (dirX 0), and a Minkowski sum with
	      a vertical segment is just a vertical sweep, so it stays exact. Rings are
	      therefore built some other way per shape — never by chaining.               */
	const OUTLINE = {
		hrEm:     0.05,   // outline thickness, em
		depthEm:  0.13,   // 3D extrude depth, em
		imgScale: 1,      // extrude multiplier for badges / platform icons
		avScale:  0.9,    // ...and for avatars: a full-bleed disc shows its whole
		                  //    extrude as one crescent and reads deeper than it measures
		dirX: 0, dirY: 1, // straight down
		colour: '#000000',
	};

	const _oFs    = fontSize;
	const _oHr    = Math.max(0.5, OUTLINE.hrEm * _oFs);
	const _oDepth = OUTLINE.depthEm * _oFs;

	// N passes of exactly one screen pixel each along the direction vector. Built once at
	// load, so a source resized while live needs a refresh to rebuild it.
	function BuildExtrudeFilter(totalPx) {
		// Step in whole pixels (nothing is zoomed, so a CSS px is a screen px).
		const unit = 1, n = Math.round(totalPx);
		if (n < 1) return 'none';
		const out = [];
		// var() rather than the literal: the colour is resolved on the element that
		// uses the filter, so a username carrying its own --o-colour gets a 3D in
		// its own ink while everything else falls back to the global one.
		for (let k = 0; k < n; k++)
			out.push(`drop-shadow(${(OUTLINE.dirX * unit).toFixed(4)}px ${(OUTLINE.dirY * unit).toFixed(4)}px 0 var(--o-colour, ${OUTLINE.colour}))`);
		return out.join(' ');
	}

	const _oRoot = document.documentElement.style;
	_oRoot.setProperty('--o-hr', _oHr + 'px');
	_oRoot.setProperty('--o-colour', OUTLINE.colour);
	_oTextExtrudeTemplate = BuildExtrudeFilter(_oDepth);
	_oRoot.setProperty('--o-text-extrude', _oTextExtrudeTemplate);
	{
		// avatar: a ring plus three offset rings, unioned. box-shadows are all drawn from
		// the element rather than chained, so they keep sub-pixel precision.
		const step = _oDepth * OUTLINE.avScale / 3, dx = OUTLINE.dirX, dy = OUTLINE.dirY;
		const rings = [1, 2, 3].map(k =>
			`${(dx * step * k).toFixed(3)}px ${(dy * step * k).toFixed(3)}px 0 var(--o-hr) ${OUTLINE.colour}`);
		_oRoot.setProperty('--o-avatar-shadow', `0 0 0 var(--o-hr) ${OUTLINE.colour}, ` + rings.join(', '));
	}

	/* Badges and platform icons are <img>: no text-shadow, no SVG stroke, and a
	   chained drop-shadow ring dilates into a SQUARE. This used to be solved by
	   painting the icon 52 times under mask-composite:add — a union of offset copies.
	   It worked, but a union of COPIES is a polygon approximation of a circle, and at
	   badge size the individual copies read as lumps along the contour; alpha
	   thresholding, a layer budget and a CORS pixel read were all scaffolding around
	   that one idea.

	   feGaussianBlur on SourceAlpha is a distance field, so thresholding the blur at a
	   fixed alpha gives a TRUE circular dilation — one exact contour instead of 52
	   samples of one, and the corner radius follows the corner for free. Threshold
	   level p sits at distance sigma * sqrt(2) * erfc-inverse(2p) outside the edge;
	   at p = 0.15 that is sigma * 1.0365, so sigma = r / 1.0365 puts the outline
	   exactly where the ring used to be. The ramp is deliberately not a hard step —
	   its width is the antialiasing.

	   The extrude stays a chained drop-shadow. Chaining is only a problem because it
	   composes as a Minkowski sum, and a sum with a purely VERTICAL segment is just a
	   vertical sweep — the 45-degree tooth needs a diagonal to appear, and dirX is 0.

	   Being a filter rather than a mask, this also needs no second fetch of the icon,
	   so it survives a tainted canvas and works on file:// — the two cases the mask
	   path had to carve out. */
	{
		const P = 0.15;                          // threshold level -> dilation distance
		const sigma = _oHr / 1.0365;
		const slope = 12, intercept = 0.5 - slope * P;
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
		svg.setAttribute('aria-hidden', 'true');
		svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
		// The region has to hold the outline plus the extrude; 70% of an icon box is
		// several times the ~3px reach, and a bigger region only costs fill rate.
		svg.innerHTML =
			`<filter id="o-icon-outline" x="-70%" y="-70%" width="240%" height="240%" ` +
			`color-interpolation-filters="sRGB">` +
			`<feGaussianBlur in="SourceAlpha" stdDeviation="${sigma.toFixed(3)}"/>` +
			`<feComponentTransfer result="o-ring">` +
			`<feFuncA type="linear" slope="${slope}" intercept="${intercept.toFixed(3)}"/>` +
			`</feComponentTransfer>` +
			// feFlood keeps OUTLINE.colour meaningful — SourceAlpha alone is always black.
			`<feFlood flood-color="${OUTLINE.colour}"/>` +
			`<feComposite in2="o-ring" operator="in" result="o-out"/>` +
			`<feMerge><feMergeNode in="o-out"/><feMergeNode in="SourceGraphic"/></feMerge>` +
			`</filter>`;
		document.body.appendChild(svg);

		const ex = BuildExtrudeFilter(_oDepth * OUTLINE.imgScale);
		_oRoot.setProperty('--o-img-outline', 'url(#o-icon-outline)' + (ex === 'none' ? '' : ' ' + ex));
	}

}   // end if (contrastOutline)


const mainContainer = document.getElementById('mainContainer');
const ignoreUserList = ignoreChatters.split(',').map(item => item.trim().toLowerCase());
const messageList = document.getElementById('messageList');

const client = new StreamerbotClient({
	host: sbServerAddress,
	port: sbServerPort,
	onConnect: () => SetConnectionStatus(true),
	onDisconnect: () => SetConnectionStatus(false),
});

client.on('Twitch.ChatMessage', (data) => TwitchChatMessage(data.data));
client.on('Twitch.ChatMessageDeleted', (data) => TwitchChatMessageDeleted(data.data));
client.on('Twitch.UserBanned', (data) => TwitchUserBanned(data.data));
client.on('Twitch.ChatCleared', (data) => TwitchChatCleared(data.data));
client.on('Twitch.Sub', (data) => TwitchSub(data.data));
client.on('Twitch.ReSub', (data) => TwitchResub(data.data));
client.on('Twitch.GiftSub', (data) => TwitchGiftSub(data.data));
client.on('Twitch.Raid', (data) => TwitchRaid(data.data));
client.on('Twitch.Announcement', (data) => TwitchAnnouncement(data.data));
client.on('Twitch.Follow', (data) => TwitchFollow(data.data));
client.on('Twitch.Cheer', (data) => TwitchCheer(data.data));
client.on('Twitch.AutomaticRewardRedemption', (data) => TwitchAutomaticRewardRedemption(data.data));
client.on('Twitch.RewardRedemption', (data) => TwitchRewardRedemption(data.data));
client.on('Twitch.WatchStreak', (data) => TwitchWatchStreak(data.data));
client.on('Twitch.UserTimedOut', (data) => TwitchUserBanned(data.data));
client.on('Twitch.SharedChatMessageDeleted', (data) => TwitchChatMessageDeleted(data.data));
client.on('Twitch.SharedChatUserBanned', (data) => TwitchUserBanned(data.data));
client.on('Twitch.SharedChatUserTimedout', (data) => TwitchUserBanned(data.data));

client.on('YouTube.Message', (data) => YouTubeMessage(data.data));
client.on('YouTube.SuperChat', (data) => YouTubeSuperChat(data.data));
client.on('YouTube.NewSponsor', (data) => YouTubeNewSponsor(data.data));
client.on('YouTube.MembershipGift', (data) => YouTubeGiftMembershipReceived(data.data));
client.on('YouTube.NewSubscriber', (data) => YouTubeNewSubscriber(data.data));

client.on('Streamlabs.Donation', (data) => StreamlabsDonation(data.data));
client.on('StreamElements.Tip', (data) => StreamElementsTip(data.data));


const avatarMap = new Map();

// Username / accent color per platform. Used by branded event cards.
const PLATFORM_COLORS = {
	twitch: '#9146FF',
	youtube: '#FF0000',
	streamlabs: '#80F5D2',
	streamelements: '#5599FF',
};
function GetPlatformColor(platform) {
	return PLATFORM_COLORS[platform] || '#9146FF';
}
// Platforms that have an icon in assets/icons/*/platforms/. Others skip the platform badge.
const PLATFORMS_WITH_ICONS = new Set(['twitch', 'youtube']);

// The label at the bottom: NOT CONNECTED until Streamer.bot connects, then CONNECTED
// for a moment before it fades. The settings page's preview has its own "Connected"
// pill, so there the label is dropped and the state is only handed up.
const connectionLabel = document.getElementById('connectionLabel');
if (previewMode) connectionLabel.remove();
let connectionHideTimer = 0;
function SetConnectionStatus(connected) {
	if (window.parent !== window) window.parent.postMessage({ chatbox: connected ? 'connected' : 'disconnected' }, '*');
	clearTimeout(connectionHideTimer);
	connectionLabel.textContent = connected ? 'CONNECTED' : 'NOT CONNECTED';
	connectionLabel.classList.remove('hidden');
	if (connected) connectionHideTimer = setTimeout(() => connectionLabel.classList.add('hidden'), 2000);
}

// Usernames keep their own colour everywhere so cards and chat look identical
// (no background-dependent flipping). We only tame the extremes: a near-white name is
// nudged slightly darker so it stays visible on the white cards, and a near-black name
// is nudged slightly lighter so it stays visible over dark footage. Raise/lower these
// to widen or narrow the "safe" luminance band.
const USERNAME_LUM_MAX = 0.55;         // names brighter than this get darkened down to it
const USERNAME_LUM_MAX_OUTLINE = 0.65; // gentler cap when the outline is on (less darkening)
const USERNAME_LUM_MIN = 0.04;         // names darker than this get lightened up to it
const USERNAME_LUM_MIN_OUTLINE = 0.05; // higher floor when the outline is on (a bit lighter)
const USERNAME_INK_KEEP = 0.91;        // measured: what the tinted ring leaves of the colour
const USERNAME_INK_SCALE = 0.25;       // outline ink = the name's own colour, this much of it
/* The outline ring is painted BEHIND the glyph, so the antialiased edges blend into it
   and the eye integrates a slightly darker colour than the nominal one — at chat size
   more than half the glyph is edge. Measured over the glyph's own coverage (halo
   excluded): a black ring keeps 87.8% of the colour, a 0.25x tinted ring 90.9%.

   The band is about what you SEE, so `keep` folds that loss into the comparison: the
   colour is judged as it lands on screen, not as it arrives. With the outline off it
   is 1 and nothing changes. */
function tameUsernameColor(color, maxLum = USERNAME_LUM_MAX, minLum = USERNAME_LUM_MIN, keep = 1) {
    if (!color || !color.startsWith('#')) return color;
    const parseHex = h => { h = h.replace('#',''); if (h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
    const toLinear = c => { const s=c/255; return s<=0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
    const lum = (r,g,b) => 0.2126*toLinear(r) + 0.7152*toLinear(g) + 0.0722*toLinear(b);
    const [r,g,b] = parseHex(color);
    const seen = (r,g,b) => lum(r*keep, g*keep, b*keep);   // what actually reaches the eye
    const L = seen(r,g,b);
    if (L > maxLum) {
        let f=1.0; while (seen(r*f,g*f,b*f) > maxLum && f>0.05) f-=0.02;
        return `rgb(${Math.round(r*f)}, ${Math.round(g*f)}, ${Math.round(b*f)})`;
    }
    if (L < minLum) {
        let t=0; while (seen(r+(255-r)*t, g+(255-g)*t, b+(255-b)*t) < minLum && t<0.95) t+=0.02;
        return `rgb(${Math.round(r+(255-r)*t)}, ${Math.round(g+(255-g)*t)}, ${Math.round(b+(255-b)*t)})`;
    }
    return color;
}

// THE username colour entry point — chat lines, event cards and featured messages all
// come through here, so a name is the same colour however it reaches the screen. Event
// cards used to call tameUsernameColor() bare, which pinned them to the stricter band
// no matter what, and that is exactly the mismatch this removes.
function usernameChatColor(color) {
    // With the outline on, the dark stroke supplies the contrast, so bright names
    // need less darkening and dark names less lightening. Without it, fall back to
    // the stricter band the overlay used before.
    return contrastOutline
        ? tameUsernameColor(color, USERNAME_LUM_MAX_OUTLINE, USERNAME_LUM_MIN_OUTLINE, USERNAME_INK_KEEP)
        : tameUsernameColor(color, USERNAME_LUM_MAX, USERNAME_LUM_MIN);
}

// Twitch only puts the chatter's chosen colour on chat messages — event payloads
// (channel point redemptions, cheers, subs, raids, follows...) don't carry it, so the
// bordered cards used to fall back to the platform purple. We remember every colour we
// see go past in chat, keyed by user id / login / display name, and reuse it on that
// user's cards. For someone who hasn't chatted yet we ask ivr.fi once (cached, and it
// just falls back to the platform colour if the lookup fails).
const twitchColorMap = new Map();
const twitchColorFetches = new Map();

function RememberTwitchColor(color, ...keys) {
	if (!color || typeof color !== 'string' || !color.startsWith('#')) return;
	keys.forEach(k => { if (k) twitchColorMap.set(String(k).toLowerCase(), color); });
}

function LookupTwitchColor(...keys) {
	for (const k of keys) {
		if (!k) continue;
		const hit = twitchColorMap.get(String(k).toLowerCase());
		if (hit) return hit;
	}
	return null;
}

function FetchTwitchColor(login) {
	if (twitchColorFetches.has(login)) return twitchColorFetches.get(login);
	const p = fetch('https://api.ivr.fi/v2/twitch/user?login=' + encodeURIComponent(login))
		.then(r => r.ok ? r.json() : null)
		.then(j => {
			const hit = Array.isArray(j) ? j[0] : null;
			const color = hit && hit.chatColor;
			if (color) RememberTwitchColor(color, login, hit.id, hit.displayName);
			return color || null;
		})
		.catch(() => null);
	twitchColorFetches.set(login, p);
	return p;
}

// Session cheer tally, for the custom bit badge in chat. Bits are counted for this
// overlay session only — reloading the browser source (every scene restart) puts
// everyone back to zero, which is the point: it reads "cheered this stream". Keyed the
// same way as the colour map so a cheer payload and a chat payload find each other.
const twitchBitsMap = new Map();
// Twitch's own gem tiers, highest first — shared by the badge and the cheer card.
const BIT_TIERS = [[10000, 'red'], [5000, 'blue'], [1000, 'green'], [100, 'purple'], [1, 'gray']];

// Every alias of one chatter points at the SHARED record, so a cheer that only carries
// a login and a chat message that only carries a user id can't drift apart. Seeing a new
// alias merges whatever records it already touched into one.
function AddTwitchBits(bits, ...keys) {
	const n = Math.floor(Number(bits)) || 0;
	if (n <= 0) return;
	const ks = keys.filter(Boolean).map(k => String(k).toLowerCase());
	if (!ks.length) return;
	const rec = { total: n, keys: new Set(ks) };
	new Set(ks.map(k => twitchBitsMap.get(k)).filter(Boolean)).forEach(old => {
		rec.total += old.total;
		old.keys.forEach(k => rec.keys.add(k));
	});
	rec.keys.forEach(k => twitchBitsMap.set(k, rec));
}

function LookupTwitchBits(...keys) {
	for (const k of keys) {
		if (!k) continue;
		const hit = twitchBitsMap.get(String(k).toLowerCase());
		if (hit) return hit.total;
	}
	return 0;
}

// Event payloads (sub, cheer, raid, follow) carry no chat badges — the same gap that
// forced twitchColorMap, so it gets the same treatment: remember what a user wore in
// chat and reuse it on their cards. Someone whose first appearance IS the event has
// nothing remembered yet and simply shows no badges.
const twitchBadgeMap = new Map();

function RememberTwitchBadges(badges, ...keys) {
	if (!Array.isArray(badges) || !badges.length) return;
	keys.forEach(k => { if (k) twitchBadgeMap.set(String(k).toLowerCase(), badges); });
}

function LookupTwitchBadges(...keys) {
	for (const k of keys) {
		if (!k) continue;
		const hit = twitchBadgeMap.get(String(k).toLowerCase());
		if (hit) return hit;
	}
	return [];
}

// Badge art shared by both platforms: YouTube's roles map onto these, and on Twitch the
// broadcaster (Twitch's camera on #2D2D2D) and subscriber (our skull on #2D2D2D) replace
// Twitch's own — for subs that includes any per-month art a channel uploaded. Twitch's
// other badges keep the URL from the payload.
const BADGE_ART = {
	broadcaster: 'assets/icons/badges/broadcaster.png',
	moderator:   'assets/icons/badges/moderator.png',
	vip:         'assets/icons/badges/vip.png',
	subscriber:  'assets/icons/badges/subscriber.svg',
};
const OWN_BADGES = ['broadcaster', 'subscriber'];

// The one place badges become <img>s — chat, cards and both platforms share it so the
// bits filter, the broadcaster swap and the ordering can't drift apart.
function RenderBadgeList(div, badges) {
	if (!div) return;
	div.innerHTML = '';
	(badges || []).filter(b => b && b.imageUrl && !BadgeIs(b, 'bits')).forEach(b => {
		const own = OWN_BADGES.find(id => BadgeIs(b, id));
		const img = new Image(); img.src = own ? BADGE_ART[own] : b.imageUrl; img.classList.add('badge');
		div.appendChild(img);
	});
}

// Twitch's own Bits badge is the SAME gem art and the SAME tier colours as the session
// badge (assets/icons/*/bit-*.svg are that artwork), so a cheerer would carry two near-identical
// gems — Twitch's lifetime one and this stream's. Drop Twitch's and keep ours.
// Matched on the value rather than a field name: Streamer.bot's badge objects are not
// documented here, and the set id ("bits", "broadcaster") is the string whichever key
// carries it. A badge we fail to recognise simply renders as Twitch sent it.
function BadgeIs(b, id) {
	return !!b && Object.values(b).some(v => typeof v === 'string' && v.toLowerCase() === id);
}

// null below 1 bit — no badge for someone who hasn't cheered.
function BitTierColor(bits) {
	const tier = BIT_TIERS.find(([min]) => bits >= min);
	return tier ? tier[1] : null;
}

// Colour for a username on an event card: an explicit override wins, then whatever the
// payload carried, then the remembered/looked-up Twitch chat colour, then the platform.
async function EventUserColor(user, platform, override) {
	if (override) return override;
	if (user?.color) return user.color;
	if (platform === 'twitch') {
		const known = LookupTwitchColor(user?.id, user?.login, user?.name, user?.displayName);
		if (known) return known;
		const login = String(user?.login || user?.name || '').toLowerCase();
		if (login && login !== 'anonymous') {
			const fetched = await FetchTwitchColor(login);
			if (fetched) return fetched;
		}
	}
	return GetPlatformColor(platform);
}

async function renderFeaturedMessage(data, headerText, platform) {
	const template = document.getElementById('featuredMessageTemplate');
	if (!template) return;
	const instance = template.content.cloneNode(true);

	instance.querySelector(".featured-header-text").innerText = headerText;
	instance.querySelector("#timestamp").innerText = GetCurrentTimeFormatted();

	const usernameSpan = instance.querySelector("#username");
	const featuredColor = platform === 'twitch'
		? await EventUserColor({ ...data.user, color: data.user?.color || data.message?.color }, 'twitch')
		: '#FF0000';
	usernameSpan.replaceWith(usernameMarquee(data.user.name, usernameChatColor(featuredColor)));

	// The template has always had a #badgeList; nothing ever filled it. A featured
	// message IS a chat message, so its own payload carries the badges.
	if (showBadges && platform === 'twitch') {
		RenderBadgeList(instance.querySelector("#badgeList"),
			data.message?.badges || LookupTwitchBadges(data.user?.id, data.user?.login, data.user?.name));
	}

	if (data.user.name !== 'Anonymous') {
		const avatarUrl = await GetAvatar(data.user.name, data.user.profileImageUrl, platform);
		instance.querySelector("#avatar").innerHTML = `<img src="${avatarUrl}" class="avatar">`;

		instance.querySelector("#platform").innerHTML = iconImg(`platforms/${platform}`, 'platform');
	} else {
		instance.querySelector("#avatar").style.display = 'none';
		instance.querySelector("#platform").style.display = 'none';
	}

	let textContent = "";
	if (typeof data.message === 'string') textContent = data.message;
	else if (data.message && typeof data.message.message === 'string') textContent = data.message.message;
	else if (data.text) textContent = data.text;

	const tempDiv = document.createElement('div');
	tempDiv.innerText = textContent;
	let escapedText = tempDiv.innerHTML;
	const platformColor = platform === 'twitch' ? '#9146FF' : '#FF0000';
	escapedText = escapedText.replace(/(^|\s)(@[^\s<]+)/g, `$1<span style="font-weight: bold; color: ${platformColor};">$2</span>`);
	escapedText = linkify(escapedText);

	instance.querySelector(".featured-message-text").innerHTML = escapedText;

	if (data.emotes) {
		data.emotes.forEach(e => {
			instance.querySelector(".featured-message-text").innerHTML = instance.querySelector(".featured-message-text").innerHTML.replace(new RegExp(`\\b${e.name}\\b`, 'g'), `<img src="${e.imageUrl}" class="emote"/>`);
		});
	}

	AddSubCardItem(instance, data.messageId || data.eventId, platform, data.user.id);
}

// An icon and the words that go with it in an event description: "📅 14 Months",
// "⦿ 300", or with the icon after them, "Cheered 100 💎".
function EvGroup(icon, text, iconAfter = false) {
	return `<span class="ev-group">${iconAfter ? text + iconImg(icon) : iconImg(icon) + text}</span>`;
}

async function renderEventCard(data, type, platform, opts = {}) {
	const template = document.getElementById('subCardTemplate');
	const instance = template.content.cloneNode(true);

	const avatarDiv = instance.querySelector("#avatar");
	const platformDiv = instance.querySelector("#platform");
	const usernameDiv = instance.querySelector("#username");
	const timestampDiv = instance.querySelector("#timestamp");
	const descDiv = instance.querySelector(".sub-description");
	const iconArea = instance.querySelector(".sub-icon-area");
	instance.querySelector(".sub-event-container").dataset.type = type;   // style.css keys off it

	// Icon-less types are the channel-point card: no icon box at all.
	if (type === 'channelpoint' || type === 'watchstreak') {
		iconArea.remove();
	} else {
		// Event type -> icon (assets/icons/<size>/<name>.svg, which fills the icon box).
		// Cheers pass their tier-coloured bit jar in opts.icon.
		const ICON_MAP = { raid: 'raid-bell', donation: 'donation-paper-bag', superchat: 'donation-paper-bag' };
		iconArea.innerHTML = iconImg(opts.icon || ICON_MAP[type] || 'sub-skull', 'event-icon');
	}
	const giftArrow = instance.querySelector(".gift-arrow-icon");
	if (giftArrow) { giftArrow.src = iconSrc('gift-arrow'); giftArrow.dataset.icon = 'gift-arrow'; }

	if (showTimestamps) {
		timestampDiv.classList.add("timestamp");
		timestampDiv.innerText = GetCurrentTimeFormatted();
	}

	const isIndividualGift = (type === 'gift' && data.recipient);
	const senderName = data.isAnonymous ? 'Anonymous' : (data.user ? (data.user.name || data.user.displayName) : 'Unknown');
	const receiverName = isIndividualGift ? (data.recipient.name || data.recipient.displayName) : '';

	if (showUsername) {
		usernameDiv.textContent = senderName;
		usernameDiv.style.color = usernameChatColor(await EventUserColor(data.user, platform, opts.color));
		if (senderName === 'Anonymous') usernameDiv.classList.add('is-anonymous');
	}

	if (showPlatform && senderName !== 'Anonymous' && PLATFORMS_WITH_ICONS.has(platform)) {
		platformDiv.innerHTML = iconImg(`platforms/${platform}`, 'platform');
		platformDiv.style.display = 'flex';
	} else {
		platformDiv.style.display = 'none';
	}

	if (showAvatar && senderName !== 'Anonymous') {
		const avatarURL = await GetAvatar(senderName, data.user?.profileImageUrl, platform);
		avatarDiv.innerHTML = `<img src="${avatarURL}" class="avatar">`;
		avatarDiv.style.display = 'flex';
	} else {
		avatarDiv.style.display = 'none';
	}
	
	// Badges from what this user last wore in chat. Skipped on an individual gift: that
	// row already carries two users (sender -> receiver) and whose badges these were
	// would be ambiguous.
	if (showBadges && platform === 'twitch' && !isIndividualGift && !data.isAnonymous) {
		RenderBadgeList(instance.querySelector("#badgeList"),
			LookupTwitchBadges(data.user?.id, data.user?.login, data.user?.name, data.user?.displayName));
	}

	if (isIndividualGift) {
		const subUserContent = instance.querySelector(".sub-user-content");
		const receiverSpan = instance.querySelector("#gift-receiver");
		if (receiverSpan) {
			subUserContent.classList.add('is-gift');
			receiverSpan.style.display = 'flex';
			const recAvatarDiv = instance.querySelector("#receiver-avatar");
			if (showAvatar) {
				const recAvatarURL = await GetAvatar(receiverName, data.recipient?.profileImageUrl, platform);
				recAvatarDiv.innerHTML = `<img src="${recAvatarURL}" class="avatar">`;
			}
			if (showPlatform) instance.querySelector("#receiver-platform").innerHTML = iconImg(`platforms/${platform}`, 'platform');

			// Sender + receiver names become scrolling marquees that split the row's
			// width by max-min fairness (allocateGiftRow), replacing the old ellipsis.
			const senderColor = usernameChatColor(await EventUserColor(data.user, platform, opts.color));
			const receiverColor = usernameChatColor(await EventUserColor(data.recipient, platform, opts.color));
			const senderText = showUsername ? senderName : '';

			// Wrap the sender's avatar · platform · name into one flex cell.
			const giftSender = document.createElement('div');
			giftSender.className = 'gift-sender';
			giftSender.append(avatarDiv, platformDiv);
			giftSender.insertAdjacentHTML('beforeend', marqueeHTML(senderText, { mode: 'fadeswap', fade: true, cls: 'gift-name' }));
			giftSender.querySelector('.mq').style.color = senderColor;
			subUserContent.insertBefore(giftSender, receiverSpan);
			usernameDiv.remove();

			// Receiver name marquee replaces the #receiver-username span.
			const recUsernameDiv = instance.querySelector("#receiver-username");
			recUsernameDiv.insertAdjacentHTML('beforebegin', marqueeHTML(receiverName, { mode: 'fadeswap', fade: true, cls: 'gift-name' }));
			recUsernameDiv.previousElementSibling.style.color = receiverColor;
			recUsernameDiv.remove();
		}
	} else if (showUsername) {
		// Non-gift event cards: the single sender username also fade-scrolls
		// instead of truncating with "…".
		usernameDiv.replaceWith(usernameMarquee(senderName, usernameDiv.style.color));
	}

	// opts.description (may contain HTML) overrides the built-in text for a type. An icon
	// and the figure it goes with sit together in an .ev-group (see EvGroup).
	let description = opts.description || '';
	if (!opts.description) {
		switch(type) {
			case 'sub':
				description = data.is_prime || data.isPrime ? `Used Their Prime Sub` : `Subscribed with Tier ${String(data.sub_tier || data.subTier || '1').charAt(0)}`;
				break;
			case 'resub':
				const months = data.cumulativeMonths || '14';
				description = (data.isPrime ? `Used Their Prime Sub` : `Resubscribed with Tier ${String(data.subTier || '1').charAt(0)}`) + EvGroup('calendar', `${months} Months`);
				break;
			case 'gift':
				description = platform === 'twitch' ? `Gifted a Tier ${String(data.subTier || '1').charAt(0)} Subscription` : `Gifted a Channel Membership`;
				break;
			case 'giftbomb':
				description = platform === 'twitch' ? `Gifted ${data.giftCount} Tier ${String(data.subTier || '1').charAt(0)} Subs to the Community` : `Gifted ${data.giftCount} Memberships to the Community`;
				break;
			case 'raid':
				description = `Raiding with a Party of ${data.viewers} ${data.viewers === 1 ? 'Homie' : 'Homies'}`;
				break;
			case 'donation':
				description = `Donated ${data.formattedAmount}`;
				break;
			case 'superchat':
				description = `Donated ${data.amount} Through Super Chat`;
				break;
			case 'watchstreak':
				description = `On a ${data.streakCount} Stream Streak!`;
				break;
		}
	}

	// A clipped event line scrolls like a username: to the end, then fades back.
	descDiv.innerHTML = `<div class="mq fade desc-mq" data-mq-mode="fadeswap"><span class="mq-inner">${description}</span></div>`;

	const commentWrapper = instance.querySelector(".sub-comment-wrapper");
	const message = data.text || (typeof data.message === 'string' ? data.message : '');

	// The attachment (a song card, or the viewer's own message) stacks under the header.
	if (opts.htmlContent) {
		commentWrapper.style.display = "block";
		commentWrapper.classList.toggle('is-song', /music-ui-container/.test(opts.htmlContent));
		instance.querySelector(".sub-comment-text").innerHTML = opts.htmlContent;
	} else if (message && message.trim().length > 0) {
		commentWrapper.style.display = "block";
		instance.querySelector(".sub-comment-text").innerHTML = linkify(escapeHtml(message));
	}

	AddSubCardItem(instance, data.messageId || data.eventId, platform, data.user?.id);
}

async function TwitchChatMessage(data) {
	// Learn this chatter's colour before any early return, so event cards for people
	// whose messages we hide (commands, ignored users) still get the right colour.
	RememberTwitchColor(data.message?.color, data.message?.userId, data.message?.username, data.message?.displayName, data.user?.id, data.user?.login, data.user?.name);
	RememberTwitchBadges(data.message?.badges, data.message?.userId, data.message?.username, data.message?.displayName, data.user?.id, data.user?.login, data.user?.name);
	if (data.message?.firstMessage) return await renderFeaturedMessage(data, "FIRST TIME CHAT", 'twitch');
	if (!showTwitchMessages || (data.message.message.startsWith("!") && excludeCommands) || ignoreUserList.includes(data.message.username)) return;

	const template = document.getElementById('messageTemplate');
	const instance = template.content.cloneNode(true);

	const replyDiv = instance.querySelector("#reply");
	if (data.message.isReply) {
		replyDiv.style.display = 'flex';
		const replyUserDiv = instance.querySelector("#replyUser");
		replyUserDiv.innerText = data.message.reply.userName;
		const rc = usernameChatColor('#9146FF');
		replyUserDiv.style.color = rc;
		const rInk = usernameInk(rc);
		if (rInk) {
			replyUserDiv.style.setProperty('--o-colour', rInk);
			if (_oTextExtrudeTemplate) replyUserDiv.style.setProperty('--o-text-extrude', _oTextExtrudeTemplate);
		}
		instance.querySelector("#replyMsg").innerText = data.message.reply.msgBody;
	} else if (replyDiv) {
		replyDiv.remove();
	}

	if (showTimestamps) instance.querySelector("#timestamp").innerText = GetCurrentTimeFormatted();

	if (showUsername) {
		// Same fade-scroll window the event cards use — a long display name is
		// cropped and scrolled instead of running off the row and shoving the
		// timestamp out of view.
		const usernameDiv = instance.querySelector("#username");
		// A chatter who never picked a colour arrives with an empty string. Left as-is
		// the name inherits --font-color and renders white — indistinguishable from the
		// message text — while that same person's event card falls back to the platform
		// purple. Use the card's fallback here so one user is one colour everywhere.
		usernameDiv.replaceWith(usernameMarquee(data.message.displayName,
			usernameChatColor(data.message.color || GetPlatformColor('twitch'))));
	}

	const messageDiv = instance.querySelector("#message");
	messageDiv.innerText = data.message.message;
	messageDiv.innerHTML = messageDiv.innerHTML.replace(/(^|\s)(@[^\s<]+)/g, `$1<span style="font-weight: bold; color: #9146FF;">$2</span>`);
	messageDiv.innerHTML = linkify(messageDiv.innerHTML);
	if (data.message.isMe) messageDiv.style.color = data.message.color;

	if (showPlatform) instance.querySelector("#platform").innerHTML = iconImg('platforms/twitch', 'platform');

	if (showBadges) {
		const badgeListDiv = instance.querySelector("#badgeList");
		RenderBadgeList(badgeListDiv, data.message.badges);
		// Session cheer badge — last in the row, so Twitch's own badges keep their order.
		const bitColor = BitTierColor(LookupTwitchBits(data.message.userId, data.message.username, data.message.displayName, data.user?.id));
		if (bitColor) {
			const gem = new Image(); gem.src = iconSrc(`bit-${bitColor}`); gem.dataset.icon = `bit-${bitColor}`;
			gem.classList.add("badge", "bit-badge");
			badgeListDiv.appendChild(gem);
		}
	}

	data.emotes.forEach(e => {
		messageDiv.innerHTML = messageDiv.innerHTML.replace(new RegExp(`\\b${e.name}\\b`, 'g'), `<img src="${e.imageUrl}" class="emote"/>`);
	});

	if (data.cheerEmotes) {
		data.cheerEmotes.forEach(e => {
			const bitsElements = `<span class="bits">${e.bits}</span>`;
			messageDiv.innerHTML = messageDiv.innerHTML.replace(new RegExp(`\\b${e.name}${e.bits}\\b`, 'ig'), `<img src="${e.imageUrl}" class="emote"/>` + bitsElements);
		});
	}

	if (showAvatar) {
		const avatarURL = await GetAvatar(data.message.username, null, 'twitch');
		instance.querySelector("#avatar").innerHTML = `<img src="${avatarURL}" class="avatar">`;
	}

	const messageText = data.message.message;
	if (IsThisUserAllowedToPostImagesOrNotReturnTrueIfTheyCanReturnFalseIfTheyCannot(imageEmbedPermissionLevel, data, 'twitch') && IsImageUrl(messageText)) {
		const image = new Image();
		image.onload = function () {
			image.style.padding = "10px 0px";
			image.style.width = "100%";
			image.style.display = "block";
			messageDiv.innerHTML = '';
			messageDiv.appendChild(image);
			AddMessageItem(instance, data.message.msgId, 'twitch', data.user.id);
		};
		try {
			const urlObj = new URL(messageText);
			urlObj.search = '';
			urlObj.hash = '';
			image.src = "https://external-content.duckduckgo.com/iu/?u=" + encodeURIComponent(urlObj.toString());
		} catch (e) {
			AddMessageItem(instance, data.message.msgId, 'twitch', data.user.id);
		}
	} else {
		AddMessageItem(instance, data.message.msgId, 'twitch', data.user.id);
	}
}

/* =========================================================================
   Stinger sync (see also the stinger project's script.js)
   -------------------------------------------------------------------------
   The stinger is a SEPARATE OBS browser source layered above this chat. OBS
   isolates browser sources, so the two can't message each other — instead they
   both subscribe to the same Streamer.bot events and run their halves of ONE
   shared, fixed timeline. Because both receive the same event at the same
   instant, they stay in lockstep with no cross-source messaging.

   On a triggering event this source: fades the chat out, holds the alert card,
   waits out the stinger, fades the chat back in, then renders the held card.

   The hidden window is NOT fixed — stingerContentMs() computes how long the
   stinger actually needs for this event (a cheer's tip-jar length depends on how
   many gems the bit amount throws; a sub is its frame-sequence length). The
   stinger project computes the exact same number from the same event, so the two
   stay in lockstep without messaging each other.

   IMPORTANT: STINGER_SYNC + stingerContentMs/stingerCheerThrows must stay identical
   to the copies in the stinger's script.js. If you change these, change both.
   ========================================================================= */
const STINGER_SYNC = {
  chatFadeMs:     350,  // chat fade out / fade in (matches #mainContainer transition in style.css)
  // --- tip-jar timing model, mirrors the stinger's CFG so we can predict a cheer's length ---
  fps:            25,
  jarIntroFrames: 36,   // the jar-rise intro
  throwStaggerMs: 170,  // gap between queued gem throws
  throwFlightMs:  780,  // a gem's flight time
  noteTailMs:     850,  // the last note lingers after the last gem lands
  jarIdleMs:      800,  // the jar/sub holds this long before it starts fading out
  maxThrows:      40,   // the jar clamps a cheer to this many throws
  subFrames:      65,   // sub-stinger frame count
  marginMs:       250,  // small pad so the chat's card lands as the stinger clears, not before
};

// mirrors CFG.bitTiers decomposition in the stinger — how many gems a cheer throws
function stingerCheerThrows(bits) {
  const mins = [10000, 5000, 1000, 100, 10];
  let rest = Math.max(0, Math.floor(bits) || 0), n = 0;
  for (const m of mins) { const c = Math.floor(rest / m); if (c > 0) { rest -= c * m; n += c; } }
  if (n === 0) n = 1;
  return Math.min(n, STINGER_SYNC.maxThrows);
}

// Predicted on-screen time (ms) the stinger runs for an event — identical to the
// stinger's copy so the chat fades back in as the stinger clears.
function stingerContentMs(kind, data) {
  const S = STINGER_SYNC;
  if (kind === 'cheer') {
    const n = stingerCheerThrows(data && data.bits);
    const introMs  = S.jarIntroFrames / S.fps * 1000;
    const throwsMs = (n - 1) * S.throwStaggerMs + S.throwFlightMs;
    return Math.round(introMs + throwsMs + S.noteTailMs + S.jarIdleMs + S.marginMs);
  }
  return Math.round(S.subFrames / S.fps * 1000 + S.jarIdleMs + S.marginMs);
}

let stingerCycleEndAt = 0;   // performance.now() when the held cards are released
let stingerPendingCards = []; // card render thunks waiting for the chat to come back

function startStingerCycle(contentMs) {
  const S = STINGER_SYNC, now = performance.now();
  const hiddenBeforeFadeIn = S.chatFadeMs + contentMs;   // chat hidden until the stinger fades out
  stingerCycleEndAt = now + hiddenBeforeFadeIn + S.chatFadeMs;
  mainContainer.classList.add('stinger-hidden');                         // fade chat out
  setTimeout(() => mainContainer.classList.remove('stinger-hidden'),     // fade chat back in
             hiddenBeforeFadeIn);
  setTimeout(() => {                                                     // chat is back -> show held cards
    const cards = stingerPendingCards; stingerPendingCards = [];
    cards.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    if (stingerPendingCards.length && performance.now() >= stingerCycleEndAt) startStingerCycle(stingerContentMs('sub'));
  }, hiddenBeforeFadeIn + S.chatFadeMs);
}

// Call on the RAW triggering event (before any gift-bomb accumulation) so the chat
// fade lines up with the stinger, which fires on the same event. kind is 'cheer' or
// 'sub'; data carries the bit amount (cheer) and the user (avatar pre-warm). Bursts
// collapse into the one active cycle. Pre-warming the avatar during the hidden window
// lets the held card pop in tight to the chat's return instead of waiting on a fetch.
function stingerTrigger(kind, data) {
  if (!stingersEnabled) return;
  const user = data && data.user;
  if (user && user.name) GetAvatar(user.name, user.profileImageUrl, 'twitch');
  if (performance.now() >= stingerCycleEndAt) startStingerCycle(stingerContentMs(kind, data));
}

// Wrap the actual card render. When a cycle is active the card is held until the
// chat fades back in; otherwise (stingers off, or the rare event that lands after
// the window) it renders immediately, so behaviour is unchanged when disabled.
function stingerGateCard(thunk) {
  if (!stingersEnabled) return thunk();
  if (performance.now() < stingerCycleEndAt) stingerPendingCards.push(thunk);
  else thunk();
}

async function TwitchSub(data) { if (!showTwitchSubs) return; stingerTrigger('sub', data); stingerGateCard(() => renderEventCard(data, 'sub', 'twitch')); }
async function TwitchResub(data) { if (!showTwitchSubs) return; stingerTrigger('sub', data); stingerGateCard(() => renderEventCard(data, 'resub', 'twitch')); }
async function TwitchRaid(data) {
	if (!showTwitchRaids) return;
	if (!data.user) data.user = { id: data.from_broadcaster_user_id, name: data.from_broadcaster_user_name, login: data.from_broadcaster_user_login };
	await renderEventCard(data, 'raid', 'twitch');
}
async function TwitchAnnouncement(data) { if (showTwitchAnnouncements) await renderFeaturedMessage(data, "ANNOUNCEMENT", 'twitch'); }
async function TwitchAutomaticRewardRedemption(data) {
	if (data.reward_type !== 'gigantify_an_emote') return;

	const template = document.getElementById('messageTemplate');
	if (!template) return;
	
	const instance = template.content.cloneNode(true);
	const userInfoDiv = instance.querySelector("#userInfo");
	const messageDiv = instance.querySelector("#message");

	if (userInfoDiv) userInfoDiv.style.display = "none";

	const gigaEmote = data.gigantified_emote?.imageUrl || data.gigantified_emote?.url;
	if (!gigaEmote) return;

	const image = new Image();
	image.src = gigaEmote;
	image.style.padding = "10px 0px";
	image.style.width = "50%";
	image.style.display = "block";
	image.style.margin = "0 auto"; 

	image.onload = function () {
		messageDiv.innerHTML = '';
		messageDiv.appendChild(image);
		const userId = data.user_id || data.user?.id || 'reward_user';
		AddMessageItem(instance, data.id, 'twitch', userId);
	};
}

// ===== Compact single-row alert (boiling border). Shared by follows + YT subscribe. =====
// `action` is the bold verb shown after the username ("followed", "subscribed", ...).
async function renderFollowCard(data, platform, action = 'followed') {
	const template = document.getElementById('followCardTemplate');
	const instance = template.content.cloneNode(true);

	const avatarDiv = instance.querySelector("#avatar");
	const platformDiv = instance.querySelector("#platform");
	const usernameDiv = instance.querySelector("#username");
	const timestampDiv = instance.querySelector("#timestamp");
	const actionDiv = instance.querySelector(".follow-action");

	if (actionDiv) actionDiv.innerText = action;

	const name = data.user?.name || 'Someone';

	if (showUsername) {
		usernameDiv.replaceWith(usernameMarquee(name, usernameChatColor(await EventUserColor(data.user, platform))));
	}

	if (showPlatform && PLATFORMS_WITH_ICONS.has(platform)) {
		platformDiv.innerHTML = iconImg(`platforms/${platform}`, 'platform');
	} else {
		platformDiv.style.display = 'none';
	}

	if (showAvatar) {
		const avatarURL = await GetAvatar(name, data.user?.profileImageUrl, platform);
		avatarDiv.innerHTML = `<img src="${avatarURL}" class="avatar">`;
	} else {
		avatarDiv.style.display = 'none';
	}

	if (showBadges && platform === 'twitch') {
		RenderBadgeList(instance.querySelector("#badgeList"),
			LookupTwitchBadges(data.user?.id, data.user?.login, data.user?.name, data.user?.displayName));
	}

	if (showTimestamps) {
		timestampDiv.classList.add("timestamp");
		timestampDiv.innerText = GetCurrentTimeFormatted();
	}

	AddSubCardItem(instance, data.user?.id || `follow-${Date.now()}`, platform, data.user?.id);
}

// ===== New follower (Twitch) =====
async function TwitchFollow(data) {
	if (!showTwitchFollows) return;
	const user = { id: data.user_id, name: data.user_name, login: data.user_login };
	await renderFollowCard({ ...data, user }, 'twitch');
}

// ===== Cheer / Bits (dedicated branded card) =====
async function TwitchCheer(data) {
	// Before the gate — the chat badge should still count up when cheer cards are off.
	// ponytail: the cheerer's OWN cheer message shows the pre-cheer tier if Streamer.bot
	// emits Twitch.ChatMessage before Twitch.Cheer; their next message is right. Counting
	// the message's own cheerEmotes too would need a dedupe against this event's bits.
	AddTwitchBits(data.bits, data.user?.id, data.user?.login, data.user?.name, data.user?.displayName);
	if (!showTwitchCheers) return;
	stingerTrigger('cheer', data);
	const rawText = typeof data.message === 'string' ? data.message : (data.message?.message || '');
	// Strip only identified cheermote tokens (e.g. "Cheer100") using the same
	// cheerEmotes array Streamer.bot provides, leaving the actual typed message.
	let text = rawText;
	if (data.cheerEmotes && data.cheerEmotes.length > 0) {
		data.cheerEmotes.forEach(e => {
			text = text.replace(new RegExp(`\\b${e.name}${e.bits}\\b`, 'ig'), '');
		});
	}
	text = text.trim();

	// Pick the bit gem color based on cheer amount (assets/icons/*/bit-<color>.svg).
	// Twitch tiers: 1-99 gray, 100-999 purple, 1000-4999 green, 5000-9999 blue, 10000+ red.
	const bitColor = BitTierColor(data.bits || 0) || 'gray';

	// "Cheered 100 💎", with the tier's bit jar as the card's icon.
	const description = EvGroup(`bit-${bitColor}`, `Cheered ${data.bits}`, true);
	stingerGateCard(() => renderEventCard({ user: data.user, bits: data.bits, text }, 'cheer', 'twitch', {
		description,
		icon: `bit-jar-${bitColor}`,
	}));
}

// The song card a song request carries (and the settings preview's demo one).
function SongCardHTML(songInfo) {
	// Fallback transparent pixel if no art is found so the layout doesn't break
	const artUrl = songInfo.albumArt || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
	// Title / album / artist scroll (Apple-smooth wrap) instead of ellipsis-
	// truncating, ported from the Music-Info-Card song card.
	return `
		<div class="music-ui-container">
			<img class="music-ui-art" src="${artUrl}" onerror="this.style.visibility='hidden'" />
			<div class="music-ui-info">
				${marqueeHTML(songInfo.title, { mode: 'smooth', fade: true, cls: 'music-ui-title' })}
				${songInfo.album ? marqueeHTML(songInfo.album, { mode: 'smooth', fade: true, cls: 'music-ui-album' }) : ''}
				<div class="music-ui-artist-row">
					${marqueeHTML(songInfo.artist, { mode: 'smooth', fade: true, cls: 'music-ui-artist' })}
					<span class="music-ui-duration">${iconImg('clock', 'music-ui-clock')}${FormatSongDuration(songInfo.durationMs)}</span>
				</div>
			</div>
		</div>`;
}

// "Redeemed Song Request ⦿ 300" — the channel-point icon, not the reward's own art.
const ChannelPointDescription = (title, cost) => `Redeemed ${escapeHtml(title)}` + EvGroup('channel-point', cost);

async function TwitchRewardRedemption(data) {
	if (!showTwitchChannelPoints) return;
	const user = { id: data.user_id, name: data.user_name, login: data.user_login };
	const description = ChannelPointDescription(data.reward.title, data.reward.cost);
	let text = data.user_input || '';
	let htmlContent = null;

	if (data.reward && data.reward.title && data.reward.title.toLowerCase().includes("song request")) {
		const songInfo = await GetSongInfo(text);
		if (songInfo) htmlContent = SongCardHTML(songInfo);
	}

	await renderEventCard({ ...data, user, text }, 'channelpoint', 'twitch', { description, htmlContent });
}

// ===== Watch streak =====
async function TwitchWatchStreak(data) {
	if (!showTwitchWatchStreaks) return;
	const streakCount = data.watchStreak ?? data.streak_count;
	const name = data.displayName ?? data.user?.name;
	const user = data.user || { name: name, login: name };
	await renderEventCard({ ...data, user, streakCount }, 'watchstreak', 'twitch');
}

const GIFT_BOMB_WINDOW_MS = 800;
const giftBombBuffer = new Map();

function accumulateGift(data, platform) {
	const senderId = data.isAnonymous ? '__anonymous__' : (data.user ? (data.user.id || data.user.login || data.user.name) : '__unknown__');
	const key = `${platform}:${senderId}`;

	if (giftBombBuffer.has(key)) {
		const entry = giftBombBuffer.get(key);
		entry.count++;
		clearTimeout(entry.timer);
		entry.timer = setTimeout(() => flushGiftBomb(key), GIFT_BOMB_WINDOW_MS);
	} else {
		giftBombBuffer.set(key, { data, platform, count: 1, timer: setTimeout(() => flushGiftBomb(key), GIFT_BOMB_WINDOW_MS) });
	}
}

function flushGiftBomb(key) {
	const entry = giftBombBuffer.get(key);
	if (!entry) return;
	giftBombBuffer.delete(key);
	const { data, platform, count } = entry;

	// Only Twitch gifts drive the stinger; other platforms render immediately.
	const gate = (platform === 'twitch') ? stingerGateCard : (fn => fn());
	if (count === 1) gate(() => renderEventCard(data, 'gift', platform));
	else gate(() => renderEventCard({ ...data, giftCount: count, recipient: null, messageId: `giftbomb-${Date.now()}` }, 'giftbomb', platform));
}

async function TwitchGiftSub(data) { if (!showTwitchSubs) return; stingerTrigger('sub', data); accumulateGift(data, 'twitch'); }

function TwitchChatMessageDeleted(data) {
	document.querySelectorAll(`li[id="${data.messageId}"]`).forEach(item => {
		item.style.height = item.offsetHeight + 'px';   // from auto, so the collapse animates
		item.offsetHeight;
		item.style.opacity = 0;
		item.style.height = 0;
		item.style.paddingTop = 0;
		item.style.paddingBottom = 0;
		item.style.marginTop = 0;
		item.style.marginBottom = 0;
		setTimeout(() => item.remove(), 400);
	});
}
function TwitchUserBanned(data) {
	document.querySelectorAll(`li[data-user-id="${data.user_id}"]`).forEach(item => item.remove());
}
function TwitchChatCleared() {
	document.getElementById("messageList").innerHTML = '';
}

async function YouTubeMessage(data) {
	if (data.isFirstMessage || data.message?.firstMessage) return await renderFeaturedMessage(data, "FIRST TIME CHAT", 'youtube');
	if (!showYouTubeMessages || (data.message.startsWith("!") && excludeCommands) || ignoreUserList.includes(data.user.name)) return;

	const template = document.getElementById('messageTemplate');
	const instance = template.content.cloneNode(true);

	const replyDiv = instance.querySelector("#reply");
	if (replyDiv) replyDiv.remove();

	if (showTimestamps) instance.querySelector("#timestamp").innerText = GetCurrentTimeFormatted();

	if (showUsername) {
		const usernameDiv = instance.querySelector("#username");
		usernameDiv.replaceWith(usernameMarquee(data.user.name, usernameChatColor('#f70000')));
	}

	const messageDiv = instance.querySelector("#message");
	messageDiv.innerText = data.message;
	messageDiv.innerHTML = messageDiv.innerHTML.replace(/(^|\s)(@[^\s<]+)/g, `$1<span style="font-weight: bold; color: #FF0000;">$2</span>`);
	messageDiv.innerHTML = linkify(messageDiv.innerHTML);

	if (showPlatform) instance.querySelector("#platform").innerHTML = iconImg('platforms/youtube', 'platform');

	if (showBadges) {
		// YouTube roles in Twitch's badge art: owner, mod (sword), member (star). Verified has none.
		const u = data.user;
		RenderBadgeList(instance.querySelector("#badgeList"),
			[u.isOwner && 'broadcaster', u.isModerator && 'moderator', u.isSponsor && 'subscriber']
				.filter(Boolean).map(name => ({ name, imageUrl: BADGE_ART[name] })));
	}

	data.emotes.forEach(e => { messageDiv.innerHTML = messageDiv.innerHTML.replace(new RegExp(e.name, 'g'), `<img src="${e.imageUrl}" class="emote"/>`); });

	if (showAvatar) {
		const avatarURL = await GetAvatar(data.user.name, data.user.profileImageUrl, 'youtube');
		instance.querySelector("#avatar").innerHTML = `<img src="${avatarURL}" class="avatar">`;
	}

	const messageText = data.message;
	if (IsThisUserAllowedToPostImagesOrNotReturnTrueIfTheyCanReturnFalseIfTheyCannot(imageEmbedPermissionLevel, data, 'youtube') && IsImageUrl(messageText)) {
		const image = new Image();
		image.onload = function () {
			image.style.padding = "10px 0px";
			image.style.width = "100%";
			image.style.display = "block";
			messageDiv.innerHTML = '';
			messageDiv.appendChild(image);
			AddMessageItem(instance, data.eventId, 'youtube', data.user.id);
		};
		try {
			const urlObj = new URL(messageText);
			urlObj.search = '';
			urlObj.hash = '';
			image.src = "https://external-content.duckduckgo.com/iu/?u=" + encodeURIComponent(urlObj.toString());
		} catch (e) {
			AddMessageItem(instance, data.eventId, 'youtube', data.user.id);
		}
	} else {
		AddMessageItem(instance, data.eventId, 'youtube', data.user.id);
	}
}

async function YouTubeSuperChat(data) {
	if (!showYouTubeSuperChats) return;
	if (!data.user) data.user = { id: data.eventId || 'yt-user', name: data.user ? data.user.name : 'YouTube Fan' };
	await renderEventCard(data, 'superchat', 'youtube');
}
// A membership is YouTube's sub; "subscribed" is now the subscriber card below.
async function YouTubeNewSponsor(data) {
	if (!showYouTubeMemberships) return;
	await renderFollowCard(data, 'youtube', 'became a member');
}
// YouTube's follow. Streamer.bot gets these through its StreamElements integration,
// and a test event carries no user, so those are skipped. No setting of its own.
async function YouTubeNewSubscriber(data) {
	if (!data?.user) return;
	await renderFollowCard(data, 'youtube', 'subscribed');
}
async function YouTubeGiftMembershipReceived(data) {
	if (!showYouTubeMemberships) return;
	accumulateGift({ ...data, user: data.gifter || data.user, recipient: data.recipient || data.user, subTier: data.tier || '1' }, 'youtube');
}

async function StreamlabsDonation(data) {
	if (!showStreamlabsDonations) return;
	if (!data.user) data.user = { id: data.from, name: data.from };
	await renderEventCard(data, 'donation', 'twitch');
}
async function StreamElementsTip(data) {
	if (!showStreamElementsTips) return;
	if (!data.user) data.user = { id: data.username, name: data.username };
	if (!data.formattedAmount) data.formattedAmount = `$${data.amount}`;
	await renderEventCard(data, 'donation', 'twitch');
}

const Simplex3D = (function () {
	const F3 = 1.0 / 3.0, G3 = 1.0 / 6.0;
	const p = new Uint8Array([151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180]);
	const perm = new Uint8Array(512), permMod12 = new Uint8Array(512);
	for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = (perm[i] % 12); }
	function grad(hash, x, y, z) {
		const h = hash & 15; const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
		return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
	}
	return function (xin, yin, zin) {
		let n0, n1, n2, n3;
		const s = (xin + yin + zin) * F3; const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
		const t = (i + j + k) * G3; const X0 = i - t, Y0 = j - t, Z0 = k - t;
		const x0 = xin - X0, y0 = yin - Y0, z0 = zin - Z0;
		let i1, j1, k1, i2, j2, k2;
		if (x0 >= y0) {
			if (y0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; } else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; } else { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
		} else {
			if (y0 < z0) { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; } else if (x0 < z0) { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; } else { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
		}
		const x1=x0-i1+G3, y1=y0-j1+G3, z1=z0-k1+G3;
		const x2=x0-i2+2.0*G3, y2=y0-j2+2.0*G3, z2=z0-k2+2.0*G3;
		const x3=x0-1.0+3.0*G3, y3=y0-1.0+3.0*G3, z3=z0-1.0+3.0*G3;
		const ii=i&255, jj=j&255, kk=k&255;
		let t0=0.6-x0*x0-y0*y0-z0*z0; if(t0<0) n0=0.0; else { t0*=t0; n0=t0*t0*grad(permMod12[ii+perm[jj+perm[kk]]],x0,y0,z0); }
		let t1=0.6-x1*x1-y1*y1-z1*z1; if(t1<0) n1=0.0; else { t1*=t1; n1=t1*t1*grad(permMod12[ii+i1+perm[jj+j1+perm[kk+k1]]],x1,y1,z1); }
		let t2=0.6-x2*x2-y2*y2-z2*z2; if(t2<0) n2=0.0; else { t2*=t2; n2=t2*t2*grad(permMod12[ii+i2+perm[jj+j2+perm[kk+k2]]],x2,y2,z2); }
		let t3=0.6-x3*x3-y3*y3-z3*z3; if(t3<0) n3=0.0; else { t3*=t3; n3=t3*t3*grad(permMod12[ii+1+perm[jj+1+perm[kk+1]]],x3,y3,z3); }
		return 32.0*(n0+n1+n2+n3);
	};
})();

const BOIL_CFG = { cornerRadius: 24, strokeWidth: 8, noiseFreq: 4.2, noiseCoordScale: 0.006, noiseTimeScale: 1.0, noiseAmp: 1.5, divW: 200, divH: 60, divCorner: 10, padding: 10 };
// Card colours: the card tokens in style.css (the cards have no dark mode).
const cardTokens = getComputedStyle(document.documentElement);
const CARD_SURFACE = cardTokens.getPropertyValue('--card-surface').trim() || '#ffffff';
const CARD_STROKE = cardTokens.getPropertyValue('--card-stroke').trim() || '#000000';
// How far the line wanders off true. Capped at 4: the card sits inside 10px of
// padding and the stroke eats 4 of it, so past ~6 the outline would clip.
BOIL_CFG.noiseAmp = Math.max(0, Math.min(4, GetFloatParam("boilAmp") ?? BOIL_CFG.noiseAmp));
function boilBuildBasePath(W, H, R) {
	const pts =[]; const { divW, divH, divCorner } = BOIL_CFG;
	for (let i=0; i<divW; i++) pts.push({ x: R+(W-2*R)*(i/divW), y: 0 });
	for (let i=0; i<divCorner; i++) pts.push({ x: W-R+R*Math.cos(-Math.PI/2+(Math.PI/2)*(i/divCorner)), y: R+R*Math.sin(-Math.PI/2+(Math.PI/2)*(i/divCorner)) });
	for (let i=0; i<divH; i++) pts.push({ x: W, y: R+(H-2*R)*(i/divH) });
	for (let i=0; i<divCorner; i++) pts.push({ x: W-R+R*Math.cos((Math.PI/2)*(i/divCorner)), y: H-R+R*Math.sin((Math.PI/2)*(i/divCorner)) });
	for (let i=0; i<divW; i++) pts.push({ x: W-R-(W-2*R)*(i/divW), y: H });
	for (let i=0; i<divCorner; i++) pts.push({ x: R+R*Math.cos(Math.PI/2+(Math.PI/2)*(i/divCorner)), y: H-R+R*Math.sin(Math.PI/2+(Math.PI/2)*(i/divCorner)) });
	for (let i=0; i<divH; i++) pts.push({ x: 0, y: H-R-(H-2*R)*(i/divH) });
	for (let i=0; i<divCorner; i++) pts.push({ x: R+R*Math.cos(Math.PI+(Math.PI/2)*(i/divCorner)), y: R+R*Math.sin(Math.PI+(Math.PI/2)*(i/divCorner)) });
	return pts;
}
/* One scratch array of points, shared by every border and rewritten in place on
   each draw. The .map() this replaced built a fresh 560-object array every time —
   per card, per draw — and threw it away as soon as the path was traced. The
   points are consumed synchronously inside drawBoil before the next border gets
   a look in, so a single buffer serves all of them. */
const boilScratch = [];
function boilDeformPath(base, time, seed) {
	const freq = BOIL_CFG.noiseFreq * BOIL_CFG.noiseCoordScale, t = time * BOIL_CFG.noiseTimeScale;
	const out = boilScratch, n = base.length;
	if (out.length !== n) out.length = n;   // every base path is 560 points, but don't assume it
	for (let i=0; i<n; i++) {
		const p = base[i], o = out[i] || (out[i] = { x: 0, y: 0 });
		o.x = p.x + Simplex3D(p.x*freq+seed, p.y*freq+seed, t) * BOIL_CFG.noiseAmp;
		o.y = p.y + Simplex3D(p.x*freq+seed+99.9, p.y*freq+seed+99.9, t) * BOIL_CFG.noiseAmp;
	}
	return out;
}
/* Build the smoothed outline ONCE per draw and hand the same Path2D to the fill
   and the stroke. Tracing straight into the context meant replaying all 560
   quadraticCurveTo calls a second time to describe the identical shape that had
   just been filled — the path is rebuilt from scratch after every beginPath(), so
   the context had no way to know it was the same one. */
function boilBuildSmoothPath(pts) {
	const path = new Path2D();
	if (pts.length < 3) return path;
	let p1 = pts[0]; path.moveTo((pts[pts.length-1].x+p1.x)/2, (pts[pts.length-1].y+p1.y)/2);
	for (let i=0; i<pts.length; i++) { p1 = pts[i]; const p2 = pts[(i+1)%pts.length]; path.quadraticCurveTo(p1.x, p1.y, (p1.x+p2.x)/2, (p1.y+p2.y)/2); }
	path.closePath();
	return path;
}
/* Off-screen culling for the boiling borders. The message list holds up to 5×
   the viewport height of cards, so most of the borders that are animating are
   scrolled outside the browser source and nobody can see them boil. This
   observer flags which canvases actually intersect the viewport; the tick below
   skips the noise + path work for the rest. The boil is driven by absolute time
   (ts/1000), so a culled border picks straight back up in phase — it never
   "restarts" — and cards only ever scroll away from the visible area anyway. */
const boilVisibility = new IntersectionObserver(entries => {
	for (const e of entries) {
		// A card only becomes cullable once it has actually been on screen. While a
		// card is playing its 0.4s height grow-in it is clipped to a zero-height box,
		// which reads as "not intersecting" — without this gate the border would sit
		// blank for the whole entrance. Cards only ever drift away from the visible
		// area afterwards, so in practice this costs nothing.
		if (e.isIntersecting) { e.target._boilVisible = true; e.target._boilSeen = true; }
		else if (e.target._boilSeen) e.target._boilVisible = false;
	}
}, { rootMargin: '120px' });   // margin so a card is already boiling before it slides into view

/* How long a border has to stay off screen before its pixels are handed back.
   A card's backing store is ~0.6-0.8 MB (two of them on a card with a comment),
   and a busy hour's worth of cards sitting in the list adds up to tens of MB of
   canvas that nothing can see. The delay is hysteresis: a card that is merely
   grazing the cull boundary shouldn't churn its buffer. */
const BOIL_RELEASE_AFTER_MS = 2000;

/* The boil holds still while the card animates in.

   Redrawing the border costs the same in script whatever size the card is — the
   path is always 560 points — but the browser still has to rasterise the whole
   canvas each frame, and THAT scales with the card's area. A six-line comment is
   303k pixels against 131k for a one-line one, so a tall card was asking for more
   than twice the per-frame raster at the exact moment the list is also relaying
   out for the height transition and the body's words are animating in. That's why
   the hitch got worse the more lines a card had.

   So: paint the border once and hold that frame until the card has settled, then
   start boiling. The noise clock is rewound when it starts so the shape continues
   from the held frame rather than jumping to wherever the boil would have been —
   and since the card is clipping into view for that whole window, a border that
   starts wobbling half a second later is not something you can see. */
const BOIL_HOLD_ON_APPEAR_MS = 650;   // covers the 0.5s height + content transitions
// Which drawing in the sequence `tSec` falls on, and where that drawing sits in
// the noise field. Anchored to the page clock rather than a per-card counter so
// all the borders on screen turn over together.
const boilIndexAt = (tSec) => Math.floor(tSec * BOIL.fps);
const boilZ = (idx) => idx * BOIL.step;
/* Live handles, read fresh on every frame rather than closed over as constants.
   That means the boil can be dialled from the console — or from the OBS browser
   source's remote debugger — while cards are on screen, instead of reloading and
   losing everything you were looking at. The URL params above just set the
   starting values.  Try:  BOIL.step = 0.042   BOIL.fps = 8   BOIL.amp = 3       */
window.BOIL = {
	fps: boilFps,
	step: boilStep,
	get amp() { return BOIL_CFG.noiseAmp; },
	set amp(v) { BOIL_CFG.noiseAmp = Math.max(0, Math.min(6, v)); },
};

/* Cards change size after they're shown: without the receipt they fill the
   source's width, so resizing the source reflows them (and their wrapped text).
   One observer for every card; each wrapper carries its own re-measure. */
const boilResize = new ResizeObserver(entries => { for (const e of entries) e.target._boilMeasure?.(); });

function initBoilingBorder(canvas, wrapper, bottomExtension = 0) {
	const P = BOIL_CFG.padding, R = BOIL_CFG.cornerRadius;
	let cw = 0, ch = 0, basePath = [];
	const ctx = canvas.getContext('2d');
	const seed = Math.random() * 1000;
	let firstTs = 0, heldIdx = null, lastDrawnIdx = -1;
	// Sizing a canvas allocates its backing store and resets the context state, so
	// the dpr scale has to be re-applied every time — on first use, again if the
	// buffer was released while off screen, and whenever the card is resized.
	let sized = false;
	function sizeCanvas() {
		canvas.width = Math.ceil(cw * dpr); canvas.height = Math.ceil(ch * dpr);
		ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(dpr, dpr);
		sized = true;
	}
	function releaseCanvas() {
		canvas.width = 0; canvas.height = 0;   // hands the pixels back to the browser
		sized = false;
	}
	function measure() {
		const w = wrapper.offsetWidth, h = wrapper.offsetHeight;
		if (!w || !h || (w + P*2 === cw && h + P*2 + bottomExtension === ch)) return;
		cw = w + P*2; ch = h + P*2 + bottomExtension;
		canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
		basePath = boilBuildBasePath(w, h + bottomExtension, R);
		if (!sized) return;
		// Resizing a canvas wipes it, so repaint now, before this frame is drawn: left to
		// the next tick, the card sat outline-less for a frame on every step of a resize.
		sizeCanvas();
		const idx = heldIdx ?? boilIndexAt(performance.now() / 1000);
		drawBoil(boilZ(idx));
		if (heldIdx === null) lastDrawnIdx = idx;
	}
	measure();
	wrapper._boilMeasure = measure;
	boilResize.observe(wrapper);
	canvas._boilVisible = true;          // assume visible until the observer has seen it on screen
	canvas._boilSeen = false;
	boilVisibility.observe(canvas);
	sizeCanvas();
	let culledAt = 0;
	function drawBoil(tSec) {
		ctx.clearRect(0, 0, cw, ch); ctx.save(); ctx.translate(P, P);
		const path = boilBuildSmoothPath(boilDeformPath(basePath, tSec, seed));
		ctx.fillStyle = CARD_SURFACE; ctx.fill(path);
		ctx.strokeStyle = CARD_STROKE; ctx.lineWidth = BOIL_CFG.strokeWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
		ctx.stroke(path);
		ctx.restore();
	}
	function tick(ts) {
		// The card this canvas belonged to was removed (deleted, or the message
		// list pruning its top). Stop the loop and let it be collected — without
		// this the border kept boiling into a detached canvas for the rest of the
		// session, and every card ever shown left one behind.
		if (!canvas.isConnected) { boilVisibility.unobserve(canvas); boilResize.unobserve(wrapper); return; }
		if (!canvas._boilVisible) {                       // scrolled out of the source
			if (!culledAt) culledAt = ts;
			else if (sized && ts - culledAt > BOIL_RELEASE_AFTER_MS) releaseCanvas();
			requestAnimationFrame(tick);
			return;
		}
		culledAt = 0;
		// Came back into view: the buffer was handed back, so it is empty and has to
		// be repainted on this frame rather than waiting for the next boil tick.
		// Came back into view with an empty buffer: forget what was drawn so the
		// checks below repaint on this frame instead of waiting for the next beat.
		if (!sized) { sizeCanvas(); heldIdx = null; lastDrawnIdx = -1; }
		if (!firstTs) firstTs = ts;

		// The card is still clipping into view. Put ONE drawing down and hold it —
		// the boil starts once the card has arrived, not while it is sliding in.
		if (ts - firstTs < BOIL_HOLD_ON_APPEAR_MS) {
			if (heldIdx === null) { heldIdx = boilIndexAt(ts / 1000); drawBoil(boilZ(heldIdx)); }
			requestAnimationFrame(tick);
			return;
		}
		// Arrived. Follow the shared beat. The loop still runs every frame — it is
		// a couple of comparisons and it keeps the cull and release checks
		// responsive — but the canvas, which is the part that has to be rasterised,
		// only repaints when the drawing actually changes.
		const idx = boilIndexAt(ts / 1000);
		if (idx !== lastDrawnIdx) { lastDrawnIdx = idx; drawBoil(boilZ(idx)); }
		requestAnimationFrame(tick);
	}
	requestAnimationFrame(tick);
}

/* ════════════════════════════════════════════════════════════════
   Marquee driver — ported from Videos/Music-Info-Card/MusicUIRender (app.js).
   Two modes share ONE velocity profile (ease-in → cruise → ease-out):
     smooth   — Apple wrap: two copies, rest at home, cruise once around, loop.
     fadeswap — cruise to the end, hold, fade out, reset home, fade back in.
   Each card is its own timing group; a group's clock starts the moment the
   card is measured, so every card gets the same rest → scroll → loop rhythm
   from when it appears. The old "…" (text-overflow: ellipsis) treatment is
   replaced by these scrolling windows.
   ════════════════════════════════════════════════════════════════ */
// smoothGap / songFadePx are the music player's (the song card's lines scroll like it);
// fadePx is the narrower names'.
const MQ = { speed: 50, fadePx: 8, songFadePx: 12, pauseStart: 2000, easeMs: 650, smoothGap: 32, holdEnd: 900, fadeMs: 100, homeHold: 40 };
const MQ_V_CRUISE = MQ.speed / 1000;              // px per ms cruise velocity
const MQ_A_RAMP   = MQ_V_CRUISE / MQ.easeMs;      // px per ms² fixed accel/decel

// Total time to cover distance D under the shared accel → cruise → decel profile.
function mqScrollMs(D) {
	if (D <= 0) return 0;
	if (D >= MQ_V_CRUISE * MQ.easeMs) return D / MQ_V_CRUISE + MQ.easeMs;   // trapezoid
	return 2 * Math.sqrt(D / MQ_A_RAMP);                                    // triangle (too short to cruise)
}
// How far a line of distance D has moved `st` ms into its scroll (capped at D).
function mqTravel(D, st) {
	if (D <= 0 || st <= 0) return 0;
	const T = mqScrollMs(D); if (st >= T) return D;
	if (D >= MQ_V_CRUISE * MQ.easeMs) {
		const E = MQ.easeMs;
		if (st < E)     return 0.5 * MQ_A_RAMP * st * st;                          // accelerate
		if (st < T - E) return 0.5 * MQ_V_CRUISE * E + MQ_V_CRUISE * (st - E);     // cruise
		const q = T - st; return D - 0.5 * MQ_A_RAMP * q * q;                      // decelerate
	}
	const half = T / 2;
	if (st < half) return 0.5 * MQ_A_RAMP * st * st;
	const q = T - st; return D - 0.5 * MQ_A_RAMP * q * q;
}

const mqActive = [];   // live marquee runtime objects, ticked by one shared rAF loop

// Build the HTML for a marquee window. `smooth` lays down two wrapped copies;
// every other mode uses a single run. data-mq-mode is read back at measure time.
function marqueeHTML(text, { mode = 'fadeswap', fade = true, cls = '' } = {}) {
	const safe = escapeHtml(text == null ? '' : String(text));
	const winCls = 'mq' + (fade ? ' fade' : '') + (cls ? ' ' + cls : '');
	if (mode === 'smooth') {
		return `<div class="${winCls}" data-mq-mode="smooth"><span class="mq-inner" style="display:inline-flex;gap:${MQ.smoothGap}px">` +
			`<span class="mq-copy">${safe}</span><span class="mq-copy" aria-hidden="true">${safe}</span></span></div>`;
	}
	return `<div class="${winCls}" data-mq-mode="${mode}"><span class="mq-inner">${safe}</span></div>`;
}

// A fade-scroll username marquee element, used everywhere a username used to
// truncate with "…". Returns the .mq node ready to drop in place of a #username span.
/* Outline ink for a username: its own colour taken right down, instead of flat black.
   Keeping the hue means the antialiased edges blend toward a dark version of the name
   rather than toward neutral, so the name reads as itself instead of as a greyed-out
   version of itself. Accepts either form usernameChatColor can return (#rrggbb passed
   through, or the rgb() a tamed colour becomes). */
function usernameInk(color) {
	if (typeof color !== 'string') return null;
	let r, g, b;
	const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
	if (hex) {
		let h = hex[1];
		if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
		[r,g,b] = [0,2,4].map(i => parseInt(h.slice(i,i+2),16));
	} else {
		const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
		if (!m) return null;
		[r,g,b] = [1,2,3].map(i => parseFloat(m[i]));
	}
	const k = USERNAME_INK_SCALE;
	return `rgb(${Math.round(r*k)}, ${Math.round(g*k)}, ${Math.round(b*k)})`;
}

function usernameMarquee(text, color) {
	const tpl = document.createElement('template');
	tpl.innerHTML = marqueeHTML(text, { mode: 'fadeswap', fade: true, cls: 'name-mq' }).trim();
	const mq = tpl.content.firstElementChild;
	if (color) {
		mq.style.color = color;
		// Inherited by .mq-inner, where the text-shadow ring and the extrude both read
		// var(--o-colour). Harmless on event cards, which carry no outline.
		const ink = usernameInk(color);
		if (ink) {
			mq.style.setProperty('--o-colour', ink);
			if (_oTextExtrudeTemplate) mq.style.setProperty('--o-text-extrude', _oTextExtrudeTemplate);
		}
	}
	return mq;
}

// Apply the edge fade by writing the mask gradient INLINE (l, r are 0→1 fade
// presence per edge). We set the full mask-image string rather than driving a
// registered @property inside a CSS calc(): Chromium doesn't reliably repaint a
// mask gradient when only the custom property changes, so on stacked cards all
// but the first rendered a hard clip instead of the fade. The band width is a
// fixed m.fadePx (px, not %: MQ.fadePx on names, so it stays soft on the narrow
// ~80px name windows, and the music player's MQ.songFadePx on song lines).
function mqApplyFade(m, l, r) {
	if (!m.fade) return;
	let g = '';   // '' → no mask (no fade) when the line doesn't overflow
	if (m.O > 0) {
		const lp = (l * m.fadePx).toFixed(2), rp = (r * m.fadePx).toFixed(2);
		g = `linear-gradient(90deg, transparent 0, #000 ${lp}px, #000 calc(100% - ${rp}px), transparent 100%)`;
	}
	if (g === m._mask) return;   // skip redundant style writes
	m._mask = g;
	m.win.style.webkitMaskImage = g;
	m.win.style.maskImage = g;
}

function mqSetEdgeFade(m, off) {   // off ≤ 0; grows the left / right fade with overflow
	const l = m.O ? Math.min(1, (-off) / m.fadePx) : 0;
	const r = m.O ? Math.min(1, (m.O + off) / m.fadePx) : 0;
	mqApplyFade(m, l, r);
}

/* Transform / opacity are re-written every frame while a line is moving, but a
   marquee spends most of its cycle parked (the 2s rest at home, the hold at the
   end, and the whole of every non-overflowing line). Remembering the last value
   written skips the style write — and, for opacity, the toFixed() allocation —
   for those stretches. Rounding the offset to 1/100 px also lets the tail of an
   ease, where consecutive frames differ by far less than that, settle instead of
   writing a new transform for motion nobody can see. */
function mqSetTransform(m, off) {
	const v = Math.round(off * 100) / 100;
	if (v === m._off) return;
	m._off = v;
	m.inner.style.transform = `translateX(${v}px)`;
}
function mqSetOpacity(m, op) {
	if (op === m._op) return;
	m._op = op;
	m.inner.style.opacity = op.toFixed(3);
}

function mqTickSmooth(m, t) {
	if (m.O <= 0) { mqSetTransform(m, 0); mqApplyFade(m, 0, 0); return; }
	const tt = t % m.group.cycle;
	const off = tt < MQ.pauseStart ? 0 : -mqTravel(m.unit, tt - MQ.pauseStart);
	mqSetTransform(m, off);
	const d = Math.min(-off, m.unit + off);   // distance from the nearest home edge
	mqApplyFade(m, Math.max(0, Math.min(1, d / m.fadePx)), 1);   // wrapped copy always overflows the right
}

function mqTickFadeswap(m, t) {
	if (m.O <= 0) { mqSetTransform(m, 0); mqSetOpacity(m, 1); mqSetEdgeFade(m, 0); return; }
	const tt = t % m.group.cycle;
	const s0 = MQ.pauseStart, s1 = s0 + m.group.scrollDur, s2 = s1 + MQ.holdEnd, s3 = s2 + MQ.fadeMs, s4 = s3 + MQ.homeHold;
	let off = 0, op = 1;
	if (tt < s0)      { off = 0;  op = 1; }
	else if (tt < s1) { off = -mqTravel(m.O, tt - s0); op = 1; }              // cruise (caps at -O, holds)
	else if (tt < s2) { off = -m.O; op = 1; }                                // hold at end
	else if (tt < s3) { off = -m.O; op = 1 - (tt - s2) / MQ.fadeMs; }         // fade out
	else if (tt < s4) { off = 0;  op = 0; }                                   // reset home, hidden
	else              { off = 0;  op = Math.min(1, (tt - s4) / MQ.fadeMs); }  // fade in
	mqSetTransform(m, off);
	mqSetOpacity(m, op);
	mqSetEdgeFade(m, off);
}

function mqTickPark(m, t) {
	const off = (m.O > 0 && t > MQ.pauseStart) ? -mqTravel(m.O, t - MQ.pauseStart) : 0;
	mqSetTransform(m, off); mqSetEdgeFade(m, off);
}

function mqTick(m, t) {
	switch (m.mode) {
		case 'smooth':   mqTickSmooth(m, t); break;
		case 'fadeswap': mqTickFadeswap(m, t); break;
		default:         mqTickPark(m, t); break;
	}
}

// The loop only runs while something is actually scrolling — see mqEnsureRunning.
let mqRunning = false;

function mqLoop(now) {
	for (let i = mqActive.length - 1; i >= 0; i--) {
		const m = mqActive[i];
		if (!m.win.isConnected) { mqActive.splice(i, 1); continue; }   // card was removed → drop it
		if (!m.group || !m.group.ready) continue;
		mqTick(m, now - m.group.t0);
		// A line that fits its window never moves: overflow is measured once, so
		// after the single tick that puts it in its resting state there is nothing
		// left to animate. Most usernames fit, so this retires the large majority
		// of marquees instead of re-writing the same styles for them every frame.
		if (m.O <= 0) mqActive.splice(i, 1);
	}
	if (mqActive.length) requestAnimationFrame(mqLoop);
	else mqRunning = false;   // idle overlay → no loop at all until the next card
}
// Started on demand by startCardMarquees so an overlay with no scrolling text
// costs nothing per frame.
function mqEnsureRunning() {
	if (mqRunning) return;
	mqRunning = true;
	requestAnimationFrame(mqLoop);
}

/* Gift-sub two-name width sharing (max-min fairness), from the same marquee model:
     both fit        → each takes exactly what it needs (no scroll)
     one short/long  → short takes what it needs, long gets the rest
     both over half  → an even 50/50 split
   Run before measuring so each name's window width feeds its own overflow. */
function mqNaturalW(win) { const inner = win.querySelector('.mq-inner'); return inner ? inner.scrollWidth : win.scrollWidth; }
function mqFairSplit(avail, n1, n2) {
	if (n1 + n2 <= avail) return [n1, n2];
	const half = avail / 2;
	if (n1 <= half) return [n1, avail - n1];
	if (n2 <= half) return [avail - n2, n2];
	return [half, half];
}
function allocateGiftRow(root) {
	const content = root.querySelector('.sub-user-content.is-gift');
	if (!content) return;
	const cellA = content.querySelector('.gift-sender');
	const cellB = content.querySelector('#gift-receiver');
	const textA = cellA && cellA.querySelector('.mq');
	const textB = cellB && cellB.querySelector('.mq');
	if (!cellA || !cellB || !textA || !textB) return;
	// collapse both names to 0 so each cell reports just its fixed part
	// (avatar · platform · arrow), read the usable width, then share it.
	textA.style.flex = '0 0 auto'; textA.style.width = '0px';
	textB.style.flex = '0 0 auto'; textB.style.width = '0px';
	cellA.style.flex = '0 0 auto'; cellB.style.flex = '0 0 auto';
	const availText = Math.max(0, content.clientWidth - cellA.offsetWidth - cellB.offsetWidth);
	const [wA, wB] = mqFairSplit(availText, mqNaturalW(textA), mqNaturalW(textB));
	textA.style.width = Math.floor(wA) + 'px';
	textB.style.width = Math.floor(wB) + 'px';
}

// Discover every .mq in a freshly-added card, build its runtime object, measure
// overflow, and start the card's shared clock. One timing group per card.
function startCardMarquees(root) {
	// Safe to run again on the same card (see AddMessageItem): its old runtime
	// objects are dropped first, so a re-measure never doubles up.
	for (let i = mqActive.length - 1; i >= 0; i--) if (root.contains(mqActive[i].win)) mqActive.splice(i, 1);
	allocateGiftRow(root);   // share gift-name widths first, then measure overflow
	// A song card's lines run on their own clock, as in the music player: rest, then
	// each clipped line wraps once round, the longest setting the loop. The names on
	// the card share the card's clock (scroll to the end, fade back to the start).
	const all = [...root.querySelectorAll('.mq')];
	const isSong = (w) => !!w.closest('.music-ui-container');
	for (const wins of [all.filter(w => !isSong(w)), all.filter(isSong)]) if (wins.length) startMarqueeGroup(wins);
	mqEnsureRunning();
}

// One timing group: its lines are measured once, and loop together.
function startMarqueeGroup(wins) {
	const group = { scrollDur: 0, fadeTail: 0, cycle: 4000, t0: performance.now(), ready: false };
	let maxDist = 0, hasFade = false;
	wins.forEach(win => {
		const mode = win.dataset.mqMode || 'park';
		const m = { win, inner: win.querySelector('.mq-inner'), fade: win.classList.contains('fade'), mode, group, O: 0, unit: 0,
		            fadePx: mode === 'smooth' ? MQ.songFadePx : MQ.fadePx };
		// clientWidth is the PADDING box, but the text is laid out from the CONTENT box,
		// so a padded window (the outline needs one — see .contrast-outline .mq) has
		// paddingLeft less room than clientWidth suggests. Without this the last few px
		// of a long name never scroll into view.
		const padL = parseFloat(getComputedStyle(win).paddingLeft) || 0;
		if (m.mode === 'smooth') {
			const copies = win.querySelectorAll('.mq-copy');
			const copyW = copies[0] ? copies[0].offsetWidth : m.inner.scrollWidth;
			m.O = Math.max(0, Math.round(copyW - win.clientWidth + padL));
			m.unit = copyW + MQ.smoothGap;
			// only reveal the wrapped 2nd copy when the text actually overflows
			if (copies[1]) copies[1].style.display = m.O > 0 ? '' : 'none';
			if (m.O > 0) maxDist = Math.max(maxDist, m.unit);
		} else {
			m.O = Math.max(0, Math.round(m.inner.scrollWidth - win.clientWidth + padL));
			if (m.O > 0) { maxDist = Math.max(maxDist, m.O); if (m.mode === 'fadeswap') hasFade = true; }
		}
		mqActive.push(m);
	});
	// the longest line sets the card's scroll time; shorter siblings reach their
	// end sooner and hold there until the whole card loops together.
	group.scrollDur = mqScrollMs(maxDist);
	group.fadeTail = hasFade ? (MQ.holdEnd + MQ.fadeMs + MQ.homeHold + MQ.fadeMs) : 0;
	group.cycle = MQ.pauseStart + group.scrollDur + group.fadeTail;
	group.ready = true;
}

/* ════════════════════════════════════════════════════════════════
   Word-by-word reveal for message bodies.

   NOT a typewriter, deliberately. AddMessageItem measures the finished message
   in a hidden container and then animates the line's height from 0 to that
   measured value, so text that grows as it "types" would re-wrap underneath a
   height measured for the finished text and the box would be wrong for most of
   the reveal. This is paint-only instead: the message is fully laid out from the
   first frame and each word just fades and rises into place.

   Keeping it layout-neutral is what the splitting below is careful about:
     · runs of whitespace stay as raw text nodes, so line breaking is untouched
     · a word becomes an inline-block, which changes nothing — a word was already
       the unit a line breaks on
     · an emote <img> reveals as one unit rather than being descended into
     · .mq subtrees are left alone: those are the scrolling marquee windows, and
       their widths have just been measured by startCardMarquees
   ════════════════════════════════════════════════════════════════ */
const WRITE = { step: 34, total: 420 };   // per-word stagger, and the cap on the whole reveal

// Replace text nodes with per-word spans, collecting them in document order.
function writeCollectWords(node, out) {
	for (const kid of Array.from(node.childNodes)) {
		if (kid.nodeType === Node.TEXT_NODE) {
			const frag = document.createDocumentFragment();
			for (const part of kid.data.split(/(\s+)/)) {      // keeps the separators
				if (!part) continue;
				if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
				const w = document.createElement('span');
				w.className = 'write-word';
				w.textContent = part;
				frag.appendChild(w);
				out.push(w);
			}
			node.replaceChild(frag, kid);
		} else if (kid.nodeType === Node.ELEMENT_NODE) {
			if (kid.classList.contains('mq')) continue;                                  // scrolling window — leave it be
			if (kid.tagName === 'IMG') { kid.classList.add('write-word'); out.push(kid); }  // emote = one unit
			else writeCollectWords(kid, out);
		}
	}
}

// Long messages tighten their step rather than taking seconds to become readable.
function writeInElement(el) {
	if (!el) return;
	const words = [];
	writeCollectWords(el, words);
	if (!words.length) return;
	el.classList.add('write-in');
	const step = Math.min(WRITE.step, WRITE.total / words.length);
	words.forEach((w, i) => { w.style.animationDelay = Math.round(i * step) + 'ms'; });
}

// The message bodies that get the reveal. Event-card headers ("Subscribed With
// Tier 1") are left alone — they're short labels, not something being said.
function writeInMessage(root) {
	writeInElement(root.querySelector('#message'));
	writeInElement(root.querySelector('.featured-message-text'));
	writeInElement(root.querySelector('.sub-comment-text'));
}

// onMeasured runs in the hidden measure pass, while the card is laid out but not
// yet on screen; onAdded runs on the frame it starts animating in. Anything with a
// one-off setup cost belongs in onMeasured, so the cost doesn't land on the same
// frame as the appear.
function AddMessageItem(element, elementID, platform, userId, customClasses = [], onAdded = null, onMeasured = null) {
	const tempContainer = document.createElement('div');
	// Measured at the list's own width (it fills the source, or the receipt).
	tempContainer.style.cssText = `position:absolute; left:0; right:0; visibility:hidden; pointer-events:none;`;
	
	const tempLi = document.createElement('li');
	tempLi.style.cssText = 'height:auto !important; transition:none !important; opacity:1 !important; display:block !important;';
	
	customClasses.forEach(cls => tempLi.classList.add(cls));
	
	tempLi.appendChild(element);
	tempContainer.appendChild(tempLi);
	
	const msgList = document.getElementById('messageList');
	msgList.appendChild(tempContainer);

	setTimeout(function () {
		const calculatedHeight = tempLi.offsetHeight + "px";

		// Still hidden here, and the layout the measurement above needed is already
		// done — the cheapest moment to do any heavy per-card setup. The children are
		// moved into the real line below without ever leaving the document, so a
		// canvas warmed here keeps its pixels.
		if (onMeasured) onMeasured(tempLi);

		const lineItem = document.createElement('li');
		lineItem.id = elementID;
		lineItem.dataset.platform = platform;
		lineItem.dataset.userId = userId;
		customClasses.forEach(cls => lineItem.classList.add(cls));
		// The settings preview's demo chat gives way to the first real message.
		if (String(elementID).startsWith('demo-')) lineItem.classList.add('demo');
		else if (previewMode) msgList.querySelectorAll('li.demo').forEach(li => li.remove());

		while (tempLi.firstChild) {
			lineItem.appendChild(tempLi.firstChild);
		}
		
		msgList.removeChild(tempContainer);
		msgList.appendChild(lineItem);

		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				lineItem.classList.add("show");
				lineItem.style.height = calculatedHeight;
				// Once open, let the line size itself again, so a source resized later
				// (the chat fills its width) reflows the text instead of clipping it.
				lineItem.addEventListener('transitionend', function open(e) {
					if (e.target !== lineItem || e.propertyName !== 'height') return;
					lineItem.removeEventListener('transitionend', open);
					lineItem.style.height = 'auto';
					lineItem.classList.add('open');
				});
				if (onAdded) onAdded(lineItem);
				// Every line, not just event cards: plain chat usernames are fade-scroll
				// windows too, and they need measuring once they're in the real layout.
				// startCardMarquees no-ops on a line that contains no .mq window.
				startCardMarquees(lineItem);
				// A face still loading (the first 700 or 600 text after the source
				// starts) measures in the fallback font: measure again once it's in.
				if (document.fonts.status !== 'loaded') document.fonts.ready.then(() => startCardMarquees(lineItem));
				// Split the body into words on the same frame the line starts opening,
				// so both animations run off one clock. After the marquees, so their
				// widths are measured on untouched markup.
				writeInMessage(lineItem);
			});
		});

		while (msgList.clientHeight > 5 * window.innerHeight) {
			if (msgList.firstChild) msgList.removeChild(msgList.firstChild);
			else break;
		}

	}, 50);
}

function AddSubCardItem(element, elementID, platform, userId) {
	// The borders are set up in the measure pass, not on the frame the card appears.
	// Sizing a canvas allocates a backing store — ~0.6-0.8 MB each here, and a card
	// with a comment has two — and doing that plus the first noise draw on the same
	// frame the line starts opening is what made bordered cards hitch on their way
	// in. By the time the card is shown its pixels already exist and are painted.
	//
	// The scrolling name / song-info marquees stay in the shown pass: they measure
	// text against the real layout, which the hidden pass can't stand in for.
	AddMessageItem(element, elementID, platform, userId, ['sub-card-li'], null, (li) => {
		const tryInitBorder = (canvas, wrapper, extension, retries = 5) => {
			if (!canvas || !wrapper) return;
			const w = wrapper.offsetWidth, h = wrapper.offsetHeight;
			if (w > 0 && h > 0) initBoilingBorder(canvas, wrapper, extension);
			else if (retries > 0) setTimeout(() => tryInitBorder(canvas, wrapper, extension, retries - 1), 50);
		};

		const mainCanvas = li.querySelector('.sub-border-canvas');
		const mainWrapper = li.querySelector('.sub-card-wrapper');
		const commentWrapperEl = li.querySelector('.sub-comment-wrapper');
		// With an attachment the header runs 32px on under it (Figma's -32px overlap).
		const extension = (commentWrapperEl && commentWrapperEl.style.display !== 'none') ? 32 : 0;
		tryInitBorder(mainCanvas, mainWrapper, extension);

		const commentCanvas = li.querySelector('.sub-comment-border-canvas');
		if (commentCanvas && commentWrapperEl && commentWrapperEl.style.display !== 'none') tryInitBorder(commentCanvas, commentWrapperEl, 0);
	});
}

function GetBooleanParam(paramName, defaultValue) {
	const val = new URLSearchParams(window.location.search).get(paramName);
	if (val === null) return defaultValue;
	return val.toLowerCase() === 'true';
}

function GetIntParam(paramName) {
	const val = parseInt(new URLSearchParams(window.location.search).get(paramName), 10);
	return isNaN(val) ? null : val;
}

function GetFloatParam(paramName) {
	const val = parseFloat(new URLSearchParams(window.location.search).get(paramName));
	return isNaN(val) ? null : val;
}

function GetCurrentTimeFormatted() {
	const now = new Date();
	let hours = now.getHours();
	const minutes = String(now.getMinutes()).padStart(2, '0');
	const ampm = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12; hours = hours ? hours : 12;
	return `${hours}:${minutes} ${ampm}`;
}

async function GetAvatar(username, providedUrl, platform) {
	if (providedUrl) return providedUrl;
	if (platform === 'twitch') {
		if (avatarMap.has(username)) {
			return avatarMap.get(username);
		} else {
			try {
				let response = await fetch('https://decapi.me/twitch/avatar/' + username);
				if (response.ok) {
					let data = await response.text();
					if (data && data.startsWith('http')) {
						avatarMap.set(username, data);
						return data;
					}
				}
			} catch (e) {
				console.error("Avatar Fetch failed:", e);
			}
		}
	}
	return `https://api.dicebear.com/7.x/thumbs/svg?seed=${encodeURIComponent(username)}&backgroundColor=b6e3f4,c0aede,d1d4f9`;
}

function escapeHtml(text) {
	const div = document.createElement('div');
	div.innerText = text;
	return div.innerHTML;
}

function linkify(text) {
	return text.replace(/(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig, '<a href="$1" target="_blank">$1</a>');
}

function IsImageUrl(url) {
	try {
		const { pathname } = new URL(url);
		return /\.(png|jpe?g|webp|gif)$/i.test(pathname);
	} catch (error) {
		return false;
	}
}

function IsThisUserAllowedToPostImagesOrNotReturnTrueIfTheyCanReturnFalseIfTheyCannot(targetPermissions, data, platform) {
	return GetPermissionLevel(data, platform) >= targetPermissions;
}

function GetPermissionLevel(data, platform) {
	switch (platform) {
		case 'twitch':
			if (data.message.role >= 4) return 40;
			else if (data.message.role >= 3) return 30;
			else if (data.message.role >= 2) return 20;
			else if (data.message.role >= 2 || data.message.subscriber) return 15;
			else return 10;
		case 'youtube':
			if (data.user.isOwner) return 40;
			else if (data.user.isModerator) return 30;
			else if (data.user.isSponsor) return 15;
			else return 10;
	}
}

// ============================================================
//  Song lookup (no API key, no server, runs in the browser)
//
//  A redemption is free text a viewer typed: "Robbery '95 - Necro",
//  "Miitopia OST - Extra Battle (Cyberpunk)", "Billie Jeans - Micheal Jackson".
//  Rather than guess which half is the title, the whole string is searched — the
//  way a person would paste it into a search box — against YouTube Music (clean
//  Title/Artist fields, commercial catalogue) and YouTube (game OSTs, remixes,
//  bootlegs: everything a label never released). Both are reached through Piped,
//  a CORS-enabled mirror, so this still works from an OBS browser source.
//
//  Every result is then SCORED against the words the viewer typed, and anything
//  that doesn't clear the floor is refused: a card that invents a song is worse
//  than no card. MusicBrainz and iTunes stay in the pipeline, demoted to what
//  they are good at — naming the original release and supplying cover art.
// ============================================================

function FormatSongDuration(ms) {
	if (!ms) return '?:??';
	const total = Math.round(ms / 1000);
	const m = Math.floor(total / 60);
	const s = String(total % 60).padStart(2, '0');
	return `${m}:${s}`;
}

// Strip the usual junk from a video title: "(Official Video)", "[Audio]", etc.
function CleanTrackTitle(t) {
	const junk = /official|video|audio|lyric(?:s)?|visuali[sz]er|remaster(?:ed)?|\bhd\b|\b4k\b|\bmv\b|m\/v|explicit|music\s*video|color\s*coded/i;
	return (t || '')
		.replace(/\(([^()]*)\)/g, (full, inner) => junk.test(inner) ? '' : full)
		.replace(/\[([^\[\]]*)\]/g, (full, inner) => junk.test(inner) ? '' : full)
		.replace(/\s{2,}/g, ' ')
		.trim();
}

// A featured artist is usually credited on the request but not in the track's own
// title ("Du ik værd at græde for (feat. Sira Jovina)" is published as "Du ik værd
// at græde for"). Requiring those words would score the real track below anything
// that happens to repeat them — a reaction video, say.
const SONG_FEAT_PART = /[\(\[]\s*(?:feat|ft|featuring|w\/|med)\b\.?[^)\]]*[\)\]]|\s+(?:feat|ft|featuring)\b\.?\s+.*$/gi;
const StripFeat = s => (s || '').replace(SONG_FEAT_PART, ' ').replace(/\s{2,}/g, ' ').trim();

const songNorm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[‘’“”]/g, "'");
const songTokens = s => songNorm(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
const songUniq = a => [...new Set(a)];

// Chat misspells. "Billie Jeans - Micheal Jackson" is a letter off in two words and
// YouTube's own search corrects it — so the scorer must not then punish the correct
// answer for not matching the typo. Tolerance scales with word length; short words
// (du, ik, at, for) must still match exactly or everything looks like everything.
function EditDistance(a, b) {
	const m = a.length, n = b.length;
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		const cur = [i];
		for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		prev = cur;
	}
	return prev[n];
}
const editSlack = n => (n >= 7 ? 2 : n >= 4 ? 1 : 0);
function FuzzyHas(list, t) {
	for (const r of list) {
		if (r === t) return true;
		const lim = editSlack(Math.max(r.length, t.length));
		if (lim && Math.abs(r.length - t.length) <= lim && EditDistance(r, t) <= lim) return true;
	}
	return false;
}

// Token F1 between the request and a candidate's "title + artist", feature credits
// stripped from BOTH sides — the catalogue entry spells every guest out and must not
// be punished for being complete. Recall alone would let a bloated title win;
// precision alone would let a one-word title win.
function ScoreMatch(candidateText, requestText) {
	const req = songUniq(songTokens(StripFeat(requestText)));
	const cand = songUniq(songTokens(StripFeat(candidateText)));
	if (!req.length || !cand.length) return 0;
	const precision = cand.filter(t => FuzzyHas(req, t)).length / cand.length;
	const recall = req.filter(t => FuzzyHas(cand, t)).length / req.length;
	return (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;
}

// Uploads that are ABOUT a song rather than the song. They carry both artist names
// and the full title, so they out-score the real track on words alone.
const NOT_THE_SONG = /\b(reaction|reakt\w*|reagerer|react(?:s|ing)?|review|anmeldelse|explained|breakdown|analysis|tutorial|karaoke|lesson|interview|first time (?:hearing|listening)|cover(?:ed)? by)\b/i;

// MusicBrainz lists a credit in its own order ("Berg, Svea S, Sofie1998"); the music
// apps lead with the track's primary artist ("Sofie1998, Berg, Svea S"). Only
// genuinely new names are appended, so "Tyler, The Creator" is never torn in two.
function MergeCredit(primary, credit) {
	const names = (credit || '').split(/\s*(?:,|&|\band\b|\bog\b)\s*/i).map(n => n.trim()).filter(Boolean);
	const have = songTokens(primary);
	const extra = names.filter(n => { const t = songTokens(n)[0]; return t && !FuzzyHas(have, t); });
	return extra.length ? [primary, ...extra].join(', ') : primary;
}

// ── Network ────────────────────────────────────────────────────────────────
// One cache for the browser source's lifetime: the artist-credit and the album come
// from the SAME MusicBrainz URL, and without this each would spend its own request —
// two a second is how you earn a 503, and a 503 reads as "song not found".
const _songCache = new Map();
let _lastMusicBrainz = 0;

async function SongFetch(url, timeoutMs = 5000) {
	const cached = _songCache.get(url);
	if (cached) return { ok: true, status: 200, json: async () => JSON.parse(cached || '{}'), text: async () => cached };

	const isMB = /musicbrainz\.org/.test(url);
	let resp, body;
	for (let attempt = 0; attempt < 2; attempt++) {
		// MusicBrainz allows ~1 request/second and answers 503 both above that and when
		// it is simply busy. A 503 comes back fast and is worth retrying; a silent stall
		// just costs a second full deadline, so it isn't.
		if (isMB) {
			const wait = Math.max(0, 1300 - (Date.now() - _lastMusicBrainz));
			if (wait) await new Promise(r => setTimeout(r, wait));
			_lastMusicBrainz = Date.now() + 1;
		}
		const ctl = new AbortController();
		const kill = setTimeout(() => ctl.abort(), timeoutMs);
		try { resp = await fetch(url, { signal: ctl.signal }); }
		catch (e) { console.debug('[song] request failed', url, e.name); return { ok: false, status: 0, json: async () => ({}), text: async () => '' }; }
		finally { clearTimeout(kill); }
		body = await resp.text();
		if (resp.status !== 503 || !isMB) break;
		console.debug('[song] MusicBrainz 503, retrying');
		await new Promise(r => setTimeout(r, 1500));
	}
	if (resp.ok) {
		if (_songCache.size > 200) _songCache.clear();
		_songCache.set(url, body);
	}
	return { ok: resp.ok, status: resp.status, json: async () => JSON.parse(body || '{}'), text: async () => body };
}

// A source that hasn't answered by its deadline has nothing to say. MusicBrainz is
// the slow one and is only ever a second opinion; without this the card waits on it
// even when YouTube Music has already answered.
function withDeadline(promise, ms) {
	let timer;
	return Promise.race([
		promise.catch(() => null).finally(() => clearTimeout(timer)),
		new Promise(res => { timer = setTimeout(() => res(null), ms); })
	]);
}

// Resolve true only if the image URL actually loads (catches dead Cover Art Archive
// links, 404s, hotlink refusals). Times out so a slow source can't stall the card.
function ImageLoads(url, timeoutMs = 2000) {
	return new Promise(resolve => {
		if (!url) return resolve(false);
		const img = new Image();
		let settled = false;
		const finish = ok => { if (!settled) { settled = true; resolve(ok); } };
		img.onload = () => finish(img.naturalWidth > 1);
		img.onerror = () => finish(false);
		setTimeout(() => finish(false), timeoutMs);
		img.src = url;
	});
}

// Start every candidate loading in PARALLEL, then resolve in priority order: returns
// the highest-priority URL that loads, so a slow/dead first candidate doesn't block.
async function ResolveAlbumArt(candidates, timeoutMs) {
	const checks = candidates.map(url => (url ? ImageLoads(url, timeoutMs) : Promise.resolve(false)));
	for (let i = 0; i < candidates.length; i++) {
		if (candidates[i] && await checks[i]) return candidates[i];
	}
	return '';
}

// ── YouTube Music / YouTube, through Piped ─────────────────────────────────
const PIPED_HOSTS = [
	'https://pipedapi.ducks.party',
	'https://api.piped.private.coffee',
	'https://pipedapi.kavin.rocks'
];

// YouTube Music serves the same artwork file for a track and for the album it belongs
// to, so the cover URL doubles as an album id.
const CoverId = u => (u || '').replace(/^https?:\/\/[^/]+\//, '').split('=')[0].split('?')[0];

// Piped proxies its thumbnails. Ask that proxy for a bigger copy first, then the copy
// it gave us, then YouTube's own video thumbnail — first one that loads wins.
function ThumbCandidates(thumb, watchUrl) {
	const out = [];
	if (thumb) {
		out.push(thumb.replace(/=w\d+-h\d+/, '=w544-h544'));
		out.push(thumb);
	}
	const id = (watchUrl || '').match(/v=([\w-]+)/);
	if (id) out.push(`https://i.ytimg.com/vi/${id[1]}/hqdefault.jpg`);
	return out;
}

async function PipedSearch(query, filter) {
	for (const host of PIPED_HOSTS) {
		let j;
		try {
			const r = await SongFetch(`${host}/search?q=${encodeURIComponent(query)}&filter=${filter}`, 6000);
			if (!r.ok) continue;
			j = await r.json();
		} catch (e) { continue; }
		const items = (j.items || []).filter(i => i.title && (i.duration || 0) > 0).slice(0, 6);
		if (!items.length) return [];
		return items.map(i => ({
			title: i.title.trim(),
			coverId: CoverId(i.thumbnail),
			artist: (i.uploaderName || '').replace(/\s*-\s*Topic$/i, '').trim(),
			durationMs: (i.duration || 0) * 1000,
			artCandidates: ThumbCandidates(i.thumbnail, i.url),
			via: filter === 'music_songs' ? 'YT Music' : 'YouTube'
		}));
	}
	console.debug('[song] every Piped instance failed');
	return [];
}

// `byArtist`: also accept the top album credited to this artist. YouTube Music ranks
// the album search by relevance to the query — which names the track — so for
// "Bliv hvor du er - Rosa" the one album by Rosa that comes back is the one holding
// it. The artist check is what keeps "Den nye pige - Blæst" out of Ramasjang's
// "Cirkus Summarum 2026".
async function AlbumSearch(query, coverId, byArtist) {
	for (const host of PIPED_HOSTS) {
		let j;
		try {
			const r = await SongFetch(`${host}/search?q=${encodeURIComponent(query)}&filter=music_albums`, 6000);
			if (!r.ok) continue;
			j = await r.json();
		} catch (e) { continue; }
		const items = j.items || [];
		const wrap = i => ({ album: i.name || i.title || '', artCandidates: ThumbCandidates(i.thumbnail, i.url) });
		const byCover = items.find(i => CoverId(i.thumbnail) === coverId);
		if (byCover) return wrap(byCover);
		if (byArtist) {
			const same = items.find(i => i.uploaderName && ScoreMatch(i.uploaderName, byArtist) >= 0.6);
			if (same) return wrap(same);
		}
		return null;
	}
	return null;
}

// A track's cover is often its single's, not its album's, so the cover match alone
// isn't enough; and a feature credit in the query narrows the album search to nothing.
async function YouTubeMusicAlbum(query, coverId, artist, trustArtistMatch) {
	if (!coverId) return null;
	let hit = await AlbumSearch(query, coverId, trustArtistMatch ? artist : null);
	const bare = StripFeat(query);
	if (!hit && bare && bare !== query) hit = await AlbumSearch(bare, coverId, trustArtistMatch ? artist : null);
	if (!hit && artist) hit = await AlbumSearch(artist, coverId);
	return hit;
}

// ── MusicBrainz / iTunes: the original release, and the full credit ────────
// Reissues, best-ofs and remaster compilations are rejected outright: taking
// releases[0] of recordings[0] is how "Spokesman" ended up on a 2005 best-of and
// "Robbery '95" picked up the cover of a 2020 remaster nobody asked for.
const BAD_SECONDARY = /compilation|live|dj-mix|mixtape|interview|audiobook|spokenword|remix/i;
const BAD_RELEASE_TITLE = /\b(best of|greatest hits|anthology|essential|very best|remaster(?:ed)?)\b/i;
const RELEASE_RANK = { Album: 0, EP: 1, Single: 2 };
const CoverArt = id => `https://coverartarchive.org/release/${id}/front-500`;

async function MusicBrainzOriginal(rawTitle, artist) {
	const title = StripFeat(rawTitle) || rawTitle;   // a credit in the title matches nothing
	const query = artist ? `recording:"${title}" AND artist:"${artist}"` : `recording:"${title}"`;
	// limit=100, not 25: for a track with dozens of reissues (Billie Jean) the original
	// album ranks below the first 25 rows and a smaller page misses it entirely.
	const resp = await SongFetch('https://musicbrainz.org/ws/2/recording/?fmt=json&limit=100&query=' + encodeURIComponent(query), 5000);
	if (!resp.ok) return null;
	const recs = (await resp.json()).recordings || [];
	if (!recs.length) return null;

	// The full artist credit, worth having even when no release survives the filter:
	// the credit and the album are separate questions and this response answers both.
	let credit = '';
	for (const rec of recs.slice(0, 5)) {
		const c = (rec['artist-credit'] || []).map(a => a.name).join(', ');
		if (c && FuzzyHas(songTokens(c), songTokens(artist)[0] || '')) { credit = c; break; }
	}

	const seen = new Set(), keep = [];
	for (const rec of recs) {
		const rc = (rec['artist-credit'] || []).map(a => a.name).join(', ');
		for (const rel of rec.releases || []) {
			const rg = rel['release-group'] || {};
			if (BAD_SECONDARY.test((rg['secondary-types'] || []).join(', ')) || BAD_RELEASE_TITLE.test(rel.title || '')) continue;
			if (seen.has(rel.id)) continue;
			seen.add(rel.id);
			keep.push({
				id: rel.id, album: rel.title || '', recTitle: rec.title || '', artist: rc,
				durationMs: rec.length || 0, rank: RELEASE_RANK[rg['primary-type']] ?? 3,
				date: rel.date || rg['first-release-date'] || '9999'
			});
		}
	}
	if (!keep.length) return { credit, title: recs[0].title || '', artist: credit, album: '', durationMs: 0, artCandidates: [] };

	// Earliest release wins — except that a single released as part of an album campaign
	// should credit the album, and the same calendar year is the tell: "Monster" and "My
	// Beautiful Dark Twisted Fantasy" are both 2010 (album), while "Die With A Smile"
	// (2024) stood alone until MAYHEM (2025) (single). Partial dates pad with 99 so a
	// bare year sorts after a dated release in the same year.
	const when = d => { const p = String(d).split('-'); return [p[0] || '9999', p[1] || '99', p[2] || '99'].join('-'); };
	keep.sort((a, b) => when(a.date).localeCompare(when(b.date)) || a.rank - b.rank);
	let top = keep[0];
	if (top.rank !== 0) {
		const sameYear = keep.find(k => k.rank === 0 && String(k.date).slice(0, 4) === String(top.date).slice(0, 4));
		if (sameYear) top = sameYear;
	}
	// Several pressings share one album but only some have cover art, so offer them all.
	return {
		credit, title: top.recTitle, artist: top.artist, album: top.album, durationMs: top.durationMs,
		artCandidates: keep.filter(k => k.album === top.album).slice(0, 6).map(k => CoverArt(k.id))
	};
}

async function ITunesOriginal(rawTitle, artist) {
	const title = StripFeat(rawTitle) || rawTitle;
	const term = (title + ' ' + artist).trim();
	const resp = await SongFetch('https://itunes.apple.com/search?entity=song&limit=15&term=' + encodeURIComponent(term), 5000);
	if (!resp.ok) return null;
	let results = (await resp.json()).results || [];
	if (artist) {
		const a = songNorm(artist);
		const byArtist = results.filter(x => songNorm(x.artistName).includes(a) || a.includes(songNorm(x.artistName)));
		if (byArtist.length) results = byArtist;
	}
	results = results.filter(x => !BAD_RELEASE_TITLE.test(x.collectionName || ''));
	if (!results.length) return null;
	results.sort((a, b) => String(a.releaseDate || '').localeCompare(String(b.releaseDate || '')));
	const pick = results[0];
	return {
		title: pick.trackName || '', artist: pick.artistName || '', album: pick.collectionName || '',
		durationMs: pick.trackTimeMillis || 0,
		artCandidates: pick.artworkUrl100 ? [pick.artworkUrl100.replace('100x100bb', '600x600bb')] : []
	};
}

// A pasted link isn't searchable text, so turn it into some.
//
// YouTube's oEmbed is enough on its own — its title is normally "Artist - Song".
// Spotify's is NOT: it returns the track title and nothing else, so a link to
// "Spinnin" by Connor Price came back as a different song called Spinnin. The artist
// only exists on the track page, which is CORS-blocked (and the corsproxy.io the old
// code used now wants an API key). r.jina.ai renders that page as text and is
// CORS-open, so one request gets the title, the artists, the album, the length and
// the cover art:
//
//   Title: Spinnin - song and lyrics by Connor Price, Bens
//   •[Spin The Globe](…)•2023•1:50•249,599,022
async function SpotifyTrackInfo(url) {
	const id = url.match(/track[/:]([A-Za-z0-9]+)/);
	if (!id) return null;
	const r = await SongFetch('https://r.jina.ai/https://open.spotify.com/track/' + id[1], 9000);
	if (!r.ok) return null;
	const text = await r.text();

	const head = text.match(/^Title:\s*(.+?)\s+-\s+song and lyrics by\s+(.+?)\s*$/m);
	if (!head) return null;
	const meta = text.match(/•\[([^\]]+)\]\([^)]*\)•(\d{4})•(\d+):(\d{2})•/);
	const art = text.match(/!\[Image \d+:[^\]]*\]\((https:\/\/i\.scdn\.co\/image\/[^)]+)\)/);

	return {
		title: head[1].trim(),
		artist: head[2].trim(),
		album: meta ? meta[1].trim() : '',
		durationMs: meta ? (Number(meta[3]) * 60 + Number(meta[4])) * 1000 : 0,
		albumArt: art ? art[1] : ''
	};
}

async function LinkToQuery(url) {
	try {
		if (/open\.spotify\.com|spotify:/i.test(url)) {
			const r = await SongFetch('https://open.spotify.com/oembed?url=' + encodeURIComponent(url), 4000);
			if (r.ok) { const j = await r.json(); if (j.title) return CleanTrackTitle(j.title); }
		} else if (/youtube\.com\/watch|youtu\.be\/|music\.youtube\.com/i.test(url)) {
			const r = await SongFetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url), 4000);
			if (r.ok) { const j = await r.json(); if (j.title) return CleanTrackTitle(j.title); }
		}
	} catch (e) { /* fall through to searching the raw link text */ }
	return '';
}

const SONG_MATCH_FLOOR = 0.45;   // below this: no card, the request shows as a plain message

async function GetSongInfo(request) {
	let input = (request || '').trim();
	if (!input) return null;

	// A Spotify track link is a request for THAT recording, so its own metadata is the
	// fallback if the search can't place it.
	let spotify = null;
	if (/^https?:\/\//i.test(input) || /^spotify:/i.test(input)) {
		if (/open\.spotify\.com\/track|spotify:track:/i.test(input)) {
			spotify = await withDeadline(SpotifyTrackInfo(input), 10000);
			if (spotify) input = `${spotify.title} ${spotify.artist}`;
		}
		if (!spotify) {
			const fromLink = await LinkToQuery(input);
			if (fromLink) input = fromLink;
		}
	}
	const spotifyCard = async () => {
		if (!spotify || !spotify.title) return null;
		const art = await ResolveAlbumArt([spotify.albumArt], 4000);
		if (!art) return null;
		console.log(`[song] using Spotify's own metadata for "${spotify.title}"`);
		return { title: spotify.title, artist: spotify.artist, album: spotify.album || 'No album', durationMs: spotify.durationMs, albumArt: art };
	};

	// 1 — ask both catalogues with the request exactly as the viewer typed it
	const [songs, videos] = await Promise.all([
		PipedSearch(input, 'music_songs').catch(() => []),
		PipedSearch(input, 'videos').catch(() => [])
	]);

	// 2 — score every candidate against the request
	const featWords = songTokens(input).filter(t => !songTokens(StripFeat(input)).includes(t) && !/^(feat|ft|featuring|med)$/.test(t));
	const scored = [...songs, ...videos]
		.filter(c => !NOT_THE_SONG.test(c.title))
		.map(c => {
			const text = CleanTrackTitle(c.title) + ' ' + c.artist;
			let score = ScoreMatch(text, input);
			if (c.via === 'YT Music') score += 0.06;                                              // a music catalogue, not a video site
			if (featWords.length && featWords.every(w => FuzzyHas(songTokens(text), w))) score += 0.05;
			return { ...c, score };
		})
		.sort((a, b) => b.score - a.score);

	let best = scored[0];
	// A link is a request for one specific recording, and length is what identifies it:
	// "Spinnin" is 1:50 on Spotify but the music video on YouTube runs 2:19, and on words
	// alone the video wins because its title repeats both artists.
	if (spotify && spotify.durationMs) {
		const sameLength = scored.find(c => c.score >= SONG_MATCH_FLOOR && Math.abs(c.durationMs - spotify.durationMs) <= 3000);
		if (sameLength) best = sameLength;
	}
	// Same length = same recording. If the winner is a YouTube upload but that very
	// recording is also in the YouTube Music catalogue, take the catalogue one: same
	// audio, but a real artist field and an album instead of a re-upload channel's name.
	if (best && best.via !== 'YT Music') {
		const twin = scored.find(c => c.via === 'YT Music' && c.score >= SONG_MATCH_FLOOR && Math.abs(c.durationMs - best.durationMs) <= 3000);
		if (twin) best = twin;
	}
	if (!best || best.score < SONG_MATCH_FLOOR) {
		console.warn(`[song] nothing matched "${input}"`);
		return await spotifyCard();
	}

	// 3 — the album. Ask all three at once, in order of how likely each is to name the
	// ORIGINAL release, and whichever names it must also supply the artwork: a card
	// labelled "Thriller" showing the HIStory sleeve is worse than either on its own.
	const [mbOrig, ytAlbum, itunes] = await Promise.all([
		withDeadline(MusicBrainzOriginal(best.title, best.artist), 6000),
		withDeadline(YouTubeMusicAlbum(input, best.coverId, best.artist, best.via === 'YT Music'), 8000),
		withDeadline(ITunesOriginal(best.title, best.artist), 5000)
	]);
	// "Belongs to this track" is a containment question, not a similarity one:
	// MusicBrainz credits "Monster" to five artists, which a similarity score reads as
	// a different song entirely.
	const mine = songTokens(best.artist)[0] || '';
	const trust = r => !!r && !!r.title && ScoreMatch(r.title, best.title) >= 0.6 && (!mine || FuzzyHas(songTokens(r.artist || ''), mine));

	let album = '', albumArt = '', extraMs = 0;
	for (const [src, wait] of [[trust(mbOrig) ? mbOrig : null, 4000], [ytAlbum, 2000], [trust(itunes) ? itunes : null, 2000]]) {
		if (!src || !src.album) continue;
		const art = await ResolveAlbumArt(src.artCandidates || [], wait);
		if (!art) continue;
		album = src.album; albumArt = art; extraMs = src.durationMs || 0;
		break;
	}
	if (!album) albumArt = await ResolveAlbumArt(best.artCandidates || []);

	// 4 — the artist line. YouTube Music exposes ONE artist (the channel that owns the
	// track), so every collaborator is missing unless it was written into the title.
	// Three ways to get them back, none costing a request of its own: the credit that
	// came back with the album lookups, the "(feat. …)" in the title, and — last resort,
	// so a slow lookup can't silently shorten a credit — the one the viewer typed.
	let artist = best.artist;
	for (const credit of [mbOrig && mbOrig.credit, trust(itunes) && itunes.artist]) {
		if (!credit) continue;
		const merged = MergeCredit(artist, credit);
		if (songUniq(songTokens(merged)).length > songUniq(songTokens(artist)).length) artist = merged;
	}
	const creditedIn = text => {
		const m = (text || '').match(/[\(\[]\s*(?:feat|ft|featuring|med)\b\.?\s*([^)\]]+)[\)\]]/i);
		if (!m) return [];
		return m[1].split(/\s*(?:,|&|\band\b|\bog\b)\s*/i).map(n => n.trim()).filter(Boolean)
			.filter(n => { const t = songTokens(n)[0]; return t && !FuzzyHas(songTokens(artist), t); });
	};
	for (const names of [creditedIn(best.title), creditedIn(input)]) {
		if (names.length) artist = [artist, ...names].join(', ');
	}

	// No artwork means a card with a grey hole in it, and the overlay already has a
	// better answer for that: return nothing, and the redemption renders with the
	// request as its message, word for word.
	if (!albumArt) {
		console.warn(`[song] no artwork loaded for "${input}"`);
		return await spotifyCard();
	}

	// The guests are on the artist line now, so the title doesn't need them too:
	// "Monster (feat. JAY-Z, Rick Ross, Nicki Minaj & Bon Iver)" → "Monster".
	const info = {
		title: StripFeat(best.title) || best.title,
		artist,
		album: album || 'No album',
		durationMs: best.durationMs || extraMs,
		albumArt
	};

	console.log(
		`%c♪ ${info.title}%c\n   Artist:   ${info.artist}\n   Album:    ${info.album}\n   Duration: ${FormatSongDuration(info.durationMs)}\n   Source:   ${best.via} (match ${best.score.toFixed(2)})\n   Art URL:  ${info.albumArt}`,
		'font-weight:bold;font-size:13px', 'font-weight:normal'
	);
	return info;
}

/* ══ Settings preview: a demo chat ═══════════════════════════════════════════
   The settings page shows this overlay with ?preview. Until a real message comes
   in (Streamer.bot closed, or just a quiet chat) it shows the comp's chat: a sub,
   a cheer, a song request and two messages, everyone a gray circle — each only
   when its kind is switched on, as a real one would be. The first real message
   clears it (see AddMessageItem). */
async function ShowDemoChat() {
	const gray = cardTokens.getPropertyValue('--gray-200').trim() || '#DEDEDE';
	const avatar = 'data:image/svg+xml,' + encodeURIComponent(
		`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><circle cx='16' cy='16' r='16' fill='${gray}'/></svg>`);
	avatarMap.set('username', avatar);   // chat lines look avatars up by login
	const user = { id: 'demo-user', name: 'Username', login: 'username', color: '#9146FF', profileImageUrl: avatar };
	const chat = (id, text) => TwitchChatMessage({
		user: { id: user.id, login: user.login, name: user.name },
		message: { msgId: id, message: text, displayName: user.name, username: user.login, userId: user.id,
		           color: user.color, badges: [], role: 1, isReply: false, isMe: false, firstMessage: false },
		emotes: [],
	});
	if (showTwitchSubs) await renderEventCard({ user, subTier: '1000', messageId: 'demo-sub' }, 'sub', 'twitch');
	if (showTwitchCheers) await renderEventCard({ user, bits: 100, text: '', messageId: 'demo-cheer' }, 'cheer', 'twitch', {
		description: EvGroup('bit-purple', 'Cheered 100', true), icon: 'bit-jar-purple' });
	if (showTwitchMessages) await chat('demo-chat-1', 'btw cafe what sensitivity do you play on?');
	if (showTwitchChannelPoints) await renderEventCard({ user, text: '', messageId: 'demo-song' }, 'channelpoint', 'twitch', {
		description: ChannelPointDescription('Song Request', 300),
		// The Song Info Card's song
		htmlContent: SongCardHTML({ title: 'Big Iron', album: 'Gunfighter Ballads And Trail Songs', artist: 'Marty Robbins',
		                            durationMs: 235000, albumArt: 'assets/default-album-art.png' }) });
	if (showTwitchMessages) await chat('demo-chat-2', 'man this game just looks amazing coming after a while');
}
if (previewMode) ShowDemoChat();
