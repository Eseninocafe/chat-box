const SETTINGS_JSON_URL = './settings.json';

let settings = [];
let values = {};
// id -> function(value) that updates that setting's on-screen control.
let controlSetters = {};

const $ = (id) => document.getElementById(id);

function getParentUrl() {
    const currentUrl = window.location.href.split('?')[0];
    const urlParts = currentUrl.split('/');
    urlParts.pop();
    urlParts.pop();
    return urlParts.join('/') + '/';
}

// A setting with hideWhen is hidden, and left out of the URL, while that other
// setting is on (Enable Stingers while Receipt is on). Its value is kept for
// when it comes back.
const isHidden = (s) => !!s.hideWhen && String(values[s.hideWhen]) === 'true';
function applyHidden() {
    settings.forEach(s => { if (s.row) s.row.hidden = isHidden(s); });
}

function buildQueryString() {
    return settings
        // Settings flagged omitWhenDefault are left out of the URL while at their
        // default, so links stay backward-compatible (e.g. ?stingers is only added
        // once it's turned on).
        .filter(s => !(s.omitWhenDefault && String(values[s.id]) === String(s.defaultValue)))
        .filter(s => !isHidden(s))
        .map(s => `${encodeURIComponent(s.id)}=${encodeURIComponent(values[s.id])}`)
        .join('&');
}

function getWidgetUrl() {
    return `${getParentUrl()}?${buildQueryString()}`;
}

// The preview is the chat box itself (?preview: a demo chat until a real message
// comes in, and it reports its Streamer.bot connection for the pill).
function updateWidget() {
    applyHidden();
    $('widget').src = `../index.html?${buildQueryString()}&preview`;
    fitPreview();
}

/* Without the receipt the chat box fills the preview area, as it fills its OBS
   source. The receipt is a fixed 596 × 832: it sits centred at least 14px in from
   the area's edges, scaled down (never up) when it doesn't fit. */
const RECEIPT_W = 596, RECEIPT_H = 832, PREVIEW_PAD = 14;
function fitPreview() {
    const frame = $('widget'), area = $('previewArea');
    if (String(values.receipt) !== 'true') {
        frame.style.cssText = '';
        return;
    }
    const W = area.clientWidth, H = area.clientHeight;
    const s = Math.min(1, (W - 2 * PREVIEW_PAD) / RECEIPT_W, (H - 2 * PREVIEW_PAD) / RECEIPT_H);
    frame.style.width = RECEIPT_W + 'px';
    frame.style.height = RECEIPT_H + 'px';
    frame.style.left = (W - RECEIPT_W * s) / 2 + 'px';
    frame.style.top = (H - RECEIPT_H * s) / 2 + 'px';
    frame.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fitPreview);

// "Connected" slides up when the preview's chat box connects to Streamer.bot — once
// per connection: a preview reloaded by a setting change just reconnects quietly.
let sbState = null, pillTimer = null;
window.addEventListener('message', (e) => {
    if (e.source !== $('widget').contentWindow || !e.data || !e.data.chatbox) return;
    const was = sbState;
    sbState = e.data.chatbox;
    if (sbState !== 'connected' || was === 'connected') return;
    $('statusPill').classList.add('show');
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => $('statusPill').classList.remove('show'), 2500);
});

$('copyBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(getWidgetUrl());
    $('copyLabel').textContent = 'Copied';
    $('copyBtn').classList.add('copied');            // label only, no icon
    setTimeout(() => {
        $('copyLabel').textContent = 'Copy Widget URL';
        $('copyBtn').classList.remove('copied');
    }, 1500);
});

// A setting row: label (+ description) and a square checkbox.
function makeToggle(s) {
    const row = document.createElement('div');
    row.className = 'setting';
    const text = document.createElement('div');
    text.className = 'setting-text';
    const label = document.createElement('label');
    label.htmlFor = `set-${s.id}`;
    label.textContent = s.label;
    text.appendChild(label);
    if (s.description) {
        const desc = document.createElement('span');
        desc.className = 'setting-desc';
        desc.textContent = s.description;
        text.appendChild(desc);
    }
    const toggle = document.createElement('label');
    toggle.className = 'toggle';
    toggle.innerHTML = `<input id="set-${s.id}" type="checkbox"><span class="toggle-box"><span class="icon icon-check"></span></span>`;
    const input = toggle.querySelector('input');
    input.checked = s.defaultValue;
    input.addEventListener('change', () => { values[s.id] = input.checked; updateWidget(); });
    controlSetters[s.id] = v => { input.checked = (v === true || String(v).toLowerCase() === 'true'); };
    row.append(text, toggle);
    s.row = row;
    return row;
}

