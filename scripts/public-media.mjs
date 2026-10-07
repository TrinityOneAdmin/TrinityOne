// public-media.mjs — a church's PUBLIC sermon feed as an RSS 2.0 podcast, built by the relay.
//
// reference/DESIGN-embeddable-church-info.md, phase 2. A church that has switched "share our sermons" on
// gets `<base>/public/<npub>/sermons.xml` served by its own relay, so a podcast app or website widget can
// subscribe. This module is the feed's SHAPE and nothing else: no I/O, no store, no knowledge of who may
// read what. gateway.mjs decides whether to serve at all and what goes in.
//
// WHAT A SERMON IS HERE — the noticeboard fields and only those (design doc, "what is safe"): title,
// speaker, scripture reference, date, duration, and a content-addressed sha256 pointing at the relay's
// blob store. Never a group name, an attendee list, or anything from the sermon's sealed metadata.
//
// THE ENCLOSURE URL uses the church's own relay as the host (address mode 1). The gateway serves the
// audio at /public/<npub>/media/<sha256> — gated on the church's share: switch, not on membership.

const xmlEscape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function rfc2822(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'number' ? ts * 1000 : ts);
  if (isNaN(d.getTime())) return '';
  return d.toUTCString();
}

function durationHMS(mins) {
  const m = Math.max(0, Math.floor(Number(mins) || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00';
}

export function publicSermonFields(s) {
  if (!s || typeof s !== 'object') return null;
  if (!s.sha256 || typeof s.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(s.sha256)) return null;
  const title = String(s.title || '').slice(0, 300).trim();
  if (!title) return null;
  return {
    id: String(s.id || '').slice(0, 64),
    title,
    who: String(s.who || '').slice(0, 120).trim(),
    ref: String(s.ref || '').slice(0, 200).trim(),
    mins: Math.max(0, Math.floor(Number(s.mins) || 0)),
    sha256: s.sha256,
    mime: /^(audio|video)\/[a-z0-9.+-]+$/.test(s.mime) ? s.mime : 'audio/mpeg',
    ts: Number(s.contentTs) || Number(s.ts) || Number(s.at) || 0,
    size: Math.max(0, Math.floor(Number(s.size) || 0)),
  };
}

// The feed. `sermons` is anything; only what publicSermonFields() admits is written.
// `baseUrl` is the relay's public base (e.g. https://relay.mychurch.org) — used for enclosure URLs.
// `churchNpub` is the church's npub — used for per-item and media URLs.
export function buildSermonFeed(sermons, { name = '', churchNpub = '', baseUrl = '', description = '' } = {}) {
  const rows = (Array.isArray(sermons) ? sermons : []).map(publicSermonFields).filter(Boolean)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const pubBase = baseUrl.replace(/\/+$/, '') + '/public/' + churchNpub;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">');
  lines.push('<channel>');
  lines.push('<title>' + xmlEscape(name || 'Sermons') + '</title>');
  lines.push('<link>' + xmlEscape(pubBase + '/sermons.xml') + '</link>');
  lines.push('<description>' + xmlEscape(description || (name ? name + ' — sermons' : 'Sermons')) + '</description>');
  lines.push('<language>en</language>');
  lines.push('<generator>TrinityOne</generator>');
  lines.push('<atom:link href="' + xmlEscape(pubBase + '/sermons.xml') + '" rel="self" type="application/rss+xml" />');
  if (rows.length) {
    lines.push('<lastBuildDate>' + rfc2822(rows[0].ts) + '</lastBuildDate>');
    lines.push('<pubDate>' + rfc2822(rows[0].ts) + '</pubDate>');
  }
  lines.push('<itunes:explicit>false</itunes:explicit>');
  lines.push('<itunes:type>episodic</itunes:type>');

  for (const s of rows) {
    const mediaUrl = pubBase + '/media/' + s.sha256;
    lines.push('<item>');
    lines.push('<title>' + xmlEscape(s.title) + '</title>');
    lines.push('<guid isPermaLink="false">trinityone-sermon-' + xmlEscape(s.id || s.sha256) + '</guid>');
    if (s.ts) lines.push('<pubDate>' + rfc2822(s.ts) + '</pubDate>');
    const desc = [s.who, s.ref].filter(Boolean).join(' — ');
    if (desc) {
      lines.push('<description>' + xmlEscape(desc) + '</description>');
      lines.push('<itunes:summary>' + xmlEscape(desc) + '</itunes:summary>');
    }
    if (s.who) lines.push('<itunes:author>' + xmlEscape(s.who) + '</itunes:author>');
    lines.push('<enclosure url="' + xmlEscape(mediaUrl) + '" type="' + xmlEscape(s.mime) + '"' + (s.size ? ' length="' + s.size + '"' : ' length="0"') + ' />');
    if (s.mins) lines.push('<itunes:duration>' + durationHMS(s.mins) + '</itunes:duration>');
    lines.push('</item>');
  }

  lines.push('</channel>');
  lines.push('</rss>');
  return lines.join('\n') + '\n';
}

export function publicPlanFields(p) {
  if (!p || typeof p !== 'object') return null;
  const title = String(p.title || '').slice(0, 300).trim();
  if (!title) return null;
  if (p.draft) return null;
  if (p.public === false) return null;
  const days = Array.isArray(p.days) ? p.days.map(d => ({
    d: Number(d.d) || 0,
    ref: String(d.ref || '').slice(0, 200).trim(),
    label: String(d.label || '').slice(0, 200).trim(),
  })).filter(d => d.ref) : [];
  if (!days.length) return null;
  return {
    id: String(p.id || '').slice(0, 64),
    title,
    sub: String(p.sub || '').slice(0, 200).trim(),
    tag: String(p.tag || '').slice(0, 60).trim(),
    blurb: String(p.blurb || '').slice(0, 500).trim(),
    days,
    len: days.length,
    ts: Number(p.ts) || 0,
  };
}

export function buildPlansFeed(plans, { name = '', churchNpub = '', baseUrl = '' } = {}) {
  const rows = (Array.isArray(plans) ? plans : []).map(publicPlanFields).filter(Boolean)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return JSON.stringify({
    generator: 'TrinityOne',
    church: name || undefined,
    churchNpub: churchNpub || undefined,
    base: baseUrl || undefined,
    plans: rows,
  }, null, 2) + '\n';
}

export function publicDevoFields(d) {
  if (!d || typeof d !== 'object') return null;
  const title = String(d.title || '').slice(0, 300).trim();
  if (!title) return null;
  if (d.draft) return null;
  if (d.public === false) return null;
  return {
    id: String(d.id || '').slice(0, 64),
    title,
    ref: String(d.ref || '').slice(0, 200).trim(),
    series: String(d.series || '').slice(0, 80).trim() || undefined,
    text: String(d.text || '').slice(0, 4000).trim(),
    ts: Number(d.ts) || 0,
  };
}

export function buildDevosFeed(devos, { name = '', churchNpub = '', baseUrl = '' } = {}) {
  const rows = (Array.isArray(devos) ? devos : []).map(publicDevoFields).filter(Boolean)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return JSON.stringify({
    generator: 'TrinityOne',
    church: name || undefined,
    churchNpub: churchNpub || undefined,
    base: baseUrl || undefined,
    devotionals: rows,
  }, null, 2) + '\n';
}