// A text field: the value over the bar.
function makeTextField(s) {
    const field = document.createElement('label');
    field.className = 'text-field';
    field.innerHTML = `<input type="text" spellcheck="false" autocomplete="off"><span class="bar"></span>`;
    const input = field.querySelector('input');
    input.placeholder = s.placeholder || '';
    input.value = s.defaultValue;
    input.addEventListener('input', () => { values[s.id] = input.value; updateWidget(); });
    controlSetters[s.id] = v => { input.value = v; };
    return field;
}

// A dropdown: the choice and the expand chevron over the bar.
function makeSelect(s) {
    const field = document.createElement('label');
    field.className = 'text-field';
    field.innerHTML = `<span class="select-row"><select></select><span class="icon icon-expand"></span></span><span class="bar"></span>`;
    const sel = field.querySelector('select');
    s.options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.label;
        if (opt.value === s.defaultValue) o.selected = true;
        sel.appendChild(o);
    });
    sel.addEventListener('change', () => { values[s.id] = sel.value; updateWidget(); });
    controlSetters[s.id] = v => { sel.value = v; };
    return field;
}

function makeControl(s) {
    if (s.type === 'checkbox') return makeToggle(s);
    if (s.type === 'select') return makeSelect(s);
    return makeTextField(s);
}

// Read the URL pasted in the header and apply any settings it contains. Anything
// that isn't one says so in the field's placeholder for a moment, like "Copied".
const LOAD_PLACEHOLDER = 'Paste widget URL';
let loadPlaceholderTimer = 0;
function loadFromUrlInput() {
    const input = $('loadInput');
    const raw = input.value.trim();
    input.value = '';
    let params = null;
    try {
        // Accept a full URL, or just a query string ("?a=1&b=2" / "a=1&b=2").
        if (raw.includes('://')) params = new URL(raw).searchParams;
        else if (raw) params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
    } catch (e) {}

    const known = params ? settings.filter(s => params.has(s.id)) : [];
    clearTimeout(loadPlaceholderTimer);
    if (!known.length) {
        input.placeholder = 'Not a widget URL';
        loadPlaceholderTimer = setTimeout(() => { input.placeholder = LOAD_PLACEHOLDER; }, 1500);
        return;
    }
    input.placeholder = LOAD_PLACEHOLDER;
    // Settings missing from the URL are at their defaults there.
    settings.forEach(s => {
        let v = params.has(s.id) ? params.get(s.id) : s.defaultValue;
        if (s.type === 'checkbox') v = (String(v).toLowerCase() === 'true');
        values[s.id] = v;
        if (controlSetters[s.id]) controlSetters[s.id](v);
    });
    updateWidget();
}
$('loadBtn').addEventListener('click', loadFromUrlInput);
$('loadInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromUrlInput(); });
$('loadInput').addEventListener('input', () => { $('loadInput').placeholder = LOAD_PLACEHOLDER; });

// Theme: the same saved choice as the other settings pages (dark unless set to light).
$('themeToggle').addEventListener('click', () => {
    const light = document.body.classList.toggle('light-mode');
    try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
});

async function init() {
    const res = await fetch(SETTINGS_JSON_URL + '?t=' + new Date().getTime());
    const json = await res.json();
    settings = json.settings;
    settings.forEach(s => { values[s.id] = s.defaultValue; });

    // Ungrouped settings sit straight in the list; a group is its heading over its
    // settings (for a text field or a dropdown, the heading is its only label).
    const list = $('settingsList');
    const groups = new Map();
    settings.forEach(s => {
        if (!s.group) { list.appendChild(makeControl(s)); return; }
        if (!groups.has(s.group)) {
            const g = document.createElement('div');
            g.className = 'group';
            g.innerHTML = `<div class="group-heading"></div>`;
            g.firstChild.textContent = s.group;
            list.appendChild(g);
            groups.set(s.group, g);
        }
        groups.get(s.group).appendChild(makeControl(s));
    });

    updateWidget();
}

init();
