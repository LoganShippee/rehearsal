'use strict';
/* Rehearsal Scan & Fix — Editable MusicXML Score Model, .mxl ZIP I/O,
   Correction Mutations, Undo/Redo History, Playback Bridge, and OSMD Tap Mapper.
   Zero external dependencies: runs identically in browsers and macOS JavaScriptCore (jsc). */

// ---------- Pitch & Duration Constants
const SF_STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SF_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SF_SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const SF_FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

const SF_TYPE_TO_Q = {
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625
};

const SF_TYPE_TO_DEN = {
  breve: 1,
  whole: 1,
  half: 1,
  quarter: 1,
  eighth: 2,
  '16th': 4,
  '32nd': 8,
  '64th': 16
};

const SF_ACC_TO_ALTER = {
  'double-sharp': 2,
  'sharp-sharp': 2,
  sharp: 1,
  natural: 0,
  flat: -1,
  'flat-flat': -2,
  'double-flat': -2
};

function sfAlterToAccidental(alter) {
  if (alter >= 2) return 'double-sharp';
  if (alter === 1) return 'sharp';
  if (alter === 0) return 'natural';
  if (alter === -1) return 'flat';
  if (alter <= -2) return 'flat-flat';
  return null;
}

function sfKeyAlterForStep(fifths, step) {
  const f = Math.trunc(Number(fifths) || 0);
  if (f > 0) {
    const idx = SF_SHARP_ORDER.indexOf(step);
    return (idx >= 0 && idx < f) ? 1 : 0;
  }
  if (f < 0) {
    const idx = SF_FLAT_ORDER.indexOf(step);
    return (idx >= 0 && idx < -f) ? -1 : 0;
  }
  return 0;
}

function sfPitchToMidi(step, octave, alter) {
  if (!step || !isFinite(octave)) return null;
  const pc = SF_PC[step];
  if (pc === undefined) return null;
  return (Math.trunc(octave) + 1) * 12 + pc + (Number(alter) || 0);
}

function sfTransposeSemis(transpose) {
  if (!transpose) return 0;
  return (Number(transpose.chromatic) || 0) + 12 * (Number(transpose.octaveChange) || 0);
}

function sfGcd(a, b) {
  a = Math.abs(Math.round(a)) || 1;
  b = Math.abs(Math.round(b)) || 1;
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

function sfLcm(a, b) {
  a = Math.abs(Math.round(a)) || 1;
  b = Math.abs(Math.round(b)) || 1;
  return (a / sfGcd(a, b)) * b;
}

// ---------- Pure-JS UTF-8 Encode / Decode (zero DOM/Node deps)
function sfUtf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let cp = str.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
      const lo = str.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = ((cp - 0xd800) << 10) + (lo - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return new Uint8Array(out);
}

function sfUtf8Decode(input) {
  const bytes = input instanceof Uint8Array
    ? input
    : (ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input));
  if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
  let out = '';
  let i = 0;
  // Strip UTF-8 BOM if present
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if ((b0 & 0xe0) === 0xc0 && i < bytes.length) {
      const b1 = bytes[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
    } else if ((b0 & 0xf0) === 0xe0 && i + 1 < bytes.length) {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
    } else if ((b0 & 0xf8) === 0xf0 && i + 2 < bytes.length) {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      const b3 = bytes[i++] & 0x3f;
      let cp = (((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      out += '\ufffd';
    }
  }
  return out;
}

// ---------- Pure-JS CRC-32 & ZIP Reader / Writer (.mxl)
const SF_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function sfCrc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = SF_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function sfToUint8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('expected Uint8Array or ArrayBuffer');
}

function sfUnzipMxlSync(uint8) {
  const bytes = sfToUint8(uint8);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a valid .mxl zip archive');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let k = 0; k < count; k++) {
    if (p + 46 > len || dv.getUint32(p, true) !== 0x02014b50) {
      throw new Error('corrupt central directory in .mxl archive');
    }
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true);
    const el = dv.getUint16(p + 30, true);
    const cl = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = sfUtf8Decode(bytes.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (lho + 30 > len || dv.getUint32(lho, true) !== 0x04034b50) {
      throw new Error('corrupt local header in .mxl archive');
    }
    const lnl = dv.getUint16(lho + 26, true);
    const lel = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lnl + lel;
    const data = bytes.subarray(dataStart, dataStart + csize);
    if (method === 0 && sfCrc32(data) !== crc) {
      throw new Error('CRC-32 mismatch for ' + name);
    }
    out[name] = { method, crc, csize, usize, data };
  }
  return out;
}

function sfZipBuildStored(fileList) {
  // fileList: [{ name: string, data: Uint8Array }]
  const entries = fileList.map(f => {
    const nameBytes = sfUtf8Encode(f.name);
    const data = sfToUint8(f.data);
    const crc = sfCrc32(data);
    return { nameBytes, data, crc, offset: 0 };
  });

  let localTotal = 0;
  let cdTotal = 0;
  for (const e of entries) {
    e.offset = localTotal;
    localTotal += 30 + e.nameBytes.length + e.data.length;
    cdTotal += 46 + e.nameBytes.length;
  }
  const totalSize = localTotal + cdTotal + 22;
  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);
  let pos = 0;

  // Local file headers + data
  for (const e of entries) {
    dv.setUint32(pos, 0x04034b50, true);     // local file header signature
    dv.setUint16(pos + 4, 20, true);         // version needed (2.0)
    dv.setUint16(pos + 6, 0x0800, true);     // UTF-8 filename flag
    dv.setUint16(pos + 8, 0, true);          // method 0 (Stored)
    dv.setUint16(pos + 10, 0, true);         // mod time
    dv.setUint16(pos + 12, 0x0021, true);    // mod date (1980-01-01)
    dv.setUint32(pos + 14, e.crc, true);     // CRC-32
    dv.setUint32(pos + 18, e.data.length, true); // compressed size
    dv.setUint32(pos + 22, e.data.length, true); // uncompressed size
    dv.setUint16(pos + 26, e.nameBytes.length, true);
    dv.setUint16(pos + 28, 0, true);         // extra length
    out.set(e.nameBytes, pos + 30);
    pos += 30 + e.nameBytes.length;
    out.set(e.data, pos);
    pos += e.data.length;
  }

  // Central directory headers
  const cdOffset = pos;
  for (const e of entries) {
    dv.setUint32(pos, 0x02014b50, true);     // central dir signature
    dv.setUint16(pos + 4, 20, true);         // version made by
    dv.setUint16(pos + 6, 20, true);         // version needed
    dv.setUint16(pos + 8, 0x0800, true);     // UTF-8 flag
    dv.setUint16(pos + 10, 0, true);         // method 0 (Stored)
    dv.setUint16(pos + 12, 0, true);         // mod time
    dv.setUint16(pos + 14, 0x0021, true);    // mod date
    dv.setUint32(pos + 16, e.crc, true);     // CRC-32
    dv.setUint32(pos + 20, e.data.length, true);
    dv.setUint32(pos + 24, e.data.length, true);
    dv.setUint16(pos + 28, e.nameBytes.length, true);
    dv.setUint16(pos + 30, 0, true);         // extra length
    dv.setUint16(pos + 32, 0, true);         // comment length
    dv.setUint16(pos + 34, 0, true);         // disk number
    dv.setUint16(pos + 36, 0, true);         // internal attrs
    dv.setUint32(pos + 38, 0, true);         // external attrs
    dv.setUint32(pos + 42, e.offset, true);  // local header offset
    out.set(e.nameBytes, pos + 46);
    pos += 46 + e.nameBytes.length;
  }

  // End of Central Directory (EOCD)
  dv.setUint32(pos, 0x06054b50, true);
  dv.setUint16(pos + 4, 0, true);            // disk number
  dv.setUint16(pos + 6, 0, true);            // start disk
  dv.setUint16(pos + 8, entries.length, true);
  dv.setUint16(pos + 10, entries.length, true);
  dv.setUint32(pos + 12, cdTotal, true);
  dv.setUint32(pos + 16, cdOffset, true);
  dv.setUint16(pos + 20, 0, true);           // comment length

  return out;
}

async function sfInflateEntry(entry) {
  if (entry.method === 0) return entry.data;
  if (entry.method === 8) {
    if (typeof DecompressionStream !== 'undefined' && typeof Blob !== 'undefined' && typeof Response !== 'undefined') {
      const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('deflate decompression requires a browser DecompressionStream');
  }
  throw new Error('unsupported .mxl compression method: ' + entry.method);
}

// ---------- Pure-JS XML Parser & Serializer (zero DOMParser deps)
function sfXmlUnescape(str) {
  if (!str || str.indexOf('&') < 0) return str;
  return str.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, ent) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    if (ent[0] === '#') {
      const code = (ent[1] === 'x' || ent[1] === 'X')
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      if (isFinite(code)) {
        try { return String.fromCodePoint(code); } catch { return ''; }
      }
    }
    return '&' + ent + ';';
  });
}

function sfXmlEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sfXmlAttrEscape(str) {
  return sfXmlEscape(str).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function sfParseXml(xmlStr) {
  if (typeof xmlStr !== 'string' || !xmlStr.trim()) {
    throw new Error('empty XML input');
  }
  let s = xmlStr;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const len = s.length;
  let pos = 0;
  const stack = [];
  let root = null;

  const isWs = c => c === ' ' || c === '\t' || c === '\r' || c === '\n';

  while (pos < len) {
    const lt = s.indexOf('<', pos);
    if (lt < 0) {
      const tail = s.slice(pos);
      if (stack.length && tail) {
        stack[stack.length - 1].children.push({ type: 'text', text: sfXmlUnescape(tail) });
      }
      break;
    }
    if (lt > pos && stack.length) {
      const txt = s.slice(pos, lt);
      stack[stack.length - 1].children.push({ type: 'text', text: sfXmlUnescape(txt) });
    }
    pos = lt;

    // Comment
    if (s.startsWith('<!--', pos)) {
      const end = s.indexOf('-->', pos + 4);
      if (end < 0) throw new Error('unterminated XML comment');
      pos = end + 3;
      continue;
    }
    // CDATA
    if (s.startsWith('<![CDATA[', pos)) {
      const end = s.indexOf(']]>', pos + 9);
      if (end < 0) throw new Error('unterminated CDATA section');
      if (stack.length) {
        stack[stack.length - 1].children.push({ type: 'text', text: s.slice(pos + 9, end) });
      }
      pos = end + 3;
      continue;
    }
    // Processing instruction <?...?>
    if (s.startsWith('<?', pos)) {
      const end = s.indexOf('?>', pos + 2);
      if (end < 0) throw new Error('unterminated XML processing instruction');
      pos = end + 2;
      continue;
    }
    // DOCTYPE / declaration <!...>
    if (s.startsWith('<!', pos)) {
      let depth = 0;
      let i = pos + 2;
      let inQuote = '';
      while (i < len) {
        const ch = s[i];
        if (inQuote) {
          if (ch === inQuote) inQuote = '';
        } else if (ch === '"' || ch === "'") {
          inQuote = ch;
        } else if (ch === '[') {
          depth++;
        } else if (ch === ']') {
          if (depth > 0) depth--;
        } else if (ch === '>' && depth === 0) {
          break;
        }
        i++;
      }
      if (i >= len) throw new Error('unterminated DOCTYPE declaration');
      pos = i + 1;
      continue;
    }
    // Closing tag </tag>
    if (s[pos + 1] === '/') {
      const gt = s.indexOf('>', pos + 2);
      if (gt < 0) throw new Error('unterminated closing tag');
      const closeTag = s.slice(pos + 2, gt).trim();
      if (!stack.length) throw new Error('unexpected closing tag </' + closeTag + '>');
      const open = stack.pop();
      if (open.tag !== closeTag) {
        throw new Error('mismatched XML tag: expected </' + open.tag + '> got </' + closeTag + '>');
      }
      pos = gt + 1;
      continue;
    }

    // Opening tag <tag attr="val" ... /?>
    let i = pos + 1;
    while (i < len && !isWs(s[i]) && s[i] !== '>' && s[i] !== '/') i++;
    const tag = s.slice(pos + 1, i);
    if (!tag || !/^[A-Za-z_:][\w:.-]*$/.test(tag)) {
      throw new Error('invalid XML tag name near offset ' + pos);
    }
    const attrs = {};
    let selfClosing = false;
    while (i < len) {
      while (i < len && isWs(s[i])) i++;
      if (i >= len) throw new Error('unterminated opening tag <' + tag + '>');
      if (s[i] === '/') {
        if (s[i + 1] !== '>') throw new Error('expected /> in tag <' + tag + '>');
        selfClosing = true;
        i += 2;
        break;
      }
      if (s[i] === '>') {
        i += 1;
        break;
      }
      // Read attribute name
      const aStart = i;
      while (i < len && !isWs(s[i]) && s[i] !== '=' && s[i] !== '>' && s[i] !== '/') i++;
      const aName = s.slice(aStart, i);
      while (i < len && isWs(s[i])) i++;
      if (s[i] !== '=') throw new Error('expected = after attribute ' + aName);
      i++;
      while (i < len && isWs(s[i])) i++;
      const q = s[i];
      if (q !== '"' && q !== "'") throw new Error('expected quote for attribute ' + aName);
      i++;
      const vStart = i;
      const vEnd = s.indexOf(q, vStart);
      if (vEnd < 0) throw new Error('unterminated attribute value for ' + aName);
      attrs[aName] = sfXmlUnescape(s.slice(vStart, vEnd));
      i = vEnd + 1;
    }

    const el = { type: 'element', tag, attrs, children: [] };
    if (stack.length) {
      stack[stack.length - 1].children.push(el);
    } else {
      if (root) throw new Error('multiple root XML elements');
      root = el;
    }
    if (!selfClosing) stack.push(el);
    pos = i;
  }

  if (stack.length) {
    throw new Error('unclosed XML tag <' + stack[stack.length - 1].tag + '>');
  }
  if (!root) throw new Error('no root XML element found');
  return root;
}

function sfXmlChildren(el, tag) {
  if (!el || !el.children) return [];
  const out = [];
  for (const c of el.children) {
    if (c.type === 'element' && (!tag || c.tag === tag)) out.push(c);
  }
  return out;
}

function sfXmlChild(el, tag) {
  if (!el || !el.children) return null;
  for (const c of el.children) {
    if (c.type === 'element' && c.tag === tag) return c;
  }
  return null;
}

function sfXmlText(el) {
  if (!el || !el.children) return '';
  let out = '';
  for (const c of el.children) {
    if (c.type === 'text') out += c.text;
    else if (c.type === 'element') out += sfXmlText(c);
  }
  return out;
}

function sfXmlChildText(el, tag) {
  const ch = sfXmlChild(el, tag);
  return ch ? sfXmlText(ch).trim() : '';
}

function sfXmlChildNum(el, tag) {
  const ch = sfXmlChild(el, tag);
  if (!ch) return NaN;
  return Number(sfXmlText(ch).trim());
}

function sfXmlFindFirst(el, tag) {
  if (!el || el.type !== 'element') return null;
  if (el.tag === tag) return el;
  for (const c of el.children || []) {
    if (c.type === 'element') {
      const hit = sfXmlFindFirst(c, tag);
      if (hit) return hit;
    }
  }
  return null;
}

function sfSerializeXmlNode(node) {
  if (!node) return '';
  if (node.type === 'text') return sfXmlEscape(node.text);
  let attrStr = '';
  const keys = Object.keys(node.attrs || {});
  for (const k of keys) {
    attrStr += ' ' + k + '="' + sfXmlAttrEscape(node.attrs[k]) + '"';
  }
  if (!node.children || !node.children.length) {
    return '<' + node.tag + attrStr + '/>';
  }
  let inner = '';
  for (const c of node.children) inner += sfSerializeXmlNode(c);
  return '<' + node.tag + attrStr + '>' + inner + '</' + node.tag + '>';
}

// ---------- MusicXML -> Editable Score Model
const SF_HEADER_TAGS = new Set([
  'work', 'movement-number', 'movement-title', 'identification', 'defaults', 'credit', 'part-list'
]);

const SF_HANDLED_NOTE_TAGS = new Set([
  'grace', 'cue', 'chord', 'pitch', 'unpitched', 'rest', 'duration', 'tie', 'voice', 'type', 'dot',
  'accidental', 'notehead', 'time-modification', 'staff', 'lyric'
]);

const SF_HANDLED_LYRIC_TAGS = new Set(['syllabic', 'text', 'extend']);

function sfParseLyricElement(ch) {
  const extEl = sfXmlChild(ch, 'extend');
  const extra = [];
  for (const sub of sfXmlChildren(ch)) {
    if (!SF_HANDLED_LYRIC_TAGS.has(sub.tag)) extra.push(sfSerializeXmlNode(sub));
  }
  return {
    number: (ch.attrs && ch.attrs.number) || '1',
    text: sfXmlChildText(ch, 'text') || '',
    syllabic: sfXmlChildText(ch, 'syllabic') || null,
    extend: !!extEl,
    extendType: (extEl && extEl.attrs && extEl.attrs.type) || null,
    rawAttrs: Object.assign({}, ch.attrs || {}),
    extraXml: extra.join('')
  };
}

function sfSerializeLyricItem(lyr) {
  const attrsObj = Object.assign({}, lyr.rawAttrs || {});
  attrsObj.number = lyr.number || '1';
  let attrStr = '';
  for (const k of Object.keys(attrsObj)) {
    attrStr += ' ' + k + '="' + sfXmlAttrEscape(attrsObj[k]) + '"';
  }
  const inner = [];
  if (lyr.syllabic) inner.push(`<syllabic>${sfXmlEscape(lyr.syllabic)}</syllabic>`);
  inner.push(`<text>${sfXmlEscape(lyr.text || '')}</text>`);
  if (lyr.extend) {
    inner.push(lyr.extendType ? `<extend type="${sfXmlAttrEscape(lyr.extendType)}"/>` : '<extend/>');
  }
  if (lyr.extraXml) inner.push(lyr.extraXml);
  return `<lyric${attrStr}>${inner.join('')}</lyric>`;
}

const SF_HANDLED_ATTR_TAGS = new Set([
  'divisions', 'key', 'time', 'staves', 'clef', 'transpose'
]);

function sfSyncMeasureBackups(measure) {
  if (!measure || !Array.isArray(measure.entries)) return;
  const div = measure.divisions || 1;
  let curDivs = 0;
  for (const e of measure.entries) {
    if (e.kind === 'backup') {
      const target = (typeof e.targetDivs === 'number' && isFinite(e.targetDivs)) ? Math.max(0, e.targetDivs) : 0;
      e.durationDivs = Math.max(0, Math.round(curDivs - target));
      e.durationQ = e.durationDivs / div;
      curDivs = Math.min(curDivs, target);
    } else if (e.kind === 'forward') {
      curDivs += (e.durationDivs || 0);
    } else if ((e.kind === 'note' || e.kind === 'rest') && !e.isGrace && !e.isChord) {
      curDivs += (e.durationDivs || 0);
    }
  }
}

function sfRecalcMeasureOnsets(measure) {
  sfSyncMeasureBackups(measure);
  const div = measure.divisions || 1;
  let posDivs = 0;
  let lastStartDivs = 0;
  const tempos = [];

  for (const e of measure.entries) {
    if (e.kind === 'backup') {
      e.durationQ = (e.durationDivs || 0) / div;
      e.onsetQ = posDivs / div;
      posDivs -= (e.durationDivs || 0);
      if (posDivs < 0) posDivs = 0;
    } else if (e.kind === 'forward') {
      e.durationQ = (e.durationDivs || 0) / div;
      e.onsetQ = posDivs / div;
      posDivs += (e.durationDivs || 0);
    } else if (e.kind === 'note' || e.kind === 'rest') {
      if (e.isGrace) {
        e.durationQ = 0;
        e.onsetQ = posDivs / div;
      } else if (e.isChord) {
        e.durationQ = (e.durationDivs || 0) / div;
        e.onsetQ = lastStartDivs / div;
      } else {
        e.durationQ = (e.durationDivs || 0) / div;
        lastStartDivs = posDivs;
        e.onsetQ = posDivs / div;
        posDivs += (e.durationDivs || 0);
      }
    } else {
      e.onsetQ = posDivs / div;
      if (e.tempoBpm > 0) {
        tempos.push({ onsetQ: e.onsetQ, bpm: e.tempoBpm });
      }
    }
  }
  measure.tempos = tempos;
}

function sfParseMusicXml(xmlString) {
  const root = sfParseXml(xmlString);
  if (root.tag === 'score-timewise') {
    throw new Error('timewise MusicXML is not supported — re-export as partwise MusicXML');
  }
  if (root.tag !== 'score-partwise') {
    throw new Error('expected <score-partwise> root element, got <' + root.tag + '>');
  }

  const version = root.attrs.version || '3.1';
  const workEl = sfXmlChild(root, 'work');
  const workTitle = (workEl ? sfXmlChildText(workEl, 'work-title') : '') ||
    sfXmlChildText(root, 'movement-title') || '';

  let composer = '';
  const identEl = sfXmlChild(root, 'identification');
  if (identEl) {
    const creators = sfXmlChildren(identEl, 'creator');
    const comp = creators.find(c => (c.attrs.type || '').toLowerCase() === 'composer') || creators[0];
    if (comp) composer = sfXmlText(comp).trim();
  }

  // Preserve top-level header metadata elements in original order
  const headerChunks = [];
  for (const ch of sfXmlChildren(root)) {
    if (SF_HEADER_TAGS.has(ch.tag)) {
      headerChunks.push(sfSerializeXmlNode(ch));
    }
  }
  const headerXml = headerChunks.join('\n  ');

  // Part names from <part-list>
  const partListEl = sfXmlChild(root, 'part-list');
  const partInfoById = {};
  if (partListEl) {
    for (const sp of sfXmlChildren(partListEl, 'score-part')) {
      const id = sp.attrs.id || '';
      const name = sfXmlChildText(sp, 'part-name') || '';
      partInfoById[id] = { id, name };
    }
  }

  const partEls = sfXmlChildren(root, 'part');
  const parts = partEls.map((partEl, pi) => {
    const partId = partEl.attrs.id || ('P' + (pi + 1));
    const partName = (partInfoById[partId] && partInfoById[partId].name) || ('Part ' + (pi + 1));

    let curDiv = 1;
    let curStaves = 1;
    let curTranspose = { diatonic: 0, chromatic: 0, octaveChange: 0 };
    let firstTranspose = null;
    let curKey = { fifths: 0, mode: 'major', modeGiven: false };
    let curTime = { beats: 4, beatType: 4 };
    let curClefs = [{ number: 1, sign: 'G', line: 2, octaveChange: 0 }];

    const measureEls = sfXmlChildren(partEl, 'measure');
    const measures = measureEls.map((mEl, mi) => {
      const number = mEl.attrs.number || String(mi + 1);
      const implicit = (mEl.attrs.implicit || '').toLowerCase() === 'yes';
      const measureAttrs = Object.assign({}, mEl.attrs);

      let hasDivisionsAttr = false;
      let hasKeyAttr = false;
      let hasTimeAttr = false;
      let hasClefAttr = false;
      let stavesAttr = null;
      let transposeAttr = null;
      const extraAttrChunks = [];

      const repeats = { fwd: false, back: 0, ending: null, endClose: false };
      const entries = [];
      let entryCounter = 0;
      let parseCurDivs = 0;

      for (const ch of sfXmlChildren(mEl)) {
        const tag = ch.tag;
        if (tag === 'attributes') {
          const divEl = sfXmlChild(ch, 'divisions');
          if (divEl) {
            const v = Number(sfXmlText(divEl).trim());
            if (isFinite(v) && v > 0) curDiv = v;
            hasDivisionsAttr = true;
          }
          const stEl = sfXmlChild(ch, 'staves');
          if (stEl) {
            const v = parseInt(sfXmlText(stEl).trim(), 10);
            if (v > 0) {
              curStaves = Math.max(curStaves, v);
              stavesAttr = v;
            }
          }
          const trEl = sfXmlChild(ch, 'transpose');
          if (trEl) {
            const dia = sfXmlChildNum(trEl, 'diatonic');
            const chr = sfXmlChildNum(trEl, 'chromatic');
            const oct = sfXmlChildNum(trEl, 'octave-change');
            const tr = {
              diatonic: isFinite(dia) ? dia : 0,
              chromatic: isFinite(chr) ? chr : 0,
              octaveChange: isFinite(oct) ? oct : 0
            };
            curTranspose = tr;
            transposeAttr = Object.assign({}, tr);
            if (!firstTranspose) firstTranspose = Object.assign({}, tr);
          }
          const kyEl = sfXmlChild(ch, 'key');
          if (kyEl && sfXmlChild(kyEl, 'fifths')) {
            const fifths = sfXmlChildNum(kyEl, 'fifths');
            const md = sfXmlChildText(kyEl, 'mode');
            curKey = {
              fifths: isFinite(fifths) ? fifths : 0,
              mode: md || 'major',
              modeGiven: !!md && /major|minor/i.test(md)
            };
            hasKeyAttr = true;
          }
          const tiEl = sfXmlChild(ch, 'time');
          if (tiEl && sfXmlChild(tiEl, 'beats')) {
            const b = parseInt(sfXmlChildText(tiEl, 'beats'), 10) || 4;
            const bt = sfXmlChildNum(tiEl, 'beat-type') || 4;
            curTime = { beats: b, beatType: bt, symbol: tiEl.attrs.symbol || null };
            hasTimeAttr = true;
          }
          const clefEls = sfXmlChildren(ch, 'clef');
          if (clefEls.length) {
            const nextClefs = curClefs.map(c => Object.assign({}, c));
            for (const cEl of clefEls) {
              const cNum = parseInt(cEl.attrs.number || '1', 10) || 1;
              const sign = sfXmlChildText(cEl, 'sign') || 'G';
              const lineVal = sfXmlChildNum(cEl, 'line');
              const octVal = sfXmlChildNum(cEl, 'clef-octave-change');
              const cObj = {
                number: cNum,
                sign,
                line: isFinite(lineVal) ? lineVal : (sign === 'F' ? 4 : sign === 'C' ? 3 : 2),
                octaveChange: isFinite(octVal) ? octVal : 0
              };
              const existingIdx = nextClefs.findIndex(c => c.number === cNum);
              if (existingIdx >= 0) nextClefs[existingIdx] = cObj;
              else nextClefs.push(cObj);
            }
            curClefs = nextClefs;
            hasClefAttr = true;
          }
          for (const sub of sfXmlChildren(ch)) {
            if (!SF_HANDLED_ATTR_TAGS.has(sub.tag)) {
              extraAttrChunks.push(sfSerializeXmlNode(sub));
            }
          }
          entries.push({
            id: `p${pi}_m${mi}_e${entryCounter++}`,
            kind: 'other',
            partIndex: pi,
            measureIndex: mi,
            tag: 'attributes',
            isAttributesSlot: true,
            rawXml: '',
            onsetQ: 0
          });
        } else if (tag === 'note') {
          const isGrace = !!sfXmlChild(ch, 'grace');
          const isCue = !!sfXmlChild(ch, 'cue');
          const isChord = !!sfXmlChild(ch, 'chord');
          const restEl = sfXmlChild(ch, 'rest');
          const pitchEl = sfXmlChild(ch, 'pitch');
          const unpitchedEl = sfXmlChild(ch, 'unpitched');
          const isRest = !!restEl || (!pitchEl && !unpitchedEl);
          const measureRest = !!(restEl && (restEl.attrs.measure || '').toLowerCase() === 'yes');

          const nhEl = sfXmlChild(ch, 'notehead');
          let notehead = nhEl ? sfXmlText(nhEl).trim().toLowerCase() : null;
          const isSpokenHead = notehead === 'x' || notehead === 'cross' || notehead === 'circle-x';
          const spoken = !isRest && (!!unpitchedEl || isSpokenHead);
          if (spoken && !notehead) notehead = 'x';

          let step = null, octave = null, alter = null, midi = null, soundingMidi = null;
          if (!isRest && pitchEl) {
            step = sfXmlChildText(pitchEl, 'step').toUpperCase() || null;
            const octN = sfXmlChildNum(pitchEl, 'octave');
            octave = isFinite(octN) ? octN : null;
            const altN = sfXmlChildNum(pitchEl, 'alter');
            alter = isFinite(altN) ? altN : 0;
            midi = sfPitchToMidi(step, octave, alter);
            soundingMidi = midi !== null ? midi + sfTransposeSemis(curTranspose) : null;
          } else if (!isRest && unpitchedEl) {
            step = sfXmlChildText(unpitchedEl, 'display-step').toUpperCase() || 'B';
            const octN = sfXmlChildNum(unpitchedEl, 'display-octave');
            octave = isFinite(octN) ? octN : 4;
            alter = 0;
            midi = sfPitchToMidi(step, octave, 0);
            soundingMidi = midi !== null ? midi + sfTransposeSemis(curTranspose) : null;
          }

          const durN = sfXmlChildNum(ch, 'duration');
          const durationDivs = isGrace ? 0 : (isFinite(durN) ? durN : 0);
          const voice = sfXmlChildText(ch, 'voice') || '1';
          const staffN = sfXmlChildNum(ch, 'staff');
          const staff = isFinite(staffN) && staffN > 0 ? staffN : 1;
          if (staff > curStaves) curStaves = staff;

          const type = sfXmlChildText(ch, 'type') || null;
          const dots = sfXmlChildren(ch, 'dot').length;
          const accText = sfXmlChildText(ch, 'accidental') || null;
          const ties = [];
          for (const t of sfXmlChildren(ch, 'tie')) {
            const tType = t.attrs.type;
            if (tType && !ties.includes(tType)) ties.push(tType);
          }
          for (const notEl of sfXmlChildren(ch, 'notations')) {
            for (const td of sfXmlChildren(notEl, 'tied')) {
              const tType = td.attrs.type;
              if ((tType === 'start' || tType === 'stop') && !ties.includes(tType)) {
                ties.push(tType);
              }
            }
          }

          const tmEl = sfXmlChild(ch, 'time-modification');
          let timeModification = null;
          if (tmEl) {
            timeModification = {
              actualNotes: sfXmlChildNum(tmEl, 'actual-notes') || 3,
              normalNotes: sfXmlChildNum(tmEl, 'normal-notes') || 2,
              normalType: sfXmlChildText(tmEl, 'normal-type') || null
            };
          }

          const lyrics = isRest ? [] : sfXmlChildren(ch, 'lyric').map(sfParseLyricElement);

          const extraParts = [];
          for (const sub of sfXmlChildren(ch)) {
            if (!SF_HANDLED_NOTE_TAGS.has(sub.tag)) {
              extraParts.push(sfSerializeXmlNode(sub));
            }
          }

          if (!isGrace && !isChord) parseCurDivs += durationDivs;
          entries.push({
            id: `p${pi}_m${mi}_e${entryCounter++}`,
            kind: isRest ? 'rest' : 'note',
            partIndex: pi,
            measureIndex: mi,
            voice,
            staff,
            isChord,
            isRest,
            isGrace,
            isCue,
            measureRest,
            step,
            octave,
            alter,
            accidental: isRest ? null : accText,
            durationDivs,
            durationQ: isGrace ? 0 : durationDivs / (curDiv || 1),
            type,
            dots,
            ties,
            lyrics,
            onsetQ: 0,
            midi,
            soundingMidi,
            spoken,
            notehead: isRest ? null : notehead,
            isUnpitched: !!unpitchedEl,
            timeModification,
            extraXml: extraParts.join('')
          });
        } else if (tag === 'backup' || tag === 'forward') {
          const durN = sfXmlChildNum(ch, 'duration');
          const durationDivs = isFinite(durN) ? durN : 0;
          const voice = sfXmlChildText(ch, 'voice') || null;
          const staffN = sfXmlChildNum(ch, 'staff');
          const staff = isFinite(staffN) && staffN > 0 ? staffN : null;
          let targetDivs;
          if (tag === 'backup') {
            targetDivs = Math.max(0, parseCurDivs - durationDivs);
            parseCurDivs = targetDivs;
          } else {
            parseCurDivs += durationDivs;
          }
          entries.push({
            id: `p${pi}_m${mi}_e${entryCounter++}`,
            kind: tag,
            partIndex: pi,
            measureIndex: mi,
            durationDivs,
            durationQ: durationDivs / (curDiv || 1),
            targetDivs,
            voice,
            staff,
            onsetQ: 0,
            extraXml: ''
          });
        } else {
          let tempoBpm = 0;
          if (tag === 'sound') {
            const bpm = Number(ch.attrs.tempo);
            if (bpm > 0) tempoBpm = bpm;
          } else if (tag === 'direction') {
            const snd = sfXmlFindFirst(ch, 'sound');
            const bpm = snd ? Number(snd.attrs.tempo) : NaN;
            if (bpm > 0) tempoBpm = bpm;
          } else if (tag === 'barline') {
            const rep = sfXmlChild(ch, 'repeat');
            const end = sfXmlChild(ch, 'ending');
            if (rep && rep.attrs.direction === 'forward') repeats.fwd = true;
            if (rep && rep.attrs.direction === 'backward') {
              repeats.back = parseInt(rep.attrs.times || '2', 10) || 2;
            }
            if (end) {
              const nums = (end.attrs.number || '1')
                .split(/[,\s]+/)
                .map(Number)
                .filter(n => n > 0);
              const eType = end.attrs.type || '';
              if (eType === 'start') repeats.ending = nums;
              else if (!repeats.ending && nums.length) repeats.ending = nums;
              if (/stop|discontinue/.test(eType)) repeats.endClose = true;
            }
          }
          entries.push({
            id: `p${pi}_m${mi}_e${entryCounter++}`,
            kind: 'other',
            partIndex: pi,
            measureIndex: mi,
            tag,
            rawXml: sfSerializeXmlNode(ch),
            tempoBpm,
            onsetQ: 0
          });
        }
      }

      const measureObj = {
        index: mi,
        number,
        implicit,
        attrs: measureAttrs,
        divisions: curDiv,
        hasDivisionsAttr,
        key: Object.assign({}, curKey),
        hasKeyAttr,
        time: { beats: curTime.beats, beatType: curTime.beatType, symbol: curTime.symbol || null },
        hasTimeAttr,
        clefs: curClefs.map(c => Object.assign({}, c)),
        hasClefAttr,
        stavesAttr,
        transposeAttr,
        activeTranspose: Object.assign({}, curTranspose),
        extraAttributesXml: extraAttrChunks.join(''),
        repeats,
        tempos: [],
        entries
      };
      sfRecalcMeasureOnsets(measureObj);
      return measureObj;
    });

    return {
      id: partId,
      name: partName,
      staves: curStaves,
      transpose: firstTranspose || { diatonic: 0, chromatic: 0, octaveChange: 0 },
      measures
    };
  });

  const model = {
    version,
    workTitle,
    composer,
    headerXml,
    parts
  };
  sfNormalizeMusicalMarkings(model);
  sfMergeSplitParts(model);
  sfStabilizeKeySignatures(model);
  sfAlignPartSignatures(model);
  sfDedupeChordNotes(model);
  sfAutoFixMissingDots(model);
  sfAutoInferTimeSigChanges(model);
  return model;
}

// ---------- Async .mxl & Auto-Detect Input Loaders
async function sfParseMxl(bufOrUint8) {
  const z = sfUnzipMxlSync(bufOrUint8);
  let rootPath = null;
  if (z['META-INF/container.xml']) {
    const cBytes = await sfInflateEntry(z['META-INF/container.xml']);
    const cDoc = sfParseXml(sfUtf8Decode(cBytes));
    const rf = sfXmlFindFirst(cDoc, 'rootfile');
    if (rf && rf.attrs['full-path']) rootPath = rf.attrs['full-path'];
  }
  if (!rootPath || !z[rootPath]) {
    rootPath = Object.keys(z).find(n => /\.(musicxml|xml)$/i.test(n) && !n.startsWith('META-INF/'));
  }
  if (!rootPath || !z[rootPath]) {
    throw new Error('no MusicXML file found inside .mxl archive');
  }
  const xmlBytes = await sfInflateEntry(z[rootPath]);
  return sfParseMusicXml(sfUtf8Decode(xmlBytes));
}

async function sfParseScoreInput(input) {
  if (typeof input === 'string') return sfParseMusicXml(input);
  if (input && typeof input.arrayBuffer === 'function') {
    input = await input.arrayBuffer();
  }
  const bytes = sfToUint8(input);
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return sfParseMxl(bytes);
  }
  return sfParseMusicXml(sfUtf8Decode(bytes));
}

// ---------- Export Model -> MusicXML 3.1 & .mxl
function sfBuildAttributesXml(measure, needDiv) {
  const parts = [];
  if (needDiv || measure.hasDivisionsAttr) {
    parts.push(`<divisions>${measure.divisions}</divisions>`);
  }
  if (measure.hasKeyAttr && measure.key) {
    const modeTag = measure.key.modeGiven && measure.key.mode
      ? `<mode>${sfXmlEscape(measure.key.mode)}</mode>`
      : '';
    parts.push(`<key><fifths>${measure.key.fifths}</fifths>${modeTag}</key>`);
  }
  if (measure.hasTimeAttr && measure.time) {
    const sym = measure.time.symbol ? ` symbol="${sfXmlAttrEscape(measure.time.symbol)}"` : '';
    parts.push(`<time${sym}><beats>${measure.time.beats}</beats><beat-type>${measure.time.beatType}</beat-type></time>`);
  }
  if (measure.stavesAttr && measure.stavesAttr > 1) {
    parts.push(`<staves>${measure.stavesAttr}</staves>`);
  }
  if (measure.hasClefAttr && measure.clefs && measure.clefs.length) {
    for (const c of measure.clefs) {
      const numAttr = (measure.clefs.length > 1 || c.number > 1) ? ` number="${c.number}"` : '';
      const octTag = c.octaveChange ? `<clef-octave-change>${c.octaveChange}</clef-octave-change>` : '';
      parts.push(`<clef${numAttr}><sign>${sfXmlEscape(c.sign)}</sign><line>${c.line}</line>${octTag}</clef>`);
    }
  }
  if (measure.transposeAttr) {
    const t = measure.transposeAttr;
    const dia = t.diatonic ? `<diatonic>${t.diatonic}</diatonic>` : '';
    const oct = t.octaveChange ? `<octave-change>${t.octaveChange}</octave-change>` : '';
    parts.push(`<transpose>${dia}<chromatic>${t.chromatic || 0}</chromatic>${oct}</transpose>`);
  }
  if (measure.extraAttributesXml) {
    parts.push(measure.extraAttributesXml);
  }
  if (!parts.length) return '';
  return `<attributes>${parts.join('')}</attributes>`;
}

function sfSyncNotationsTied(extraXml, ties) {
  let xml = String(extraXml || '');
  // Strip any existing <tied .../> or <tied>...</tied>
  xml = xml.replace(/<tied\b[^>]*\/>/g, '').replace(/<tied\b[^>]*>[\s\S]*?<\/tied>/g, '');

  const uniqueTies = [];
  for (const t of ties || []) {
    if ((t === 'stop' || t === 'start') && !uniqueTies.includes(t)) uniqueTies.push(t);
  }
  // MusicXML convention: stop before start when both are present
  uniqueTies.sort((a, b) => (a === b ? 0 : (a === 'stop' ? -1 : 1)));

  if (!uniqueTies.length) {
    // Clean up empty <notations> wrappers left after removing <tied>
    xml = xml.replace(/<notations\b[^>]*>\s*<\/notations>/g, '').replace(/<notations\b[^>]*\/>/g, '');
    return xml;
  }

  const tiedTags = uniqueTies.map(t => `<tied type="${sfXmlAttrEscape(t)}"/>`).join('');
  if (/<notations\b[^>]*\/>/.test(xml)) {
    return xml.replace(/<notations(\b[^>]*)?\/>/, '<notations$1>' + tiedTags + '</notations>');
  }
  if (/<notations\b[^>]*>/.test(xml)) {
    return xml.replace(/<notations(\b[^>]*)>/, '<notations$1>' + tiedTags);
  }
  return xml + `<notations>${tiedTags}</notations>`;
}

function sfSerializeNoteEntry(entry, part) {
  const out = [];
  if (entry.isGrace) out.push('<grace/>');
  if (entry.isCue) out.push('<cue/>');
  if (entry.isChord) out.push('<chord/>');

  if (entry.isRest || entry.kind === 'rest') {
    out.push(entry.measureRest ? '<rest measure="yes"/>' : '<rest/>');
  } else {
    const altTag = (entry.alter !== null && entry.alter !== undefined && entry.alter !== 0)
      ? `<alter>${entry.alter}</alter>`
      : '';
    out.push(`<pitch><step>${sfXmlEscape(entry.step)}</step>${altTag}<octave>${entry.octave}</octave></pitch>`);
  }

  if (!entry.isGrace) {
    out.push(`<duration>${entry.durationDivs}</duration>`);
  }
  if (!entry.isRest && entry.ties && entry.ties.length) {
    const seenTies = [];
    for (const t of entry.ties) {
      if (t && !seenTies.includes(t)) {
        seenTies.push(t);
        out.push(`<tie type="${sfXmlAttrEscape(t)}"/>`);
      }
    }
  }
  if (entry.voice) {
    out.push(`<voice>${sfXmlEscape(entry.voice)}</voice>`);
  }
  if (entry.type) {
    out.push(`<type>${sfXmlEscape(entry.type)}</type>`);
  }
  for (let d = 0; d < (entry.dots || 0); d++) {
    out.push('<dot/>');
  }
  if (!entry.isRest && entry.accidental) {
    out.push(`<accidental>${sfXmlEscape(entry.accidental)}</accidental>`);
  }
  if (entry.timeModification) {
    const tm = entry.timeModification;
    const nt = tm.normalType ? `<normal-type>${sfXmlEscape(tm.normalType)}</normal-type>` : '';
    out.push(`<time-modification><actual-notes>${tm.actualNotes}</actual-notes><normal-notes>${tm.normalNotes}</normal-notes>${nt}</time-modification>`);
  }
  if (part.staves > 1 || (entry.staff && entry.staff > 1)) {
    out.push(`<staff>${entry.staff || 1}</staff>`);
  }
  if (!entry.isRest && (entry.spoken || entry.notehead)) {
    out.push(`<notehead>${sfXmlEscape(entry.notehead || 'x')}</notehead>`);
  }
  const extraOut = entry.isRest ? entry.extraXml : sfSyncNotationsTied(entry.extraXml, entry.ties);
  if (extraOut) {
    out.push(extraOut);
  }
  if (!entry.isRest && Array.isArray(entry.lyrics)) {
    for (const lyr of entry.lyrics) {
      out.push(sfSerializeLyricItem(lyr));
    }
  }
  return `<note>${out.join('')}</note>`;
}

function sfExportMusicXml(model) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    `<score-partwise version="${sfXmlAttrEscape(model.version || '3.1')}">`
  ];

  if (model.headerXml && model.headerXml.trim()) {
    lines.push('  ' + model.headerXml.trim());
  } else {
    if (model.workTitle) {
      lines.push(`  <work><work-title>${sfXmlEscape(model.workTitle)}</work-title></work>`);
    }
    if (model.composer) {
      lines.push(`  <identification><creator type="composer">${sfXmlEscape(model.composer)}</creator></identification>`);
    }
    lines.push('  <part-list>');
    for (const p of model.parts || []) {
      lines.push(`    <score-part id="${sfXmlAttrEscape(p.id)}"><part-name>${sfXmlEscape(p.name)}</part-name></score-part>`);
    }
    lines.push('  </part-list>');
  }

  for (const part of model.parts || []) {
    lines.push(`  <part id="${sfXmlAttrEscape(part.id)}">`);
    let emittedDiv = null;

    for (const m of part.measures || []) {
      let mAttrStr = ` number="${sfXmlAttrEscape(m.number)}"`;
      if (m.implicit) mAttrStr += ' implicit="yes"';
      if (m.attrs) {
        for (const k of Object.keys(m.attrs)) {
          if (k === 'number' || k === 'implicit') continue;
          mAttrStr += ` ${k}="${sfXmlAttrEscape(m.attrs[k])}"`;
        }
      }
      lines.push(`    <measure${mAttrStr}>`);

      const needDiv = emittedDiv === null || m.divisions !== emittedDiv;
      let attrsEmitted = false;
      const hasSlot = m.entries.some(e => e.isAttributesSlot);
      if (!hasSlot && (needDiv || m.hasDivisionsAttr || m.hasKeyAttr || m.hasTimeAttr || m.hasClefAttr || m.transposeAttr)) {
        const aXml = sfBuildAttributesXml(m, needDiv);
        if (aXml) lines.push('      ' + aXml);
        emittedDiv = m.divisions;
        attrsEmitted = true;
      }

      for (const e of m.entries) {
        if (e.isAttributesSlot) {
          if (!attrsEmitted) {
            const aXml = sfBuildAttributesXml(m, needDiv);
            if (aXml) lines.push('      ' + aXml);
            emittedDiv = m.divisions;
            attrsEmitted = true;
          }
        } else if (e.kind === 'note' || e.kind === 'rest') {
          lines.push('      ' + sfSerializeNoteEntry(e, part));
        } else if (e.kind === 'backup') {
          if (e.durationDivs > 0) {
            lines.push(`      <backup><duration>${e.durationDivs}</duration></backup>`);
          }
        } else if (e.kind === 'forward') {
          const v = e.voice ? `<voice>${sfXmlEscape(e.voice)}</voice>` : '';
          const st = e.staff ? `<staff>${e.staff}</staff>` : '';
          lines.push(`      <forward><duration>${e.durationDivs}</duration>${v}${st}</forward>`);
        } else if (e.rawXml) {
          lines.push('      ' + e.rawXml);
        }
      }

      lines.push('    </measure>');
    }
    lines.push('  </part>');
  }

  lines.push('</score-partwise>');
  return lines.join('\n') + '\n';
}

function sfExportMxl(model) {
  const xmlStr = sfExportMusicXml(model);
  const containerXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container>',
    '  <rootfiles>',
    '    <rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/>',
    '  </rootfiles>',
    '</container>',
    ''
  ].join('\n');

  return sfZipBuildStored([
    { name: 'META-INF/container.xml', data: sfUtf8Encode(containerXml) },
    { name: 'score.musicxml', data: sfUtf8Encode(xmlStr) }
  ]);
}

// ---------- Playback Score Bridge (matches web/score.js spParse / spPerformance)
function sfDetectModesFallback(M, E) {
  let i = 0;
  while (i < M.length) {
    let j = i;
    while (j + 1 < M.length && M[j + 1].fifths === M[i].fifths) j++;
    const fileMode = M[i].modeGiven ? M[i].mode : null;
    let mode = fileMode;
    if (!mode) {
      const maj = (((M[i].fifths || 0) * 7) % 12 + 12) % 12;
      const min = (maj + 9) % 12;
      const lt = (min + 11) % 12;
      const ev = E.filter(e => e.m >= i && e.m <= j);
      const w = new Array(12).fill(0);
      let tot = 0;
      for (const e of ev) { w[((e.midi % 12) + 12) % 12] += e.dur; tot += e.dur; }
      const lowAt = q => {
        const at = ev.filter(e => Math.abs(e.q - q) < 1e-6);
        return at.length ? ((Math.min(...at.map(e => e.midi)) % 12) + 12) % 12 : -1;
      };
      const q0 = ev.length ? Math.min(...ev.map(e => e.q)) : 0;
      const q1 = ev.length ? Math.max(...ev.map(e => e.q)) : 0;
      let score = 0;
      if (tot && w[lt] / tot > 0.015) score += 2;
      if (w[min] > w[maj]) score += 1; else score -= 1;
      const f = lowAt(q0), l = lowAt(q1);
      if (f === min) score += 1; if (f === maj) score -= 1;
      if (l === min) score += 1.5; if (l === maj) score -= 1.5;
      mode = score >= 2 ? 'minor' : 'major';
    }
    for (let k = i; k <= j; k++) M[k].mode = mode;
    i = j + 1;
  }
}

function sfUnrollFallback(M) {
  const order = [];
  let i = 0, start = 0, pass = 1, guard = 0;
  const done = new Set();
  while (i < M.length && guard++ < 20000) {
    const m = M[i];
    if (m.repFwd && i !== start) { start = i; pass = 1; }
    if (m.ending && !m.ending.includes(pass)) { i++; continue; }
    order.push(i);
    if (m.repBack && !done.has(i)) {
      if (pass < m.repBack) { pass++; i = start; continue; }
      done.add(i); start = i + 1; pass = 1;
    } else if (m.ending && !(M[i + 1] && M[i + 1].ending)) {
      start = i + 1; pass = 1;
    }
    i++;
  }
  return order;
}

function sfPerformanceFallback(sc) {
  const M = sc.measures;
  const order = sfUnrollFallback(M);
  const byM = M.map(() => []);
  for (const e of sc.events) (byM[e.m] || (byM[e.m] = [])).push(e);
  const perf = [], pevents = [], pbeats = [], ptempos = [];
  let q = 0;
  order.forEach((w, k) => {
    const m = M[w];
    const off = q - m.start;
    perf.push({ w, start: q, len: m.len });
    for (const e of byM[w] || []) pevents.push(Object.assign({}, e, { q: e.q + off, pm: k }));
    for (const b of sc.beats) {
      if (b.q >= m.start - 1e-9 && b.q < m.start + m.len - 1e-9) pbeats.push(Object.assign({}, b, { q: b.q + off }));
    }
    for (const t of sc.tempos) {
      if (t.q >= m.start - 1e-9 && t.q < m.start + m.len - 1e-9) ptempos.push(Object.assign({}, t, { q: t.q + off }));
    }
    q += m.len;
  });
  if (!ptempos.length || ptempos[0].q > 0) ptempos.unshift({ q: 0, bpm: (sc.tempos[0] && sc.tempos[0].bpm) || 100 });
  Object.assign(sc, {
    perf,
    pevents,
    pbeats,
    ptempos,
    ptotal: q,
    hasRepeats: order.length !== M.length || order.some((w, k) => w !== k)
  });
}

function sfModelToPlaybackScore(model) {
  const parts = (model.parts || []).map((p, i) => ({
    id: p.id || ('P' + (i + 1)),
    name: p.name || ('Part ' + (i + 1))
  }));
  const staves = (model.parts || []).map(p => p.staves || 1);
  const measures = [];
  const events = [];
  const spokenEvents = [];
  const tempos = [];

  (model.parts || []).forEach((part, pi) => {
    let q = 0;
    let ending = null;
    const open = {};

    (part.measures || []).forEach((m, mi) => {
      const mStart = (pi === 0 || !measures[mi]) ? q : measures[mi].start;
      let maxPos = 0;

      if (pi === 0 && m.tempos && m.tempos.length) {
        for (const t of m.tempos) {
          if (t.bpm > 0) tempos.push({ q: mStart + t.onsetQ, bpm: t.bpm });
        }
      }

      for (const e of m.entries || []) {
        if (e.kind === 'forward') {
          maxPos = Math.max(maxPos, e.onsetQ + e.durationQ);
          continue;
        }
        if (e.kind !== 'note' && e.kind !== 'rest') continue;
        if (e.isGrace) continue;
        const endQ = e.onsetQ + e.durationQ;
        if (endQ > maxPos) maxPos = endQ;

        if (e.isRest || e.isCue) continue;
        if (e.spoken) {
          spokenEvents.push({
            part: pi,
            voice: e.voice || '1',
            q: mStart + e.onsetQ,
            dur: e.durationQ,
            m: mi,
            noteId: e.id
          });
          continue;
        }
        if (e.soundingMidi === null || e.soundingMidi === undefined) continue;
        const midi = Math.round(e.soundingMidi);
        const at = mStart + e.onsetQ;
        const ties = e.ties || [];
        const prev = open[midi];
        if (ties.includes('stop') && prev && Math.abs(prev.q + prev.dur - at) < 1e-3) {
          prev.dur += e.durationQ;
          if (!ties.includes('start')) delete open[midi];
          continue;
        }
        const ev = {
          part: pi,
          voice: e.voice || '1',
          midi,
          q: at,
          dur: e.durationQ,
          m: mi,
          noteId: e.id
        };
        events.push(ev);
        if (ties.includes('start')) open[midi] = ev;
        else delete open[midi];
      }

      if (pi === 0) {
        const beats = (m.time && m.time.beats) || 4;
        const bt = (m.time && m.time.beatType) || 4;
        const nominal = beats * 4 / bt;
        const rp = m.repeats || { fwd: false, back: 0, ending: null, endClose: false };
        if (rp.ending) ending = rp.ending;
        measures[mi] = {
          start: mStart,
          len: maxPos > 1e-6 ? maxPos : nominal,
          num: m.number || String(mi + 1),
          beats,
          bt,
          fifths: (m.key && m.key.fifths) || 0,
          mode: (m.key && m.key.mode) || 'major',
          modeGiven: !!(m.key && m.key.modeGiven),
          repFwd: !!rp.fwd,
          repBack: rp.back || 0,
          ending: rp.ending || ending
        };
        if (rp.endClose) ending = null;
      }
      q = mStart + (measures[mi] ? measures[mi].len : maxPos);
    });
  });

  events.sort((a, b) => a.q - b.q);
  spokenEvents.sort((a, b) => a.q - b.q);

  const lines = [];
  parts.forEach((p, pi) => {
    const acc = staves[pi] > 1 || /accomp|organ|guitar|harp|synth|celest|bass guitar|drum/i.test(p.name);
    const evs = events.filter(e => e.part === pi);
    const counts = {};
    evs.forEach(e => { counts[e.voice] = (counts[e.voice] || 0) + 1; });
    const vs = Object.keys(counts).filter(v => counts[v] > evs.length * 0.1).sort();
    if (!acc && vs.length >= 2) {
      const names = p.name.split(/\s*(?:\/|&|,|\band\b)\s*/i).filter(Boolean);
      vs.forEach((v, k) => lines.push({
        part: pi,
        voice: v,
        acc: false,
        name: names.length === vs.length ? names[k] : `${p.name} ${k === 0 ? 'upper' : k === vs.length - 1 ? 'lower' : k + 1}`
      }));
      evs.forEach(e => {
        const k = vs.indexOf(e.voice);
        e.line = lines.length - vs.length + (k < 0 ? 0 : k);
      });
    } else {
      lines.push({ part: pi, voice: null, acc, name: p.name });
      evs.forEach(e => { e.line = lines.length - 1; });
    }
  });
  parts.forEach((p, pi) => { p.acc = lines.some(l => l.part === pi && l.acc); });

  if (!tempos.length || tempos[0].q > 0) {
    tempos.unshift({ q: 0, bpm: (tempos[0] && tempos[0].bpm) || 100 });
  }

  const beatList = [];
  for (const m of measures) {
    const compound = m.bt === 8 && m.beats % 3 === 0 && m.beats > 3;
    const bu = compound ? 1.5 : 4 / m.bt;
    for (let k = 0, x = m.start; x < m.start + m.len - 1e-6; k++, x += bu) {
      beatList.push({ q: x, accent: k === 0 });
    }
  }
  const total = measures.length ? measures[measures.length - 1].start + measures[measures.length - 1].len : 0;

  if (typeof spDetectModes === 'function') spDetectModes(measures, events);
  else sfDetectModesFallback(measures, events);

  const sc = { parts, lines, measures, events, spokenEvents, tempos, beats: beatList, total };
  if (typeof spPerformance === 'function') spPerformance(sc);
  else sfPerformanceFallback(sc);

  return sc;
}

// ---------- Lookup & Deep Clone
function sfFindEntry(model, noteId) {
  if (!model || !noteId) return null;
  const parts = model.parts || [];
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const measures = part.measures || [];
    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];
      const entries = measure.entries || [];
      for (let ei = 0; ei < entries.length; ei++) {
        if (entries[ei].id === noteId) {
          return { part, measure, entry: entries[ei], partIndex: pi, measureIndex: mi, entryIndex: ei };
        }
      }
    }
  }
  return null;
}

function sfCloneModel(model) {
  return JSON.parse(JSON.stringify(model));
}

// ---------- Correction-Only Edit Mutations
function sfPriorActiveAlter(measure, entryIndex, staff, step, octave) {
  const fifths = (measure.key && measure.key.fifths) || 0;
  let active = sfKeyAlterForStep(fifths, step);
  for (let i = 0; i < entryIndex; i++) {
    const e = measure.entries[i];
    if (e.kind === 'note' && !e.isRest && e.staff === staff && e.step === step && e.octave === octave) {
      active = e.alter || 0;
    }
  }
  return active;
}

function sfStripBeams(extraXml) {
  if (!extraXml) return '';
  return extraXml.replace(/<beam\b[^>]*>[\s\S]*?<\/beam>/g, '').replace(/<beam\b[^>]*\/>/g, '');
}

function sfStripRestIncompatibleXml(extraXml) {
  if (!extraXml) return '';
  return sfStripBeams(extraXml)
    .replace(/<stem\b[^>]*>[\s\S]*?<\/stem>/g, '')
    .replace(/<stem\b[^>]*\/>/g, '')
    .replace(/<notehead\b[^>]*>[\s\S]*?<\/notehead>/g, '')
    .replace(/<tied\b[^>]*\/>/g, '');
}

function sfSpellMidi(targetMidi, fifths, preferFlat) {
  const pc = ((targetMidi % 12) + 12) % 12;
  const oct = Math.floor(targetMidi / 12) - 1;
  // 1. Prefer a spelling already diatonic to the key signature
  for (const step of SF_STEPS) {
    const ka = sfKeyAlterForStep(fifths, step);
    const candidateMidi = (oct + 1) * 12 + SF_PC[step] + ka;
    if (candidateMidi === targetMidi) {
      return { step, octave: oct, alter: ka };
    }
    // Check octave boundary (B# / Cb)
    if (candidateMidi + 12 === targetMidi) return { step, octave: oct + 1, alter: ka };
    if (candidateMidi - 12 === targetMidi) return { step, octave: oct - 1, alter: ka };
  }
  // 2. Natural pitch class if exact match
  for (const step of SF_STEPS) {
    if (SF_PC[step] === pc) {
      return { step, octave: oct, alter: 0 };
    }
  }
  // 3. Chromatic pitch: respect flat vs sharp key or motion direction
  const useFlat = fifths < 0 ? true : (fifths > 0 ? false : !!preferFlat);
  const sharpMap = { 1: ['C', 1], 3: ['D', 1], 6: ['F', 1], 8: ['G', 1], 10: ['A', 1] };
  const flatMap = { 1: ['D', -1], 3: ['E', -1], 6: ['G', -1], 8: ['A', -1], 10: ['B', -1] };
  const pair = (useFlat ? flatMap : sharpMap)[pc];
  return { step: pair[0], octave: oct, alter: pair[1] };
}

function sfSameWrittenPitch(a, b) {
  if (!a || !b || a.isRest || b.isRest) return false;
  return a.step === b.step &&
    a.octave === b.octave &&
    (Number(a.alter) || 0) === (Number(b.alter) || 0);
}

function sfRemoveTieType(entry, tieType) {
  if (!entry) return;
  if (Array.isArray(entry.ties)) {
    entry.ties = entry.ties.filter(t => t !== tieType);
  } else {
    entry.ties = [];
  }
  entry.extraXml = sfSyncNotationsTied(entry.extraXml, entry.ties);
}

function sfAddTieType(entry, tieType) {
  if (!entry) return;
  if (!Array.isArray(entry.ties)) entry.ties = [];
  if (!entry.ties.includes(tieType)) entry.ties.push(tieType);
  entry.extraXml = sfSyncNotationsTied(entry.extraXml, entry.ties);
}

function sfFindPrevTiePartner(model, found) {
  if (!found || !found.entry) return null;
  const { part, measureIndex, entryIndex, entry } = found;
  const voice = entry.voice || '1';
  const staff = entry.staff || 1;
  const curOnsetQ = entry.onsetQ;
  const minMi = Math.max(0, measureIndex - 1);

  const searchMeasure = (mi, matchVoice) => {
    const m = part.measures[mi];
    if (!m) return { found: null, blocked: false, onsetQ: null };
    const startEi = (mi === measureIndex) ? entryIndex - 1 : m.entries.length - 1;
    let targetOnsetQ = null;

    for (let ei = startEi; ei >= 0; ei--) {
      const e = m.entries[ei];
      if ((e.kind !== 'note' && e.kind !== 'rest') || e.isGrace) continue;
      if ((e.staff || 1) !== staff) continue;
      if (matchVoice && (e.voice || '1') !== voice) continue;
      if (mi === measureIndex && Math.abs(e.onsetQ - curOnsetQ) < 1e-6) continue;
      if (e.kind === 'rest' || e.isRest) {
        if (matchVoice) return { found: null, blocked: true, onsetQ: e.onsetQ };
        continue;
      }
      if (targetOnsetQ === null) targetOnsetQ = e.onsetQ;
      else if (Math.abs(e.onsetQ - targetOnsetQ) > 1e-6) return { found: null, blocked: true, onsetQ: targetOnsetQ };
      if (sfSameWrittenPitch(e, entry) && Array.isArray(e.ties) && e.ties.includes('start')) {
        return { found: e, blocked: true, onsetQ: targetOnsetQ };
      }
    }
    return { found: null, blocked: targetOnsetQ !== null, onsetQ: targetOnsetQ };
  };

  for (let mi = measureIndex; mi >= minMi; mi--) {
    const sameV = searchMeasure(mi, true);
    const sameS = searchMeasure(mi, false);
    if (mi < measureIndex && sameS.onsetQ !== null && (sameV.onsetQ === null || sameS.onsetQ > sameV.onsetQ + 1e-6)) {
      if (sameS.found) return sameS.found;
      if (sameS.blocked) return null;
    }
    if (sameV.found) return sameV.found;
    if (sameV.blocked) return null;
    if (sameS.found) return sameS.found;
    if (sameS.blocked) return null;
  }
  return null;
}

function sfCanTiePrev(model, noteId) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { canTie: false, isTied: false, prevId: null };
  const { part, measureIndex, entryIndex, entry } = found;
  if (entry.kind !== 'note' || entry.isRest || entry.isGrace || !entry.step || !isFinite(entry.octave)) {
    return { canTie: false, isTied: false, prevId: null };
  }
  const isTied = Array.isArray(entry.ties) && entry.ties.includes('stop');
  const voice = entry.voice || '1';
  const staff = entry.staff || 1;
  const curOnsetQ = entry.onsetQ;
  const minMi = Math.max(0, measureIndex - 1);

  const searchMeasure = (mi, matchVoice) => {
    const m = part.measures[mi];
    if (!m) return { hit: null, blocked: false, onsetQ: null };
    const startEi = (mi === measureIndex) ? entryIndex - 1 : m.entries.length - 1;
    let targetOnsetQ = null;

    for (let ei = startEi; ei >= 0; ei--) {
      const e = m.entries[ei];
      if ((e.kind !== 'note' && e.kind !== 'rest') || e.isGrace) continue;
      if ((e.staff || 1) !== staff) continue;
      if (matchVoice && (e.voice || '1') !== voice) continue;
      if (mi === measureIndex && Math.abs(e.onsetQ - curOnsetQ) < 1e-6) continue;
      if (e.kind === 'rest' || e.isRest) {
        if (matchVoice) return { hit: null, blocked: true, onsetQ: e.onsetQ };
        continue;
      }
      if (targetOnsetQ === null) targetOnsetQ = e.onsetQ;
      else if (Math.abs(e.onsetQ - targetOnsetQ) > 1e-6) return { hit: null, blocked: true, onsetQ: targetOnsetQ };
      if (sfSameWrittenPitch(e, entry)) {
        return { hit: { canTie: true, isTied, prevId: e.id }, blocked: true, onsetQ: targetOnsetQ };
      }
    }
    return { hit: null, blocked: targetOnsetQ !== null, onsetQ: targetOnsetQ };
  };

  for (let mi = measureIndex; mi >= minMi; mi--) {
    const sameV = searchMeasure(mi, true);
    const sameS = searchMeasure(mi, false);
    if (mi < measureIndex && sameS.onsetQ !== null && (sameV.onsetQ === null || sameS.onsetQ > sameV.onsetQ + 1e-6)) {
      if (sameS.hit) return sameS.hit;
      if (sameS.blocked) return { canTie: false, isTied, prevId: null };
    }
    if (sameV.hit) return sameV.hit;
    if (sameV.blocked) return { canTie: false, isTied, prevId: null };
    if (sameS.hit) return sameS.hit;
    if (sameS.blocked) return { canTie: false, isTied, prevId: null };
  }
  return { canTie: false, isTied, prevId: null };
}

function sfCanTieNext(model, noteId) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { canTie: false, isTied: false, nextId: null };
  const { part, measureIndex, entryIndex, entry } = found;
  if (entry.kind !== 'note' || entry.isRest || entry.isGrace || !entry.step || !isFinite(entry.octave)) {
    return { canTie: false, isTied: false, nextId: null };
  }
  const isTied = Array.isArray(entry.ties) && entry.ties.includes('start');
  const voice = entry.voice || '1';
  const staff = entry.staff || 1;
  const curOnsetQ = entry.onsetQ;
  const maxMi = Math.min(part.measures.length - 1, measureIndex + 1);

  const searchMeasure = (mi, matchVoice) => {
    const m = part.measures[mi];
    if (!m) return { hit: null, blocked: false };
    const startEi = (mi === measureIndex) ? entryIndex + 1 : 0;
    let targetOnsetQ = null;

    for (let ei = startEi; ei < m.entries.length; ei++) {
      const e = m.entries[ei];
      if ((e.kind !== 'note' && e.kind !== 'rest') || e.isGrace) continue;
      if ((e.staff || 1) !== staff) continue;
      if (matchVoice && (e.voice || '1') !== voice) continue;
      if (mi === measureIndex && Math.abs(e.onsetQ - curOnsetQ) < 1e-6) continue;
      if (e.kind === 'rest' || e.isRest) {
        if (matchVoice) return { hit: null, blocked: true };
        continue;
      }
      if (targetOnsetQ === null) targetOnsetQ = e.onsetQ;
      else if (Math.abs(e.onsetQ - targetOnsetQ) > 1e-6) {
        return { hit: null, blocked: true };
      }
      if (sfSameWrittenPitch(entry, e)) {
        return { hit: { canTie: true, isTied, nextId: e.id }, blocked: true };
      }
    }
    return { hit: null, blocked: targetOnsetQ !== null };
  };

  for (let mi = measureIndex; mi <= maxMi; mi++) {
    const sameV = searchMeasure(mi, true);
    if (sameV.hit) return sameV.hit;
    if (sameV.blocked) return { canTie: false, isTied, nextId: null };
    const sameS = searchMeasure(mi, false);
    if (sameS.hit) return sameS.hit;
    if (sameS.blocked) return { canTie: false, isTied, nextId: null };
  }
  return { canTie: false, isTied, nextId: null };
}

function sfToggleTie(model, noteId) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { ok: false, changed: false, tied: false, entry: null, nextEntry: null };
  const { entry } = found;
  if (entry.kind !== 'note' || entry.isRest || entry.isGrace || !entry.step || !isFinite(entry.octave)) {
    return { ok: false, changed: false, tied: false, entry: null, nextEntry: null };
  }

  const info = sfCanTieNext(model, noteId);
  const nextFound = info.nextId ? sfFindEntry(model, info.nextId) : null;
  const nextEntry = nextFound ? nextFound.entry : null;

  if (Array.isArray(entry.ties) && entry.ties.includes('start')) {
    sfRemoveTieType(entry, 'start');
    if (nextEntry) sfRemoveTieType(nextEntry, 'stop');
    return { ok: true, changed: true, tied: false, entry, nextEntry };
  }

  if (info.canTie && nextEntry) {
    sfAddTieType(entry, 'start');
    sfAddTieType(nextEntry, 'stop');
    return { ok: true, changed: true, tied: true, entry, nextEntry };
  }

  // Fallback when user clicked the second note of a tie pair: untie or tie backward
  if (Array.isArray(entry.ties) && entry.ties.includes('stop')) {
    const prevEntry = sfFindPrevTiePartner(model, found);
    sfRemoveTieType(entry, 'stop');
    if (prevEntry) sfRemoveTieType(prevEntry, 'start');
    return { ok: true, changed: true, tied: false, entry: prevEntry || entry, nextEntry: prevEntry ? entry : null };
  }

  const prevInfo = sfCanTiePrev(model, noteId);
  const prevFound = prevInfo.prevId ? sfFindEntry(model, prevInfo.prevId) : null;
  const prevEntry = prevFound ? prevFound.entry : null;
  if (prevInfo.canTie && prevEntry) {
    sfAddTieType(prevEntry, 'start');
    sfAddTieType(entry, 'stop');
    return { ok: true, changed: true, tied: true, entry: prevEntry, nextEntry: entry };
  }

  return { ok: false, changed: false, tied: false, entry, nextEntry: null };
}

function sfRemoveTie(model, startNoteId) {
  const found = sfFindEntry(model, startNoteId);
  if (!found) return { ok: false, changed: false, entry: null, nextEntry: null };
  const { entry } = found;
  if (entry.kind !== 'note' || entry.isRest) {
    return { ok: false, changed: false, entry: null, nextEntry: null };
  }

  const ties = Array.isArray(entry.ties) ? entry.ties : [];
  if (ties.includes('start')) {
    const info = sfCanTieNext(model, startNoteId);
    const nextFound = info.nextId ? sfFindEntry(model, info.nextId) : null;
    const nextEntry = nextFound ? nextFound.entry : null;
    sfRemoveTieType(entry, 'start');
    if (nextEntry) sfRemoveTieType(nextEntry, 'stop');
    return { ok: true, changed: true, entry, nextEntry };
  }

  if (ties.includes('stop')) {
    const prevEntry = sfFindPrevTiePartner(model, found);
    sfRemoveTieType(entry, 'stop');
    if (prevEntry) sfRemoveTieType(prevEntry, 'start');
    return { ok: true, changed: true, entry: prevEntry || entry, nextEntry: prevEntry ? entry : null };
  }

  return { ok: true, changed: false, entry, nextEntry: null };
}

function sfSnapshotTiePartners(model, found) {
  const entry = found && found.entry;
  if (!entry || entry.kind !== 'note' || entry.isRest) return { nextPartner: null, prevPartner: null };
  const nextInfo = (Array.isArray(entry.ties) && entry.ties.includes('start'))
    ? sfCanTieNext(model, entry.id)
    : null;
  const nextPartner = (nextInfo && nextInfo.nextId) ? sfFindEntry(model, nextInfo.nextId).entry : null;
  const prevPartner = (Array.isArray(entry.ties) && entry.ties.includes('stop'))
    ? sfFindPrevTiePartner(model, found)
    : null;
  return { nextPartner, prevPartner };
}

function sfBreakInvalidTiesAfterPitchChange(entry, partners) {
  if (partners.nextPartner && !sfSameWrittenPitch(entry, partners.nextPartner)) {
    sfRemoveTieType(entry, 'start');
    sfRemoveTieType(partners.nextPartner, 'stop');
  }
  if (partners.prevPartner && !sfSameWrittenPitch(partners.prevPartner, entry)) {
    sfRemoveTieType(entry, 'stop');
    sfRemoveTieType(partners.prevPartner, 'start');
  }
}

function sfEditPitchDiatonic(model, noteId, deltaSteps) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { part, measure, entry, entryIndex } = found;
  if (entry.kind !== 'note' || entry.isRest || !entry.step || !isFinite(entry.octave)) {
    return { ok: false, changed: false, entry: null };
  }
  const delta = Math.trunc(Number(deltaSteps) || 0);
  if (delta === 0) return { ok: true, changed: false, entry };

  const curIdx = entry.octave * 7 + SF_STEPS.indexOf(entry.step);
  const minIdx = 0 * 7 + 0;  // C0
  const maxIdx = 9 * 7 + 4;  // G9
  const nextIdx = Math.max(minIdx, Math.min(maxIdx, curIdx + delta));
  if (nextIdx === curIdx) return { ok: true, changed: false, entry };

  const partners = sfSnapshotTiePartners(model, found);
  const newOctave = Math.floor(nextIdx / 7);
  const newStep = SF_STEPS[((nextIdx % 7) + 7) % 7];
  const fifths = (measure.key && measure.key.fifths) || 0;
  const newAlter = sfKeyAlterForStep(fifths, newStep);
  const priorAlter = sfPriorActiveAlter(measure, entryIndex, entry.staff, newStep, newOctave);

  entry.step = newStep;
  entry.octave = newOctave;
  entry.alter = newAlter;
  entry.accidental = (newAlter !== priorAlter) ? sfAlterToAccidental(newAlter) : null;
  entry.midi = sfPitchToMidi(entry.step, entry.octave, entry.alter);
  const tr = measure.activeTranspose || part.transpose;
  entry.soundingMidi = entry.midi !== null ? entry.midi + sfTransposeSemis(tr) : null;
  sfBreakInvalidTiesAfterPitchChange(entry, partners);

  return { ok: true, changed: true, entry };
}

function sfEditPitchSemitone(model, noteId, deltaSemis) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { part, measure, entry, entryIndex } = found;
  if (entry.kind !== 'note' || entry.isRest || entry.midi === null || entry.midi === undefined) {
    return { ok: false, changed: false, entry: null };
  }
  const delta = Math.trunc(Number(deltaSemis) || 0);
  if (delta === 0) return { ok: true, changed: false, entry };

  const targetMidi = Math.max(12, Math.min(127, entry.midi + delta));
  if (targetMidi === entry.midi) return { ok: true, changed: false, entry };

  const partners = sfSnapshotTiePartners(model, found);
  const fifths = (measure.key && measure.key.fifths) || 0;
  const spelled = sfSpellMidi(targetMidi, fifths, delta < 0);
  const priorAlter = sfPriorActiveAlter(measure, entryIndex, entry.staff, spelled.step, spelled.octave);

  entry.step = spelled.step;
  entry.octave = spelled.octave;
  entry.alter = spelled.alter;
  entry.accidental = (spelled.alter !== priorAlter) ? sfAlterToAccidental(spelled.alter) : null;
  entry.midi = targetMidi;
  const tr = measure.activeTranspose || part.transpose;
  entry.soundingMidi = targetMidi + sfTransposeSemis(tr);
  sfBreakInvalidTiesAfterPitchChange(entry, partners);

  return { ok: true, changed: true, entry };
}

function sfInferBaseTypeFromQ(durationQ, dots) {
  const baseQ = dots > 0 ? durationQ / 1.5 : durationQ;
  let bestType = 'quarter';
  let bestDiff = Infinity;
  for (const t of Object.keys(SF_TYPE_TO_Q)) {
    const diff = Math.abs(SF_TYPE_TO_Q[t] - baseQ);
    if (diff < bestDiff) { bestDiff = diff; bestType = t; }
  }
  return bestType;
}

function sfCollectChordGroup(measure, entryIndex) {
  const entry = measure.entries[entryIndex];
  if (!entry || (entry.kind !== 'note' && entry.kind !== 'rest')) return [];
  // Find chord base index
  let baseIdx = entryIndex;
  if (entry.isChord) {
    for (let i = entryIndex - 1; i >= 0; i--) {
      const prev = measure.entries[i];
      if ((prev.kind === 'note' || prev.kind === 'rest') && prev.voice === entry.voice && !prev.isGrace) {
        baseIdx = i;
        if (!prev.isChord) break;
      }
    }
  }
  const group = [measure.entries[baseIdx]];
  for (let i = baseIdx + 1; i < measure.entries.length; i++) {
    const nxt = measure.entries[i];
    if (nxt.kind === 'note' && nxt.voice === entry.voice && !nxt.isGrace) {
      if (nxt.isChord) group.push(nxt);
      else break;
    } else if (nxt.kind === 'rest' && nxt.voice === entry.voice) {
      break;
    } else if (nxt.kind === 'backup' || nxt.kind === 'forward') {
      break;
    }
  }
  return group;
}

function sfEditDuration(model, noteId, baseType, dotted) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { measure, entry, entryIndex } = found;
  if ((entry.kind !== 'note' && entry.kind !== 'rest') || entry.isGrace) {
    return { ok: false, changed: false, entry: null };
  }
  const baseQ = SF_TYPE_TO_Q[baseType];
  if (!baseQ) return { ok: false, changed: false, entry: null };

  const dots = dotted ? 1 : 0;
  const newQ = baseQ * (dots ? 1.5 : 1);
  const den = (SF_TYPE_TO_DEN[baseType] || 1) * (dots ? 2 : 1);

  // Rescale measure divisions cleanly if newQ * measure.divisions is not an integer
  const rawDivs = newQ * measure.divisions;
  if (Math.abs(rawDivs - Math.round(rawDivs)) > 1e-6) {
    const nextDivs = sfLcm(measure.divisions, den);
    const scale = nextDivs / measure.divisions;
    measure.divisions = nextDivs;
    for (const e of measure.entries) {
      if (e.kind === 'note' || e.kind === 'rest' || e.kind === 'backup' || e.kind === 'forward') {
        e.durationDivs = Math.round((e.durationDivs || 0) * scale);
        if (e.kind === 'backup' && typeof e.targetDivs === 'number' && isFinite(e.targetDivs)) {
          e.targetDivs = Math.round(e.targetDivs * scale);
        }
      }
    }
  }

  const newDurationDivs = Math.round(newQ * measure.divisions);
  const group = sfCollectChordGroup(measure, entryIndex);
  let changed = false;
  for (const g of group) {
    if (g.durationDivs !== newDurationDivs || g.type !== baseType || g.dots !== dots || g.measureRest) {
      changed = true;
    }
    g.durationDivs = newDurationDivs;
    g.durationQ = newQ;
    g.type = baseType;
    g.dots = dots;
    g.measureRest = false;
    g.timeModification = null;
    g.extraXml = sfStripBeams(g.extraXml);
  }

  sfRecalcMeasureOnsets(measure);
  return { ok: true, changed, entry };
}

function sfToggleDot(model, noteId) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { entry } = found;
  if ((entry.kind !== 'note' && entry.kind !== 'rest') || entry.isGrace) {
    return { ok: false, changed: false, entry: null };
  }
  const baseType = entry.type || sfInferBaseTypeFromQ(entry.durationQ, entry.dots);
  const nextDotted = !(entry.dots > 0);
  return sfEditDuration(model, noteId, baseType, nextDotted);
}

function sfDeleteOrMakeRest(model, noteId, mode) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { measure, entry, entryIndex } = found;
  if (entry.kind !== 'note' && entry.kind !== 'rest') {
    return { ok: false, changed: false, entry: null };
  }
  const action = mode === 'delete' ? 'delete' : 'rest';

  if (action === 'rest') {
    if (entry.isRest && entry.kind === 'rest') {
      return { ok: true, changed: false, entry };
    }
    // Check if part of a multi-note chord
    const group = sfCollectChordGroup(measure, entryIndex);
    if (group.length > 1) {
      // Removing a single tone from a chord keeps remaining chord tones valid
      return sfDeleteOrMakeRest(model, noteId, 'delete');
    }
    const partners = sfSnapshotTiePartners(model, found);
    if (partners.nextPartner) sfRemoveTieType(partners.nextPartner, 'stop');
    if (partners.prevPartner) sfRemoveTieType(partners.prevPartner, 'start');
    entry.kind = 'rest';
    entry.isRest = true;
    entry.isChord = false;
    entry.step = null;
    entry.octave = null;
    entry.alter = null;
    entry.accidental = null;
    entry.midi = null;
    entry.soundingMidi = null;
    entry.ties = [];
    entry.lyrics = [];
    entry.extraXml = sfStripRestIncompatibleXml(entry.extraXml);
    sfRecalcMeasureOnsets(measure);
    return { ok: true, changed: true, entry };
  }

  // Delete note/rest; if deleting base note of a chord, promote the next chord tone
  const partners = sfSnapshotTiePartners(model, found);
  if (partners.nextPartner) sfRemoveTieType(partners.nextPartner, 'stop');
  if (partners.prevPartner) sfRemoveTieType(partners.prevPartner, 'start');
  if (!entry.isChord) {
    for (let i = entryIndex + 1; i < measure.entries.length; i++) {
      const nxt = measure.entries[i];
      if (nxt.kind === 'backup' || nxt.kind === 'forward') break;
      if ((nxt.kind === 'note' || nxt.kind === 'rest') && nxt.voice === entry.voice && !nxt.isGrace) {
        if (nxt.isChord) nxt.isChord = false;
        break;
      }
    }
  }
  measure.entries.splice(entryIndex, 1);
  sfRecalcMeasureOnsets(measure);
  return { ok: true, changed: true, entry: null };
}

function sfToggleAccidental(model, noteId, targetAcc) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { part, measure, entry } = found;
  if (entry.kind !== 'note' || entry.isRest || !entry.step || !isFinite(entry.octave)) {
    return { ok: false, changed: false, entry: null };
  }

  let acc = targetAcc || 'cycle';
  if (acc === 'cycle') {
    const order = ['none', 'sharp', 'flat', 'natural'];
    const cur = entry.accidental || 'none';
    const idx = order.indexOf(cur);
    acc = order[(idx + 1) % order.length];
  }

  const fifths = (measure.key && measure.key.fifths) || 0;
  let newAlter;
  let newAccidental;
  if (acc === 'none') {
    newAlter = sfKeyAlterForStep(fifths, entry.step);
    newAccidental = null;
  } else if (SF_ACC_TO_ALTER[acc] !== undefined) {
    newAlter = SF_ACC_TO_ALTER[acc];
    newAccidental = acc;
  } else {
    return { ok: false, changed: false, entry: null };
  }

  const partners = sfSnapshotTiePartners(model, found);
  const changed = (entry.alter !== newAlter) || (entry.accidental !== newAccidental);
  entry.alter = newAlter;
  entry.accidental = newAccidental;
  entry.midi = sfPitchToMidi(entry.step, entry.octave, entry.alter);
  const tr = measure.activeTranspose || part.transpose;
  entry.soundingMidi = entry.midi !== null ? entry.midi + sfTransposeSemis(tr) : null;
  if (changed) sfBreakInvalidTiesAfterPitchChange(entry, partners);

  return { ok: true, changed, entry };
}

// ---------- Undo / Redo Session Stack
class SfHistory {
  constructor(initialModel, maxSteps) {
    this.maxSteps = (typeof maxSteps === 'number' && maxSteps > 0) ? Math.floor(maxSteps) : 100;
    this._stack = [{ label: 'Initial', model: sfCloneModel(initialModel) }];
    this._index = 0;
  }

  push(label, nextModel) {
    this._stack.length = this._index + 1;
    this._stack.push({ label: String(label || 'Edit'), model: sfCloneModel(nextModel) });
    while (this._stack.length > this.maxSteps + 1) {
      this._stack.shift();
    }
    this._index = this._stack.length - 1;
    return this.current();
  }

  canUndo() {
    return this._index > 0;
  }

  canRedo() {
    return this._index < this._stack.length - 1;
  }

  undo() {
    if (!this.canUndo()) return null;
    this._index--;
    return this.current();
  }

  redo() {
    if (!this.canRedo()) return null;
    this._index++;
    return this.current();
  }

  current() {
    return sfCloneModel(this._stack[this._index].model);
  }

  undoLabel() {
    return this.canUndo() ? this._stack[this._index].label : null;
  }

  redoLabel() {
    return this.canRedo() ? this._stack[this._index + 1].label : null;
  }

  get length() {
    return this._stack.length;
  }
}

// ---------- OSMD Tap-to-Model Mapper
function sfExtractOsmdMidiCandidates(sourceNote) {
  if (!sourceNote) return [];
  const p = sourceNote.Pitch || sourceNote.pitch || null;
  if (p) {
    if (p.step && isFinite(p.octave)) {
      const m = sfPitchToMidi(String(p.step).toUpperCase(), Number(p.octave), Number(p.alter) || 0);
      return m !== null ? [m] : [];
    }
    if (isFinite(p.midi)) return [Math.round(Number(p.midi))];
    if (isFinite(p.halfTone)) {
      const ht = Math.round(Number(p.halfTone));
      // OSMD Pitch.halfTone uses octXmlDiff=3 -> MIDI = halfTone + 12; also allow direct MIDI mocks
      return [ht + 12, ht];
    }
    if (isFinite(p.FundamentalNote) && isFinite(p.Octave)) {
      const m = (Number(p.Octave) + 4) * 12 + Number(p.FundamentalNote) + (Number(p.AccidentalHalfTones) || 0);
      return [Math.round(m)];
    }
  }
  if (isFinite(sourceNote.midi)) return [Math.round(Number(sourceNote.midi))];
  if (isFinite(sourceNote.halfTone)) {
    const ht = Math.round(Number(sourceNote.halfTone));
    return [ht + 12, ht];
  }
  return [];
}

function sfResolvePartIndex(model, gm, gmIdx, instruments) {
  if (instruments && instruments.length && gm && gm.ParentStaff && gm.ParentStaff.ParentInstrument) {
    const idx = instruments.indexOf(gm.ParentStaff.ParentInstrument);
    if (idx >= 0 && idx < model.parts.length) return idx;
  }
  if (gm && typeof gm.partIndex === 'number' && gm.partIndex >= 0 && gm.partIndex < model.parts.length) {
    return gm.partIndex;
  }
  const instId = gm && gm.ParentStaff && gm.ParentStaff.ParentInstrument && gm.ParentStaff.ParentInstrument.IdString;
  if (instId) {
    const idx = model.parts.findIndex(p => p.id === instId);
    if (idx >= 0) return idx;
  }
  // Fall back to staff-count offset across parts
  let staffCursor = 0;
  for (let pi = 0; pi < model.parts.length; pi++) {
    const st = model.parts[pi].staves || 1;
    if (gmIdx >= staffCursor && gmIdx < staffCursor + st) return pi;
    staffCursor += st;
  }
  return 0;
}

function sfResolveClefForStaff(part, measureIndex, staff) {
  const measures = (part && part.measures) || [];
  const targetStaff = staff || 1;
  for (let mi = measureIndex; mi >= 0; mi--) {
    const m = measures[mi];
    if (!m || !Array.isArray(m.clefs) || !m.clefs.length) continue;
    const hit = m.clefs.find(c => (c.staff || c.number || 1) === targetStaff);
    if (hit) return hit;
  }
  if ((part && part.staves > 1) && targetStaff === 2) {
    return { number: 2, sign: 'F', line: 4, octaveChange: 0 };
  }
  return { number: targetStaff, sign: 'G', line: 2, octaveChange: 0 };
}

function sfDefaultPitchForRest(part, measureIndex, entryIndex, voice, staff) {
  const measures = (part && part.measures) || [];
  const targetStaff = staff || 1;
  for (let mi = measureIndex; mi >= 0; mi--) {
    const m = measures[mi];
    if (!m) continue;
    const startEi = (mi === measureIndex) ? entryIndex - 1 : m.entries.length - 1;
    for (let ei = startEi; ei >= 0; ei--) {
      const e = m.entries[ei];
      if (e.kind === 'note' && !e.isRest && !e.isGrace &&
          (e.staff || 1) === targetStaff && (e.voice || '1') === voice &&
          e.step && isFinite(e.octave)) {
        return { step: e.step, octave: e.octave };
      }
    }
  }
  const clef = sfResolveClefForStaff(part, measureIndex, targetStaff);
  if (clef.sign === 'F') return { step: 'D', octave: 3 };
  if (clef.sign === 'C' && clef.line === 4) return { step: 'A', octave: 3 };
  if (clef.sign === 'C') return { step: 'C', octave: 4 };
  return { step: 'B', octave: 4 };
}

function sfRestToNote(model, entryId, pitchOpts) {
  const found = sfFindEntry(model, entryId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { part, measure, entry, measureIndex, entryIndex } = found;
  if (entry.kind !== 'rest' || !entry.isRest || entry.isGrace) {
    return { ok: false, changed: false, entry: null };
  }
  const fifths = (measure.key && measure.key.fifths) || 0;
  const def = sfDefaultPitchForRest(part, measureIndex, entryIndex, entry.voice || '1', entry.staff || 1);
  const step = (pitchOpts && pitchOpts.step) ? String(pitchOpts.step).toUpperCase() : def.step;
  if (SF_STEPS.indexOf(step) < 0) return { ok: false, changed: false, entry: null };
  const octave = (pitchOpts && isFinite(pitchOpts.octave)) ? Math.trunc(Number(pitchOpts.octave)) : def.octave;
  const alter = (pitchOpts && pitchOpts.alter != null && isFinite(pitchOpts.alter))
    ? Math.trunc(Number(pitchOpts.alter))
    : sfKeyAlterForStep(fifths, step);
  const priorAlter = sfPriorActiveAlter(measure, entryIndex, entry.staff, step, octave);

  entry.kind = 'note';
  entry.isRest = false;
  entry.measureRest = false;
  entry.step = step;
  entry.octave = octave;
  entry.alter = alter;
  entry.accidental = (alter !== priorAlter) ? sfAlterToAccidental(alter) : null;
  entry.midi = sfPitchToMidi(step, octave, alter);
  const tr = measure.activeTranspose || part.transpose;
  entry.soundingMidi = entry.midi !== null ? entry.midi + sfTransposeSemis(tr) : null;
  entry.ties = [];
  if (!entry.type) {
    entry.type = sfInferBaseTypeFromQ(entry.durationQ || 1, entry.dots || 0);
  }
  return { ok: true, changed: true, entry };
}

function sfSetPitchLetter(model, entryId, letter) {
  const L = String(letter || '').toUpperCase();
  if (SF_STEPS.indexOf(L) < 0) return { ok: false, changed: false, entry: null };
  const found = sfFindEntry(model, entryId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { part, measure, entry, measureIndex, entryIndex } = found;
  if ((entry.kind !== 'note' && entry.kind !== 'rest') || entry.isGrace) {
    return { ok: false, changed: false, entry: null };
  }

  const fifths = (measure.key && measure.key.fifths) || 0;
  const newAlter = sfKeyAlterForStep(fifths, L);
  let refMidi;
  let refOctave;
  if (entry.isRest) {
    const def = sfDefaultPitchForRest(part, measureIndex, entryIndex, entry.voice || '1', entry.staff || 1);
    refMidi = sfPitchToMidi(def.step, def.octave, 0);
    refOctave = def.octave;
  } else {
    refMidi = entry.midi != null ? entry.midi : sfPitchToMidi(entry.step, entry.octave, entry.alter || 0);
    refOctave = isFinite(entry.octave) ? entry.octave : 4;
  }

  let bestOct = refOctave;
  let bestDist = Infinity;
  for (let oct = 0; oct <= 8; oct++) {
    const cand = sfPitchToMidi(L, oct, newAlter);
    const dist = Math.abs(cand - refMidi);
    if (dist < bestDist || (dist === bestDist && oct === refOctave)) {
      bestDist = dist;
      bestOct = oct;
    }
  }

  if (entry.isRest) {
    return sfRestToNote(model, entryId, { step: L, octave: bestOct, alter: newAlter });
  }

  const partners = sfSnapshotTiePartners(model, found);
  const changed = entry.step !== L || entry.octave !== bestOct || (entry.alter || 0) !== newAlter;
  const priorAlter = sfPriorActiveAlter(measure, entryIndex, entry.staff, L, bestOct);
  entry.step = L;
  entry.octave = bestOct;
  entry.alter = newAlter;
  entry.accidental = (newAlter !== priorAlter) ? sfAlterToAccidental(newAlter) : null;
  entry.midi = sfPitchToMidi(L, bestOct, newAlter);
  const tr = measure.activeTranspose || part.transpose;
  entry.soundingMidi = entry.midi !== null ? entry.midi + sfTransposeSemis(tr) : null;
  if (changed) sfBreakInvalidTiesAfterPitchChange(entry, partners);
  return { ok: true, changed, entry };
}

function sfEditPitchOctave(model, entryId, deltaOctaves) {
  const found = sfFindEntry(model, entryId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { part, measure, entry } = found;
  if (entry.kind !== 'note' || entry.isRest || !entry.step || !isFinite(entry.octave)) {
    return { ok: false, changed: false, entry: null };
  }
  const d = Math.trunc(Number(deltaOctaves) || 0);
  if (d === 0) return { ok: true, changed: false, entry };

  const newOct = entry.octave + d;
  const newMidi = sfPitchToMidi(entry.step, newOct, entry.alter || 0);
  if (newMidi === null || newMidi < 21 || newMidi > 108) {
    return { ok: true, changed: false, entry };
  }

  const partners = sfSnapshotTiePartners(model, found);
  entry.octave = newOct;
  entry.midi = newMidi;
  const tr = measure.activeTranspose || part.transpose;
  entry.soundingMidi = newMidi + sfTransposeSemis(tr);
  sfBreakInvalidTiesAfterPitchChange(entry, partners);
  return { ok: true, changed: true, entry };
}

const SF_ENHARMONIC_MAP = {
  'C:1':  { step: 'D', alter: -1, octDelta: 0 },
  'D:-1': { step: 'C', alter: 1,  octDelta: 0 },
  'D:1':  { step: 'E', alter: -1, octDelta: 0 },
  'E:-1': { step: 'D', alter: 1,  octDelta: 0 },
  'F:1':  { step: 'G', alter: -1, octDelta: 0 },
  'G:-1': { step: 'F', alter: 1,  octDelta: 0 },
  'G:1':  { step: 'A', alter: -1, octDelta: 0 },
  'A:-1': { step: 'G', alter: 1,  octDelta: 0 },
  'A:1':  { step: 'B', alter: -1, octDelta: 0 },
  'B:-1': { step: 'A', alter: 1,  octDelta: 0 },
  'E:1':  { step: 'F', alter: 0,  octDelta: 0 },
  'F:0':  { step: 'E', alter: 1,  octDelta: 0 },
  'B:1':  { step: 'C', alter: 0,  octDelta: 1 },
  'C:0':  { step: 'B', alter: 1,  octDelta: -1 },
  'C:-1': { step: 'B', alter: 0,  octDelta: -1 },
  'B:0':  { step: 'C', alter: -1, octDelta: 1 },
  'F:-1': { step: 'E', alter: 0,  octDelta: 0 },
  'E:0':  { step: 'F', alter: -1, octDelta: 0 }
};

function sfRespellEnharmonic(model, entryId) {
  const found = sfFindEntry(model, entryId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { part, measure, entry, entryIndex } = found;
  if (entry.kind !== 'note' || entry.isRest || !entry.step || !isFinite(entry.octave)) {
    return { ok: false, changed: false, entry: null };
  }
  const key = `${entry.step}:${Number(entry.alter) || 0}`;
  const target = SF_ENHARMONIC_MAP[key];
  if (!target) return { ok: true, changed: false, entry };

  const partners = sfSnapshotTiePartners(model, found);
  const newOct = entry.octave + target.octDelta;
  const priorAlter = sfPriorActiveAlter(measure, entryIndex, entry.staff, target.step, newOct);
  entry.step = target.step;
  entry.octave = newOct;
  entry.alter = target.alter;
  entry.accidental = (target.alter !== priorAlter) ? sfAlterToAccidental(target.alter) : null;
  entry.midi = sfPitchToMidi(entry.step, entry.octave, entry.alter);
  const tr = measure.activeTranspose || part.transpose;
  entry.soundingMidi = entry.midi !== null ? entry.midi + sfTransposeSemis(tr) : null;
  sfBreakInvalidTiesAfterPitchChange(entry, partners);
  return { ok: true, changed: true, entry };
}

function sfNextEntryId(partIndex, measureIndex, measure) {
  let maxN = 0;
  const prefix = `p${partIndex}_m${measureIndex}_e`;
  for (const e of measure.entries || []) {
    if (e.id && e.id.startsWith(prefix)) {
      const n = parseInt(e.id.slice(prefix.length), 10);
      if (isFinite(n) && n >= maxN) maxN = n + 1;
    }
  }
  return prefix + maxN;
}

function sfEnsureDivisionsForDuration(measure, baseType, dots) {
  const baseQ = SF_TYPE_TO_Q[baseType];
  if (!baseQ) return null;
  const newQ = baseQ * (dots ? 1.5 : 1);
  const den = (SF_TYPE_TO_DEN[baseType] || 1) * (dots ? 2 : 1);
  const rawDivs = newQ * measure.divisions;
  if (Math.abs(rawDivs - Math.round(rawDivs)) > 1e-6) {
    const nextDivs = sfLcm(measure.divisions, den);
    const scale = nextDivs / measure.divisions;
    measure.divisions = nextDivs;
    for (const e of measure.entries) {
      if (e.kind === 'note' || e.kind === 'rest' || e.kind === 'backup' || e.kind === 'forward') {
        e.durationDivs = Math.round((e.durationDivs || 0) * scale);
        if (e.kind === 'backup' && typeof e.targetDivs === 'number' && isFinite(e.targetDivs)) {
          e.targetDivs = Math.round(e.targetDivs * scale);
        }
      }
    }
  }
  return { newQ, durationDivs: Math.round(newQ * measure.divisions) };
}

function sfInsertAfter(model, entryId, kind, opts) {
  const found = sfFindEntry(model, entryId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { part, measure, entry, partIndex, measureIndex, entryIndex } = found;
  if (entry.kind !== 'note' && entry.kind !== 'rest') {
    return { ok: false, changed: false, entry: null };
  }
  const o = opts || {};
  const isRest = kind === 'rest';
  const baseType = o.type || entry.type || sfInferBaseTypeFromQ(entry.durationQ || 1, entry.dots || 0);
  const dots = o.dots != null ? (o.dots ? 1 : 0) : (entry.dots || 0);
  const durInfo = sfEnsureDivisionsForDuration(measure, baseType, dots);
  if (!durInfo) return { ok: false, changed: false, entry: null };

  const voice = entry.voice || '1';
  const staff = entry.staff || 1;
  const beats = (measure.time && measure.time.beats) || 4;
  const bt = (measure.time && measure.time.beatType) || 4;
  const expectedQ = beats * 4 / bt;
  const sameVoiceEntries = measure.entries.filter(e =>
    (e.kind === 'note' || e.kind === 'rest') && !e.isGrace &&
    (e.voice || '1') === voice && (e.staff || 1) === staff
  );
  const isSoleFullRest = entry.isRest && sameVoiceEntries.length === 1 &&
    (entry.measureRest || (entry.durationQ || 0) >= expectedQ - 0.01);

  // If inserting into a blank whole-measure rest, replace it at beat 1 (onsetQ = 0) instead of appending at beat 4
  if (isSoleFullRest) {
    const oldDivs = entry.durationDivs || 0;
    const newDivs = durInfo.durationDivs;
    if (!isRest) {
      const fifths = (measure.key && measure.key.fifths) || 0;
      const def = sfDefaultPitchForRest(part, measureIndex, entryIndex, voice, staff);
      const step = o.step ? String(o.step).toUpperCase() : def.step;
      const octave = isFinite(o.octave) ? Math.trunc(Number(o.octave)) : def.octave;
      const alter = sfKeyAlterForStep(fifths, step);
      return sfPlaceNoteAt(model, {
        partIndex,
        measureIndex,
        staff,
        voice,
        targetEntryId: entry.id,
        step,
        octave,
        alter,
        type: baseType,
        dots
      });
    }
    entry.measureRest = false;
    entry.durationDivs = newDivs;
    entry.durationQ = durInfo.newQ;
    entry.type = baseType;
    entry.dots = dots;
    if (oldDivs > newDivs) {
      const remRests = sfDecomposeRestDivs(oldDivs - newDivs, measure.divisions).map(r => ({
        id: '',
        kind: 'rest',
        partIndex,
        measureIndex,
        voice,
        staff,
        isChord: false,
        isRest: true,
        isGrace: false,
        isCue: false,
        measureRest: false,
        step: null,
        octave: null,
        alter: null,
        accidental: null,
        durationDivs: r.durationDivs,
        durationQ: r.durationQ,
        type: r.type,
        dots: r.dots,
        ties: [],
        onsetQ: 0,
        midi: null,
        soundingMidi: null,
        spoken: false,
        notehead: null,
        isUnpitched: false,
        timeModification: null,
        extraXml: ''
      }));
      measure.entries.splice(entryIndex + 1, 0, ...remRests);
    }
    sfReindexModelParts(model);
    sfRecalcMeasureOnsets(measure);
    return { ok: true, changed: true, entry };
  }

  const id = sfNextEntryId(partIndex, measureIndex, measure);

  // Insert after any chord tones belonging to the target entry
  let insertIdx = entryIndex + 1;
  while (insertIdx < measure.entries.length) {
    const nxt = measure.entries[insertIdx];
    if (nxt.kind === 'note' && nxt.isChord && (nxt.voice || '1') === voice) {
      insertIdx++;
    } else {
      break;
    }
  }

  let step = null, octave = null, alter = null, accidental = null, midi = null, soundingMidi = null;
  if (!isRest) {
    const fifths = (measure.key && measure.key.fifths) || 0;
    const def = (!entry.isRest && entry.step && isFinite(entry.octave))
      ? { step: entry.step, octave: entry.octave }
      : sfDefaultPitchForRest(part, measureIndex, entryIndex, voice, staff);
    step = o.step ? String(o.step).toUpperCase() : def.step;
    octave = isFinite(o.octave) ? Math.trunc(Number(o.octave)) : def.octave;
    alter = sfKeyAlterForStep(fifths, step);
    const priorAlter = sfPriorActiveAlter(measure, insertIdx, staff, step, octave);
    accidental = (alter !== priorAlter) ? sfAlterToAccidental(alter) : null;
    midi = sfPitchToMidi(step, octave, alter);
    const tr = measure.activeTranspose || part.transpose;
    soundingMidi = midi !== null ? midi + sfTransposeSemis(tr) : null;
  }

  const newEntry = {
    id,
    kind: isRest ? 'rest' : 'note',
    partIndex,
    measureIndex,
    voice,
    staff,
    isChord: false,
    isRest,
    isGrace: false,
    isCue: false,
    measureRest: false,
    step,
    octave,
    alter,
    accidental,
    durationDivs: durInfo.durationDivs,
    durationQ: durInfo.newQ,
    type: baseType,
    dots,
    ties: [],
    onsetQ: 0,
    midi,
    soundingMidi,
    timeModification: null,
    extraXml: ''
  };

  measure.entries.splice(insertIdx, 0, newEntry);
  sfRecalcMeasureOnsets(measure);
  return { ok: true, changed: true, entry: newEntry };
}

// ---------- Lyrics, Text Directions & Navigation
function sfParseExtraWrap(extraXml) {
  if (!extraXml || !extraXml.trim()) return [];
  const doc = sfParseXml('<sf-wrap>' + extraXml + '</sf-wrap>');
  return doc.children || [];
}

function sfGetNoteLyric(entry, verse) {
  if (!entry || entry.isRest) return '';
  const v = String(verse || 1);
  if (Array.isArray(entry.lyrics)) {
    const lyr = entry.lyrics.find(l => String(l.number || '1') === v);
    if (!lyr || !lyr.text) return '';
    return (lyr.syllabic === 'begin' || lyr.syllabic === 'middle') ? (lyr.text + '-') : lyr.text;
  }
  if (!entry.extraXml) return '';
  let children;
  try { children = sfParseExtraWrap(entry.extraXml); } catch { return ''; }
  for (const ch of children) {
    if (ch.type === 'element' && ch.tag === 'lyric' && (ch.attrs.number || '1') === v) {
      const txt = sfXmlChildText(ch, 'text');
      if (!txt) return '';
      const syl = sfXmlChildText(ch, 'syllabic');
      return (syl === 'begin' || syl === 'middle') ? (txt + '-') : txt;
    }
  }
  return '';
}

function sfSetNoteLyric(model, entryId, text, opts) {
  const found = sfFindEntry(model, entryId);
  if (!found) return { ok: false, changed: false, entry: null, lyric: '' };
  const { entry } = found;
  if (entry.kind !== 'note' || entry.isRest) {
    return { ok: false, changed: false, entry: null, lyric: '' };
  }
  const o = opts || {};
  const v = String(o.verse || 1);
  const raw = String(text == null ? '' : text).trim();
  if (!Array.isArray(entry.lyrics)) entry.lyrics = [];
  const idx = entry.lyrics.findIndex(l => String(l.number || '1') === v);

  if (raw === '') {
    if (idx < 0) return { ok: true, changed: false, entry, lyric: '' };
    entry.lyrics.splice(idx, 1);
    return { ok: true, changed: true, entry, lyric: '' };
  }

  const existing = idx >= 0 ? entry.lyrics[idx] : null;
  const hasDash = raw.length > 1 && raw.endsWith('-');
  const cleanText = hasDash ? raw.slice(0, -1).trim() : raw;
  const syllabic = o.syllabic !== undefined
    ? o.syllabic
    : (hasDash ? ((existing && existing.syllabic === 'middle') ? 'middle' : 'begin') : 'single');
  const extend = o.extend !== undefined ? !!o.extend : (existing ? !!existing.extend : false);
  const extendType = o.extendType !== undefined ? o.extendType : (extend && existing ? existing.extendType : null);

  if (existing) {
    existing.text = cleanText;
    existing.syllabic = syllabic;
    existing.extend = extend;
    existing.extendType = extendType;
  } else {
    entry.lyrics.push({
      number: v,
      text: cleanText,
      syllabic,
      extend,
      extendType,
      rawAttrs: { number: v },
      extraXml: ''
    });
  }
  return { ok: true, changed: true, entry, lyric: sfGetNoteLyric(entry, v) };
}

// ---------- Musical Markings Normalization & Spoken / Clear Measure
const SF_XML_DYNAMICS = new Set([
  'ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff', 'fp', 'sf', 'sfz', 'sffz', 'rf', 'rfz', 'fz'
]);

const SF_UNAMBIGUOUS_LYRIC_DYNAMICS = new Set([
  'ppp', 'pp', 'mp', 'mf', 'ff', 'fff', 'fp', 'sfz', 'rfz', 'cresc.', 'decresc.', 'dim.'
]);

const SF_DYNAMIC_OCR_ALIASES = {
  'p p p': 'ppp', 'p p': 'pp', 'm p': 'mp', 'm f': 'mf', 'f f': 'ff', 'f f f': 'fff',
  'f p': 'fp', 's f': 'sf', 's f z': 'sfz', 's f f z': 'sffz', 'r f': 'rf', 'r f z': 'rfz', 'f z': 'fz'
};

const SF_DYNAMIC_WORDS_RE = /^(?:cresc\.?|crescendo|decresc\.?|decrescendo|dim\.?|diminuendo|sub\.?\s*[pf]+|subito\s+[pf]+)$/i;
const SF_TEMPO_ITALIC_RE = /^(?:rit\.?|ritard\.?|ritardando|rall\.?|rallentando|accel\.?|accelerando|rubato)$/i;
const SF_TEMPO_BOLD_RE = /^(?:allegro|andante|adagio|moderato|largo|presto|vivace|maestoso|lento|grave|a\s+tempo|meno\s+mosso|pi[uù]\s+mosso)\b/i;
const SF_VOCAL_WORDS_RE = /^(?:spoken|speak|shout|shouted|whisper|whispered|clap|snap|stomp|chant|sprechstimme|sung|sing)$/i;
const SF_EXPRESSION_WORDS_RE = /^(?:dolce|espressivo|espr\.?|legato|staccato|marcato|cantabile|molto|poco|subito|solo|soli|tutti|div\.?|unis\.?|con\s+fuoco|animato|sostenuto|tenuto|sim\.?|simile)$/i;
const SF_NAVIGATION_WORDS_RE = /^(?:D\.?C\.?(?:\s+al\s+(?:Fine|Coda))?|D\.?S\.?(?:\s+al\s+(?:Fine|Coda))?|Fine|To\s+Coda|Coda|Dal\s+Segno|Da\s+Capo)$/i;

function sfClassifyDirectionText(rawText) {
  const trimmed = String(rawText == null ? '' : rawText).trim();
  if (!trimmed) return { kind: 'text', text: '', isXmlDynamic: false };

  const collapsed = trimmed.toLowerCase().replace(/\s+/g, ' ');
  const alias = SF_DYNAMIC_OCR_ALIASES[collapsed] || collapsed;
  if (SF_XML_DYNAMICS.has(alias)) {
    return { kind: 'dynamic', isXmlDynamic: true, tag: alias, text: alias };
  }
  if (SF_DYNAMIC_WORDS_RE.test(trimmed)) {
    return { kind: 'dynamic', isXmlDynamic: false, italic: true, text: trimmed };
  }
  if (SF_VOCAL_WORDS_RE.test(trimmed)) {
    return { kind: 'vocal', isXmlDynamic: false, italic: true, text: trimmed };
  }
  if (SF_TEMPO_ITALIC_RE.test(trimmed)) {
    return { kind: 'tempo', isXmlDynamic: false, italic: true, text: trimmed };
  }
  if (SF_TEMPO_BOLD_RE.test(trimmed)) {
    return { kind: 'tempo', isXmlDynamic: false, bold: true, text: trimmed };
  }
  if (SF_NAVIGATION_WORDS_RE.test(trimmed)) {
    return { kind: 'navigation', isXmlDynamic: false, bold: true, text: trimmed };
  }
  if (SF_EXPRESSION_WORDS_RE.test(trimmed)) {
    return { kind: 'expression', isXmlDynamic: false, italic: true, text: trimmed };
  }
  return { kind: 'text', isXmlDynamic: false, text: trimmed };
}

function sfBuildDirectionXml(cls, placement, staff) {
  const pl = placement || (cls.kind === 'dynamic' ? 'below' : 'above');
  const staffTag = (staff && staff > 1) ? `<staff>${staff}</staff>` : '';
  if (cls.isXmlDynamic) {
    return `<direction placement="${sfXmlAttrEscape(pl)}"><direction-type><dynamics><${cls.tag}/></dynamics></direction-type>${staffTag}</direction>`;
  }
  const styleAttr = cls.italic ? ' font-style="italic"' : (cls.bold ? ' font-weight="bold"' : '');
  return `<direction placement="${sfXmlAttrEscape(pl)}"><direction-type><words${styleAttr}>${sfXmlEscape(cls.text)}</words></direction-type>${staffTag}</direction>`;
}

function sfNormalizeMusicalMarkings(model) {
  if (!model || !Array.isArray(model.parts)) return model;
  for (let pi = 0; pi < model.parts.length; pi++) {
    const part = model.parts[pi];
    for (let mi = 0; mi < (part.measures || []).length; mi++) {
      const m = part.measures[mi];
      let inserted = false;

      // 1. Normalize existing <direction> entries
      for (const e of m.entries || []) {
        if (e.kind !== 'other' || e.tag !== 'direction' || !e.rawXml) continue;
        let el;
        try { el = sfParseXml(e.rawXml); } catch { continue; }
        const dynEl = sfXmlFindFirst(el, 'dynamics');
        if (dynEl) {
          const dynChild = sfXmlChildren(dynEl)[0];
          e.markingKind = 'dynamic';
          e.markingValue = dynChild ? dynChild.tag : '';
          continue;
        }
        const wordsEl = sfXmlFindFirst(el, 'words');
        if (!wordsEl) continue;
        const txt = sfXmlText(wordsEl).trim();
        const cls = sfClassifyDirectionText(txt);
        e.markingKind = cls.kind;
        e.markingValue = cls.text;
        if (cls.isXmlDynamic) {
          const dt = sfXmlChild(el, 'direction-type') || el;
          dt.children = [{
            type: 'element',
            tag: 'dynamics',
            attrs: {},
            children: [{ type: 'element', tag: cls.tag, attrs: {}, children: [] }]
          }];
          e.rawXml = sfSerializeXmlNode(el);
        } else if (cls.italic || cls.bold) {
          if (cls.italic && !wordsEl.attrs['font-style']) wordsEl.attrs['font-style'] = 'italic';
          if (cls.bold && !wordsEl.attrs['font-weight']) wordsEl.attrs['font-weight'] = 'bold';
          e.rawXml = sfSerializeXmlNode(el);
        }
      }

      // 2. Rescue unambiguous dynamics mistaken for <lyric>
      for (let ei = 0; ei < m.entries.length; ei++) {
        const e = m.entries[ei];
        if (e.kind !== 'note' || e.isRest || !Array.isArray(e.lyrics) || !e.lyrics.length) continue;
        const keptLyrics = [];
        const rescued = [];
        for (const lyr of e.lyrics) {
          const lText = String(lyr.text || '').trim();
          const normL = lText.toLowerCase().replace(/\s+/g, ' ');
          const aliasL = SF_DYNAMIC_OCR_ALIASES[normL] || normL;
          if (SF_UNAMBIGUOUS_LYRIC_DYNAMICS.has(aliasL) || SF_UNAMBIGUOUS_LYRIC_DYNAMICS.has(lText.toLowerCase())) {
            rescued.push(lText);
            continue;
          }
          keptLyrics.push(lyr);
        }
        if (rescued.length) {
          e.lyrics = keptLyrics;
          for (const rTxt of rescued) {
            const cls = sfClassifyDirectionText(rTxt);
            const rawXml = sfBuildDirectionXml(cls, 'below', e.staff || 1);
            const dirEntry = {
              id: sfNextEntryId(pi, mi, m),
              kind: 'other',
              partIndex: pi,
              measureIndex: mi,
              tag: 'direction',
              rawXml,
              markingKind: cls.kind,
              markingValue: cls.text,
              tempoBpm: 0,
              onsetQ: e.onsetQ || 0
            };
            m.entries.splice(ei, 0, dirEntry);
            ei++;
            inserted = true;
          }
        }
      }

      if (inserted) sfRecalcMeasureOnsets(m);
    }
  }
  return model;
}

function sfToggleSpoken(model, entryId) {
  const found = sfFindEntry(model, entryId);
  if (!found) return { ok: false, changed: false, spoken: false, entry: null };
  const { part, measure, entry } = found;
  if (entry.kind !== 'note' || entry.isRest || entry.isGrace) {
    return { ok: false, changed: false, spoken: false, entry: null };
  }

  const nextSpoken = !entry.spoken;
  entry.spoken = nextSpoken;
  if (nextSpoken) {
    entry.notehead = 'x';
    const partners = sfSnapshotTiePartners(model, found);
    if (partners.nextPartner) sfRemoveTieType(partners.nextPartner, 'stop');
    if (partners.prevPartner) sfRemoveTieType(partners.prevPartner, 'start');
    entry.ties = [];
    entry.extraXml = sfSyncNotationsTied(entry.extraXml, []);
    entry.accidental = null;
    entry.alter = 0;
    entry.midi = sfPitchToMidi(entry.step, entry.octave, 0);
    const tr = measure.activeTranspose || part.transpose;
    entry.soundingMidi = entry.midi !== null ? entry.midi + sfTransposeSemis(tr) : null;
  } else {
    entry.notehead = null;
    entry.isUnpitched = false;
  }
  return { ok: true, changed: true, spoken: nextSpoken, entry };
}

function sfGetEntryStaff(e) {
  if (!e) return 1;
  if (e.staff && isFinite(e.staff)) return Math.trunc(Number(e.staff));
  if (e.rawXml) {
    const m = e.rawXml.match(/<staff>\s*(\d+)\s*<\/staff>/);
    if (m) return parseInt(m[1], 10) || 1;
  }
  return 1;
}

function sfRebuildGrandStaffEntries(measure, numStaves, head, entriesByStaff, tail) {
  const beats = (measure.time && measure.time.beats) || 4;
  const bt = (measure.time && measure.time.beatType) || 4;
  const expectedQ = beats * 4 / bt;
  const expectedDivs = Math.max(1, Math.round(expectedQ * (measure.divisions || 1)));
  const out = head.slice();
  for (let st = 1; st <= numStaves; st++) {
    if (st > 1) {
      out.push({
        id: '',
        kind: 'backup',
        partIndex: measure.entries[0] ? measure.entries[0].partIndex : 0,
        measureIndex: measure.index,
        durationDivs: expectedDivs,
        durationQ: expectedQ,
        targetDivs: 0,
        voice: null,
        staff: null,
        onsetQ: expectedQ,
        extraXml: ''
      });
    }
    const list = entriesByStaff[st] || [];
    for (const item of list) {
      if (item.kind !== 'backup') out.push(item);
    }
  }
  for (const b of tail) out.push(b);
  measure.entries = out;
}

function sfClearPartMeasure(model, partIndex, measureIndex, staff) {
  const part = model && model.parts && model.parts[partIndex];
  const measure = part && part.measures && part.measures[measureIndex];
  if (!measure) return { ok: false, changed: false, entry: null };

  const numStaves = part.staves || 1;
  const targetStaff = (staff != null && numStaves > 1) ? Math.trunc(Number(staff)) : null;

  const preserved = [];
  for (const e of measure.entries || []) {
    if (e.isAttributesSlot || (e.kind === 'other' && (e.tag === 'barline' || e.tag === 'sound' || e.tag === 'print' || (e.tag === 'direction' && e.tempoBpm > 0)))) {
      preserved.push(e);
    }
  }

  const beats = (measure.time && measure.time.beats) || 4;
  const bt = (measure.time && measure.time.beatType) || 4;
  const expectedQ = beats * 4 / bt;
  const expectedDivs = Math.max(1, Math.round(expectedQ * (measure.divisions || 1)));

  // Put attributes/sound/tempo first, barlines last, and whole-measure rest(s) in between
  const head = preserved.filter(e => e.isAttributesSlot || e.tag === 'sound' || e.tag === 'print' || e.tag === 'direction');
  const tail = preserved.filter(e => e.tag === 'barline');

  if (targetStaff != null) {
    const entriesByStaff = {};
    for (let st = 1; st <= numStaves; st++) entriesByStaff[st] = [];
    let existingVoice = null;
    const otherVoices = new Set();

    for (const e of measure.entries || []) {
      if (e.isAttributesSlot || e.kind === 'backup') continue;
      if (e.kind === 'other' && (e.tag === 'barline' || e.tag === 'sound' || e.tag === 'print' || (e.tag === 'direction' && e.tempoBpm > 0))) continue;
      const st = sfGetEntryStaff(e);
      if (st === targetStaff) {
        if (!existingVoice && (e.kind === 'note' || e.kind === 'rest') && e.voice) existingVoice = e.voice;
      } else {
        if ((e.kind === 'note' || e.kind === 'rest') && e.voice) otherVoices.add(e.voice);
        (entriesByStaff[st] || (entriesByStaff[st] = [])).push(e);
      }
    }

    let voice = existingVoice || (targetStaff === 1 ? '1' : '5');
    if (otherVoices.has(voice)) {
      const candidates = ['1', '5', '2', '6', '3', '7', '4', '8'];
      voice = candidates.find(v => !otherVoices.has(v)) || String(targetStaff + 4);
    }

    const restEntry = {
      id: '',
      kind: 'rest',
      partIndex,
      measureIndex,
      voice,
      staff: targetStaff,
      isChord: false,
      isRest: true,
      isGrace: false,
      isCue: false,
      measureRest: true,
      step: null,
      octave: null,
      alter: null,
      accidental: null,
      durationDivs: expectedDivs,
      durationQ: expectedQ,
      type: 'whole',
      dots: 0,
      ties: [],
      onsetQ: 0,
      midi: null,
      soundingMidi: null,
      spoken: false,
      notehead: null,
      isUnpitched: false,
      timeModification: null,
      extraXml: ''
    };
    entriesByStaff[targetStaff] = [restEntry];
    sfRebuildGrandStaffEntries(measure, numStaves, head, entriesByStaff, tail);
    sfReindexModelParts(model);
    sfRecalcMeasureOnsets(measure);
    return { ok: true, changed: true, entry: restEntry };
  }

  measure.entries = head.slice();
  let firstRest = null;
  for (let st = 1; st <= numStaves; st++) {
    if (st > 1) {
      measure.entries.push({
        id: sfNextEntryId(partIndex, measureIndex, measure),
        kind: 'backup',
        partIndex,
        measureIndex,
        durationDivs: expectedDivs,
        durationQ: expectedQ,
        targetDivs: 0,
        voice: null,
        staff: null,
        onsetQ: expectedQ,
        extraXml: ''
      });
    }
    const restEntry = {
      id: sfNextEntryId(partIndex, measureIndex, measure),
      kind: 'rest',
      partIndex,
      measureIndex,
      voice: String(st === 1 ? '1' : (st === 2 ? '5' : st)),
      staff: st,
      isChord: false,
      isRest: true,
      isGrace: false,
      isCue: false,
      measureRest: true,
      step: null,
      octave: null,
      alter: null,
      accidental: null,
      durationDivs: expectedDivs,
      durationQ: expectedQ,
      type: 'whole',
      dots: 0,
      ties: [],
      onsetQ: 0,
      midi: null,
      soundingMidi: null,
      spoken: false,
      notehead: null,
      isUnpitched: false,
      timeModification: null,
      extraXml: ''
    };
    if (!firstRest) firstRest = restEntry;
    measure.entries.push(restEntry);
  }
  for (const b of tail) measure.entries.push(b);

  sfRecalcMeasureOnsets(measure);
  return { ok: true, changed: true, entry: firstRest };
}

function sfGetDirectionText(entry) {
  if (!entry || entry.kind !== 'other' || entry.tag !== 'direction' || !entry.rawXml) return '';
  try {
    const el = sfParseXml(entry.rawXml);
    const w = sfXmlFindFirst(el, 'words');
    if (w) return sfXmlText(w).trim();
    const dyn = sfXmlFindFirst(el, 'dynamics');
    if (dyn) {
      const ch = sfXmlChildren(dyn)[0];
      return ch ? ch.tag : '';
    }
    return '';
  } catch {
    return '';
  }
}

function sfAddDirectionText(model, partIndex, measureIndex, text, opts) {
  const clean = String(text == null ? '' : text).trim();
  if (!clean) return { ok: false, changed: false, entry: null };
  const part = model && model.parts && model.parts[partIndex];
  const measure = part && part.measures && part.measures[measureIndex];
  if (!measure) return { ok: false, changed: false, entry: null };

  const o = opts || {};
  const cls = sfClassifyDirectionText(clean);
  const placement = o.placement || (cls.kind === 'dynamic' ? 'below' : 'above');
  const staff = o.staff || 1;
  const rawXml = sfBuildDirectionXml(cls, placement, staff);
  const id = sfNextEntryId(partIndex, measureIndex, measure);
  const dirEntry = {
    id,
    kind: 'other',
    partIndex,
    measureIndex,
    tag: 'direction',
    rawXml,
    markingKind: cls.kind,
    markingValue: cls.text,
    tempoBpm: 0,
    onsetQ: 0
  };

  let insertIdx = measure.entries.findIndex(e => !e.isAttributesSlot);
  if (insertIdx < 0) insertIdx = measure.entries.length;
  if (isFinite(o.onsetQ)) {
    const targetIdx = measure.entries.findIndex(e => (e.kind === 'note' || e.kind === 'rest') && e.onsetQ >= o.onsetQ - 1e-6);
    if (targetIdx >= 0) insertIdx = targetIdx;
  }

  measure.entries.splice(insertIdx, 0, dirEntry);
  sfRecalcMeasureOnsets(measure);
  return { ok: true, changed: true, entry: dirEntry };
}

function sfEditDirectionText(model, entryId, newText) {
  const found = sfFindEntry(model, entryId);
  if (!found || found.entry.kind !== 'other' || found.entry.tag !== 'direction') {
    return { ok: false, changed: false, entry: null };
  }
  const { measure, entry, entryIndex } = found;
  const clean = String(newText == null ? '' : newText).trim();
  if (clean === '') {
    measure.entries.splice(entryIndex, 1);
    sfRecalcMeasureOnsets(measure);
    return { ok: true, changed: true, entry: null };
  }
  const el = sfParseXml(entry.rawXml);
  const cls = sfClassifyDirectionText(clean);
  entry.markingKind = cls.kind;
  entry.markingValue = cls.text;
  const placement = el.attrs.placement || (cls.kind === 'dynamic' ? 'below' : 'above');
  const staffEl = sfXmlChild(el, 'staff');
  const staff = staffEl ? parseInt(sfXmlText(staffEl).trim(), 10) || 1 : 1;
  entry.rawXml = sfBuildDirectionXml(cls, placement, staff);
  return { ok: true, changed: true, entry };
}

// ---------- Split-Part Merging (OCR System-Label Drift Fix)
const SF_PART_ABBREVS = {
  s: 'soprano', sop: 'soprano', sopr: 'soprano', sopran: 'soprano', soprano: 'soprano',
  a: 'alto', alt: 'alto', alto: 'alto',
  t: 'tenor', ten: 'tenor', tenor: 'tenor', tenore: 'tenor', tenorc: 'tenor',
  b: 'bass', bas: 'bass', bass: 'bass', basso: 'bass',
  voice: 'voice',
  sa: 'soprano_alto',
  tb: 'tenor_bass',
  bar: 'baritone', bari: 'baritone', baritone: 'baritone',
  pno: 'piano', pn: 'piano', piano: 'piano',
  trp: 'trumpet', tpt: 'trumpet', trumpet: 'trumpet',
  cl: 'clarinet', clar: 'clarinet', clarinet: 'clarinet',
  fl: 'flute', flt: 'flute', flute: 'flute'
};

function sfNormPartName(name) {
  return String(name == null ? '' : name)
    .trim()
    .replace(/[.:,;]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function sfPartNameAliasMatch(nameA, nameB) {
  const a = sfNormPartName(nameA);
  const b = sfNormPartName(nameB);
  if (!a || !b) return false;
  if (a === b) return true;

  // Bare number / roman numeral <-> "Part <n>" / "Pt <n>" / "Voice <n>" / "V <n>"
  const bareRe = /^(\d+|[ivx]+)$/;
  const prefRe = /^(?:part|pt|voice|v)\s+(\d+|[ivx]+)$/;
  const maBare = a.match(bareRe), mbPref = b.match(prefRe);
  if (maBare && mbPref && maBare[1] === mbPref[1]) return true;
  const mbBare = b.match(bareRe), maPref = a.match(prefRe);
  if (mbBare && maPref && mbBare[1] === maPref[1]) return true;

  // Abbreviation <-> full name (preserving optional trailing number/roman numeral)
  const splitNum = s => {
    const m = s.match(/^(.*?)(?:\s+(\d+|[ivx]+))?$/);
    return { base: (m && m[1]) || s, num: (m && m[2]) || '' };
  };
  const sa = splitNum(a), sb = splitNum(b);
  if (sa.num === sb.num) {
    const ca = SF_PART_ABBREVS[sa.base];
    const cb = SF_PART_ABBREVS[sb.base];
    if (ca && cb && ca === cb) return true;
  }
  // Single-digit Audiveris OCR typo: '5' <-> 's' / 'soprano' (when not matched as "Part 5")
  if (a === '5' && !sb.num && SF_PART_ABBREVS[sb.base] === 'soprano') return true;
  if (b === '5' && !sa.num && SF_PART_ABBREVS[sa.base] === 'soprano') return true;
  return false;
}

function sfIsGenericPartName(name) {
  const s = sfNormPartName(name);
  return !s || /^(?:voice|part\s*\d+|p\d+|\d+)$/i.test(s);
}

function sfChooseBetterPartName(nameA, nameB) {
  const a = String(nameA || '').trim();
  const b = String(nameB || '').trim();
  if (!a) return b;
  if (!b) return a;
  const aGen = sfIsGenericPartName(a), bGen = sfIsGenericPartName(b);
  if (aGen && !bGen) return b;
  if (bGen && !aGen) return a;
  const na = sfNormPartName(a), nb = sfNormPartName(b);
  const aBare = /^(\d+|[ivx]+)$/.test(na);
  const bBare = /^(\d+|[ivx]+)$/.test(nb);
  if (aBare && !bBare) return b;
  if (bBare && !aBare) return a;
  return b.length > a.length ? b : a;
}

function sfMeasureHasPlayableNotes(measure) {
  if (!measure || !measure.entries) return false;
  return measure.entries.some(e => e.kind === 'note' && !e.isRest);
}

function sfMeasureHasMergeContent(measure) {
  if (sfMeasureHasPlayableNotes(measure)) return true;
  if (!measure || !measure.entries) return false;
  return measure.entries.some(e => e.kind === 'other' && e.tag === 'direction' && !e.tempoBpm);
}

function sfReindexModelParts(model) {
  for (let pi = 0; pi < (model.parts || []).length; pi++) {
    const part = model.parts[pi];
    for (let mi = 0; mi < (part.measures || []).length; mi++) {
      const m = part.measures[mi];
      m.index = mi;
      for (let ei = 0; ei < (m.entries || []).length; ei++) {
        const e = m.entries[ei];
        e.partIndex = pi;
        e.measureIndex = mi;
        e.id = `p${pi}_m${mi}_e${ei}`;
      }
    }
  }
}

function sfSyncHeaderPartList(model, keepId, keepName, mergeId) {
  if (!model || !model.headerXml || !model.headerXml.trim()) return;
  try {
    const wrap = sfParseXml('<sf-hdr>' + model.headerXml + '</sf-hdr>');
    const pl = sfXmlChild(wrap, 'part-list');
    if (pl) {
      const nextChildren = [];
      for (const ch of pl.children || []) {
        if (ch.type === 'element' && ch.tag === 'score-part') {
          if (ch.attrs.id === mergeId) continue;
          if (ch.attrs.id === keepId) {
            const pn = sfXmlChild(ch, 'part-name');
            if (pn) pn.children = [{ type: 'text', text: keepName }];
          }
        }
        nextChildren.push(ch);
      }
      pl.children = nextChildren;
    }
    model.headerXml = (wrap.children || [])
      .filter(c => c.type === 'element')
      .map(sfSerializeXmlNode)
      .join('\n  ');
  } catch { /* keep headerXml untouched if malformed */ }
}

function sfMergeParts(model, keepIdx, mergeIdx) {
  const parts = model && model.parts;
  if (!Array.isArray(parts) || keepIdx === mergeIdx ||
      keepIdx < 0 || keepIdx >= parts.length || mergeIdx < 0 || mergeIdx >= parts.length) {
    return { ok: false, kept: null, merged: null };
  }
  const keepPart = parts[keepIdx];
  const mergePart = parts[mergeIdx];
  const oldKeepName = keepPart.name;
  const oldMergeName = mergePart.name;
  const betterName = sfChooseBetterPartName(oldKeepName, oldMergeName);
  keepPart.name = betterName;

  const minLen = Math.min(keepPart.measures.length, mergePart.measures.length);
  for (let mi = 0; mi < minLen; mi++) {
    const km = keepPart.measures[mi];
    const mm = mergePart.measures[mi];
    if (!sfMeasureHasPlayableNotes(km) && sfMeasureHasMergeContent(mm)) {
      const kDiv = km.divisions || 1;
      const mDiv = mm.divisions || 1;
      const nextDiv = sfLcm(kDiv, mDiv);
      const kScale = nextDiv / kDiv;
      const mScale = nextDiv / mDiv;
      km.divisions = nextDiv;

      const preserved = [];
      for (const e of km.entries || []) {
        if (e.isAttributesSlot || (e.kind === 'other' && (e.tag === 'barline' || e.tag === 'sound' || (e.tag === 'direction' && e.tempoBpm > 0)))) {
          if (kScale !== 1 && e.durationDivs) e.durationDivs = Math.round(e.durationDivs * kScale);
          preserved.push(e);
        }
      }
      const head = preserved.filter(e => e.isAttributesSlot || e.tag === 'sound' || e.tag === 'direction');
      const tail = preserved.filter(e => e.tag === 'barline');

      const copied = [];
      for (const e of mm.entries || []) {
        if (e.kind === 'note' || e.kind === 'rest' || e.kind === 'backup' || e.kind === 'forward' ||
            (e.kind === 'other' && e.tag === 'direction' && !e.tempoBpm)) {
          const clone = JSON.parse(JSON.stringify(e));
          if (mScale !== 1 && clone.durationDivs) {
            clone.durationDivs = Math.round(clone.durationDivs * mScale);
          }
          copied.push(clone);
        }
      }

      km.entries = head.concat(copied, tail);
      sfRecalcMeasureOnsets(km);
    }
  }

  parts.splice(mergeIdx, 1);
  sfReindexModelParts(model);
  sfSyncHeaderPartList(model, keepPart.id, betterName, mergePart.id);
  return { ok: true, kept: betterName, merged: oldMergeName };
}

function sfEffectivePartClefSign(part) {
  const measures = (part && part.measures) || [];
  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi];
    if (sfMeasureHasPlayableNotes(m) && m.clefs && m.clefs[0] && m.clefs[0].sign) {
      return m.clefs[0].sign;
    }
  }
  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi];
    if (m.hasClefAttr && m.clefs && m.clefs[0] && m.clefs[0].sign) {
      return m.clefs[0].sign;
    }
  }
  return null;
}

function sfPartsHavePlayableOverlap(a, b) {
  const minLen = Math.min((a.measures || []).length, (b.measures || []).length);
  for (let mi = 0; mi < minLen; mi++) {
    if (sfMeasureHasPlayableNotes(a.measures[mi]) && sfMeasureHasPlayableNotes(b.measures[mi])) {
      return true;
    }
  }
  return false;
}

function sfMergeSplitParts(model) {
  if (!model || !Array.isArray(model.parts) || model.parts.length < 2) {
    if (model) model.mergedParts = [];
    return model;
  }
  const mergedParts = [];
  let changed = true;
  while (changed) {
    changed = false;
    const parts = model.parts;
    for (let i = 0; i < parts.length && !changed; i++) {
      for (let j = i + 1; j < parts.length && !changed; j++) {
        const a = parts[i], b = parts[j];
        if (!sfPartNameAliasMatch(a.name, b.name)) continue;
        if ((a.staves || 1) !== (b.staves || 1)) continue;
        const clefA = sfEffectivePartClefSign(a);
        const clefB = sfEffectivePartClefSign(b);
        if (clefA && clefB && clefA !== clefB) continue;
        if (sfPartsHavePlayableOverlap(a, b)) continue;

        const res = sfMergeParts(model, i, j);
        if (res.ok) {
          mergedParts.push({ kept: res.kept, merged: res.merged });
          changed = true;
        }
      }
    }
  }

  // Pass 2: generic Audiveris fallback names (e.g. "Voice", "Part 2", "P2", "2").
  // Merge only when there is a UNIQUE non-overlapping same-clef candidate partner
  // so two same-clef parts (e.g. Soprano & Alto in treble) never merge ambiguously.
  const findGenericPartners = (parts, idx, clefs, generics) => {
    const clef = clefs[idx];
    if (!clef) return [];
    const a = parts[idx];
    const out = [];
    for (let k = 0; k < parts.length; k++) {
      if (k === idx) continue;
      if (!generics[idx] && !generics[k]) continue;
      const b = parts[k];
      if ((a.staves || 1) !== (b.staves || 1)) continue;
      if (!clefs[k] || clefs[k] !== clef) continue;
      if (sfPartsHavePlayableOverlap(a, b)) continue;
      out.push(k);
    }
    return out;
  };

  changed = true;
  while (changed) {
    changed = false;
    const parts = model.parts;
    const clefs = parts.map(sfEffectivePartClefSign);
    const generics = parts.map(p => sfIsGenericPartName(p.name));
    const partnerLists = parts.map((_, idx) => findGenericPartners(parts, idx, clefs, generics));

    for (let i = 0; i < parts.length && !changed; i++) {
      if (partnerLists[i].length !== 1) continue;
      const j = partnerLists[i][0];
      if (j <= i) continue;
      if (!generics[i] && !generics[j]) continue;
      if (partnerLists[j].length !== 1 || partnerLists[j][0] !== i) continue;

      const res = sfMergeParts(model, i, j);
      if (res.ok) {
        mergedParts.push({ kept: res.kept, merged: res.merged });
        changed = true;
      }
    }
  }

  model.mergedParts = mergedParts;
  return model;
}

// ---------- Measure Copy / Paste (All vs Rhythm-Only)
function sfStaffDisplayLabel(part, staffNum) {
  if (!staffNum) return null;
  const clef = sfResolveClefForStaff(part, 0, staffNum);
  if (clef && clef.sign === 'G') return 'Treble';
  if (clef && clef.sign === 'F') return 'Bass';
  if (clef && clef.sign === 'C' && clef.line === 4) return 'Tenor';
  if (clef && clef.sign === 'C') return 'Alto';
  return 'Staff ' + staffNum;
}

function sfCopyMeasures(model, partIndex, startMeasureIdx, endMeasureIdx, mode, staff) {
  const part = model && model.parts && model.parts[partIndex];
  if (!part || !Array.isArray(part.measures) || !part.measures.length) return null;

  const maxIdx = part.measures.length - 1;
  let a = Math.max(0, Math.min(maxIdx, Math.trunc(Number(startMeasureIdx) || 0)));
  let b = (endMeasureIdx === undefined || endMeasureIdx === null)
    ? a
    : Math.max(0, Math.min(maxIdx, Math.trunc(Number(endMeasureIdx) || 0)));
  if (a > b) { const t = a; a = b; b = t; }

  const copyMode = mode === 'rhythm' ? 'rhythm' : 'all';
  const targetStaff = staff != null ? Math.trunc(Number(staff)) : null;
  const copiedMeasures = [];

  for (let mi = a; mi <= b; mi++) {
    const m = part.measures[mi];
    const copiedEntries = [];
    for (const e of m.entries || []) {
      if (targetStaff != null) {
        if (e.kind === 'backup') continue;
        if (sfGetEntryStaff(e) !== targetStaff) continue;
      }
      if (copyMode === 'all') {
        if (e.kind === 'note' || e.kind === 'rest' || e.kind === 'backup' || e.kind === 'forward' ||
            (e.kind === 'other' && e.tag === 'direction' && !e.tempoBpm)) {
          copiedEntries.push(JSON.parse(JSON.stringify(e)));
        }
      } else {
        if (e.kind === 'note' || e.kind === 'rest' || e.kind === 'backup' || e.kind === 'forward') {
          if (e.kind === 'note' && e.isChord) continue;
          copiedEntries.push({
            kind: e.kind,
            isRest: !!e.isRest,
            measureRest: !!e.measureRest,
            isChord: false,
            spoken: !!e.spoken,
            voice: e.voice || '1',
            staff: e.staff || 1,
            durationDivs: e.durationDivs || 0,
            durationQ: e.durationQ || 0,
            type: e.type || null,
            dots: e.dots || 0,
            ties: Array.isArray(e.ties) ? e.ties.slice() : [],
            targetDivs: e.kind === 'backup' ? e.targetDivs : undefined
          });
        }
      }
    }
    copiedMeasures.push({
      divisions: m.divisions || 1,
      number: m.number,
      entries: copiedEntries
    });
  }

  return {
    mode: copyMode,
    partIndex,
    partName: part.name || ('Part ' + (partIndex + 1)),
    staff: targetStaff,
    staffLabel: targetStaff != null ? sfStaffDisplayLabel(part, targetStaff) : null,
    count: copiedMeasures.length,
    startNumber: part.measures[a].number,
    endNumber: part.measures[b].number,
    measures: copiedMeasures
  };
}

function sfExtractLyricXml(extraXml) {
  if (!extraXml || !extraXml.trim()) return '';
  try {
    return sfParseExtraWrap(extraXml)
      .filter(c => c.type === 'element' && c.tag === 'lyric')
      .map(sfSerializeXmlNode)
      .join('');
  } catch {
    return '';
  }
}

function sfSetDirectionStaff(rawXml, destStaff) {
  if (!rawXml) return rawXml;
  if (/<staff>\s*\d+\s*<\/staff>/.test(rawXml)) {
    return rawXml.replace(/<staff>\s*\d+\s*<\/staff>/, `<staff>${destStaff}</staff>`);
  }
  return rawXml.replace(/<\/direction>/, `<staff>${destStaff}</staff></direction>`);
}

function sfPasteMeasures(model, clipboard, targetPartIndex, targetStartMeasureIdx, targetStaff) {
  const part = model && model.parts && model.parts[targetPartIndex];
  if (!part || !Array.isArray(part.measures) || !clipboard || !Array.isArray(clipboard.measures) || !clipboard.measures.length) {
    return { ok: false, changed: false, pastedCount: 0, startMeasureIndex: -1, endMeasureIndex: -1, firstEntryId: null };
  }
  const startMi = Math.trunc(Number(targetStartMeasureIdx) || 0);
  if (startMi < 0 || startMi >= part.measures.length) {
    return { ok: false, changed: false, pastedCount: 0, startMeasureIndex: -1, endMeasureIndex: -1, firstEntryId: null };
  }

  const numStaves = part.staves || 1;
  const destStaff = (numStaves > 1 && (targetStaff != null || clipboard.staff != null))
    ? Math.max(1, Math.min(numStaves, Math.trunc(Number(targetStaff != null ? targetStaff : clipboard.staff))))
    : null;
  const pasteMode = clipboard.mode === 'rhythm' ? 'rhythm' : 'all';
  const pastedCount = Math.min(clipboard.measures.length, part.measures.length - startMi);
  let firstEntryId = null;

  for (let k = 0; k < pastedCount; k++) {
    const mi = startMi + k;
    const srcM = clipboard.measures[k];
    const dstM = part.measures[mi];
    const srcDiv = srcM.divisions || 1;
    const dstDiv = dstM.divisions || 1;
    const nextDiv = sfLcm(srcDiv, dstDiv);
    const dstScale = nextDiv / dstDiv;
    const srcScale = nextDiv / srcDiv;
    dstM.divisions = nextDiv;

    const preserved = [];
    const entriesByOtherStaff = {};
    const otherVoices = new Set();
    for (let st = 1; st <= numStaves; st++) entriesByOtherStaff[st] = [];

    for (const e of dstM.entries || []) {
      if (dstScale !== 1 && e.durationDivs) e.durationDivs = Math.round(e.durationDivs * dstScale);
      if (dstScale !== 1 && e.kind === 'backup' && typeof e.targetDivs === 'number' && isFinite(e.targetDivs)) {
        e.targetDivs = Math.round(e.targetDivs * dstScale);
      }
      if ((e.kind === 'note' || e.kind === 'rest') && !e.isGrace) {
        e.durationQ = (e.durationDivs || 0) / nextDiv;
      }

      const isStructural = e.isAttributesSlot || (e.kind === 'other' && (e.tag === 'barline' || e.tag === 'sound' || e.tag === 'print' || (e.tag === 'direction' && e.tempoBpm > 0)));
      if (isStructural) {
        preserved.push(e);
        continue;
      }
      if (destStaff != null) {
        if (e.kind === 'backup') continue;
        const st = sfGetEntryStaff(e);
        if (st !== destStaff) {
          if ((e.kind === 'note' || e.kind === 'rest') && e.voice) otherVoices.add(e.voice);
          (entriesByOtherStaff[st] || (entriesByOtherStaff[st] = [])).push(e);
        } else if (pasteMode === 'rhythm' && e.kind === 'other') {
          (entriesByOtherStaff[destStaff] || (entriesByOtherStaff[destStaff] = [])).push(e);
        }
      } else if (pasteMode === 'rhythm' && e.kind === 'other') {
        preserved.push(e);
      }
    }
    const head = preserved.filter(e => e.tag !== 'barline');
    const tail = preserved.filter(e => e.tag === 'barline');

    const voiceRemap = {};
    const resolvePastedVoice = v => {
      const orig = String(v || (destStaff === 2 ? '5' : '1'));
      if (destStaff == null || !otherVoices.has(orig)) return orig;
      if (voiceRemap[orig]) return voiceRemap[orig];
      const candidates = destStaff === 1
        ? ['1', '2', '3', '4', '5', '6', '7', '8']
        : ['5', '6', '7', '8', '1', '2', '3', '4'];
      const picked = candidates.find(c => !otherVoices.has(c)) || String(destStaff + 10);
      voiceRemap[orig] = picked;
      otherVoices.add(picked);
      return picked;
    };

    let pastedEntries = [];
    if (pasteMode === 'all') {
      const tr = dstM.activeTranspose || part.transpose;
      const trSemis = sfTransposeSemis(tr);
      for (const se of srcM.entries || []) {
        if (destStaff != null && se.kind === 'backup') continue;
        const clone = JSON.parse(JSON.stringify(se));
        clone.partIndex = targetPartIndex;
        clone.measureIndex = mi;
        if (destStaff != null) {
          if (clone.kind === 'note' || clone.kind === 'rest' || clone.kind === 'forward') {
            clone.staff = destStaff;
            if (clone.voice || clone.kind !== 'forward') clone.voice = resolvePastedVoice(clone.voice);
          } else if (clone.kind === 'other' && clone.tag === 'direction') {
            clone.rawXml = sfSetDirectionStaff(clone.rawXml, destStaff);
          }
        }
        if (srcScale !== 1 && clone.durationDivs) {
          clone.durationDivs = Math.round(clone.durationDivs * srcScale);
          if (clone.kind === 'backup' && typeof clone.targetDivs === 'number' && isFinite(clone.targetDivs)) {
            clone.targetDivs = Math.round(clone.targetDivs * srcScale);
          }
        }
        if ((clone.kind === 'note' || clone.kind === 'rest') && !clone.isGrace) {
          clone.durationQ = clone.durationDivs / nextDiv;
        }
        if (clone.kind === 'note' && !clone.isRest && clone.step && isFinite(clone.octave)) {
          clone.midi = sfPitchToMidi(clone.step, clone.octave, clone.alter || 0);
          clone.soundingMidi = clone.midi !== null ? clone.midi + trSemis : null;
        }
        pastedEntries.push(clone);
      }
    } else {
      const pitchedByVoice = {};
      for (const e of dstM.entries || []) {
        if (destStaff != null && sfGetEntryStaff(e) !== destStaff) continue;
        if (e.kind === 'note' && !e.isRest && !e.isChord && !e.isGrace && e.step && isFinite(e.octave)) {
          const vid = e.voice || '1';
          (pitchedByVoice[vid] || (pitchedByVoice[vid] = [])).push({
            step: e.step,
            octave: e.octave,
            alter: e.alter || 0,
            accidental: e.accidental || null,
            lyrics: Array.isArray(e.lyrics) ? JSON.parse(JSON.stringify(e.lyrics)) : [],
            lyricXml: sfExtractLyricXml(e.extraXml)
          });
        }
      }
      const existingStaffVoices = Object.keys(pitchedByVoice);
      const voiceCursor = {};
      const fifths = (dstM.key && dstM.key.fifths) || 0;
      const tr = dstM.activeTranspose || part.transpose;
      const trSemis = sfTransposeSemis(tr);
      const lastPastedNoteByVoice = {};

      for (const se of srcM.entries || []) {
        if (destStaff != null && se.kind === 'backup') continue;
        const divs = Math.round((se.durationDivs || 0) * srcScale);
        const durQ = divs / nextDiv;
        const vid = resolvePastedVoice(se.voice || '1');
        const staff = destStaff != null ? destStaff : (se.staff || 1);

        if (se.kind === 'backup' || se.kind === 'forward') {
          pastedEntries.push({
            id: '',
            kind: se.kind,
            partIndex: targetPartIndex,
            measureIndex: mi,
            durationDivs: divs,
            durationQ: durQ,
            targetDivs: se.kind === 'backup' && typeof se.targetDivs === 'number' ? Math.round(se.targetDivs * srcScale) : undefined,
            voice: se.voice ? vid : null,
            staff: destStaff != null ? destStaff : (se.staff || null),
            onsetQ: 0,
            extraXml: ''
          });
          continue;
        }
        if (se.isRest || se.kind === 'rest') {
          pastedEntries.push({
            id: '',
            kind: 'rest',
            partIndex: targetPartIndex,
            measureIndex: mi,
            voice: vid,
            staff,
            isChord: false,
            isRest: true,
            isGrace: false,
            isCue: false,
            measureRest: !!se.measureRest,
            step: null,
            octave: null,
            alter: null,
            accidental: null,
            durationDivs: divs,
            durationQ: durQ,
            type: se.type || sfInferBaseTypeFromQ(durQ, se.dots || 0),
            dots: se.dots || 0,
            ties: [],
            onsetQ: 0,
            midi: null,
            soundingMidi: null,
            spoken: false,
            notehead: null,
            isUnpitched: false,
            timeModification: null,
            extraXml: ''
          });
          continue;
        }

        const pool = pitchedByVoice[vid] || (existingStaffVoices.length ? pitchedByVoice[existingStaffVoices[0]] : []) || [];
        const poolKey = pitchedByVoice[vid] ? vid : (existingStaffVoices[0] || vid);
        const curIdx = voiceCursor[poolKey] || 0;
        let pitchSpec;
        let lyricXml = '';
        let noteLyrics = [];
        if (curIdx < pool.length) {
          pitchSpec = pool[curIdx];
          lyricXml = pitchSpec.lyricXml || '';
          noteLyrics = Array.isArray(pitchSpec.lyrics) ? JSON.parse(JSON.stringify(pitchSpec.lyrics)) : [];
          voiceCursor[poolKey] = curIdx + 1;
        } else if (pool.length > 0) {
          pitchSpec = pool[pool.length - 1];
        } else {
          const def = sfDefaultPitchForRest(part, mi, 0, vid, staff);
          pitchSpec = {
            step: def.step,
            octave: def.octave,
            alter: sfKeyAlterForStep(fifths, def.step),
            accidental: null
          };
        }

        const midi = sfPitchToMidi(pitchSpec.step, pitchSpec.octave, pitchSpec.alter);
        const soundingMidi = midi !== null ? midi + trSemis : null;
        const rawTies = Array.isArray(se.ties) ? se.ties.filter(t => t === 'start' || t === 'stop') : [];
        const noteObj = {
          id: '',
          kind: 'note',
          partIndex: targetPartIndex,
          measureIndex: mi,
          voice: vid,
          staff,
          isChord: false,
          isRest: false,
          isGrace: false,
          isCue: false,
          measureRest: false,
          step: pitchSpec.step,
          octave: pitchSpec.octave,
          alter: pitchSpec.alter,
          accidental: pitchSpec.accidental,
          durationDivs: divs,
          durationQ: durQ,
          type: se.type || sfInferBaseTypeFromQ(durQ, se.dots || 0),
          dots: se.dots || 0,
          ties: [],
          lyrics: noteLyrics,
          onsetQ: 0,
          midi,
          soundingMidi,
          spoken: !!se.spoken,
          notehead: se.spoken ? 'x' : null,
          isUnpitched: false,
          timeModification: null,
          extraXml: lyricXml
        };

        const prevNote = lastPastedNoteByVoice[vid];
        if (prevNote && rawTies.includes('stop') && prevNote._wantTieStart && sfSameWrittenPitch(prevNote, noteObj)) {
          prevNote.ties.push('start');
          prevNote.extraXml = sfSyncNotationsTied(prevNote.extraXml, prevNote.ties);
          noteObj.ties.push('stop');
          noteObj.extraXml = sfSyncNotationsTied(noteObj.extraXml, noteObj.ties);
        }
        noteObj._wantTieStart = rawTies.includes('start');
        lastPastedNoteByVoice[vid] = noteObj;
        pastedEntries.push(noteObj);
      }

      for (const pe of pastedEntries) {
        if (pe && '_wantTieStart' in pe) delete pe._wantTieStart;
      }
    }

    if (destStaff != null) {
      entriesByOtherStaff[destStaff] = (entriesByOtherStaff[destStaff] || []).concat(pastedEntries);
      sfRebuildGrandStaffEntries(dstM, numStaves, head, entriesByOtherStaff, tail);
    } else {
      dstM.entries = head.concat(pastedEntries, tail);
    }
    sfReindexModelParts(model);
    sfRecalcMeasureOnsets(dstM);

    if (!firstEntryId) {
      const firstPlayable = (destStaff != null ? pastedEntries : dstM.entries)
        .find(e => e.kind === 'note' || e.kind === 'rest');
      if (firstPlayable) firstEntryId = firstPlayable.id;
    }
  }

  return {
    ok: true,
    changed: true,
    pastedCount,
    startMeasureIndex: startMi,
    endMeasureIndex: startMi + pastedCount - 1,
    firstEntryId
  };
}

// ---------- MuseScore-Style Note Input & Chord Stacking
function sfStaffStepToPitch(clefSign, clefLine, stepsFromTopLine, keyFifths, accidentalOverride) {
  const sign = String(clefSign || 'G').toUpperCase();
  const line = parseInt(clefLine || (sign === 'F' ? 4 : sign === 'C' ? 3 : 2), 10);
  let topIdx = 5 * 7 + 3; // Treble G2: F5
  if (sign === 'F') topIdx = 3 * 7 + 5; // Bass F4: A3
  else if (sign === 'C' && line === 4) topIdx = 4 * 7 + 2; // Tenor C4: E4
  else if (sign === 'C') topIdx = 4 * 7 + 4; // Alto C3: G4

  const idx = Math.max(0, Math.min(9 * 7 + 4, topIdx - Math.round(Number(stepsFromTopLine) || 0)));
  const octave = Math.floor(idx / 7);
  const step = SF_STEPS[((idx % 7) + 7) % 7];

  let alter;
  let accidental = null;
  if (accidentalOverride === 'sharp') {
    alter = 1;
    accidental = 'sharp';
  } else if (accidentalOverride === 'flat') {
    alter = -1;
    accidental = 'flat';
  } else if (accidentalOverride === 'natural') {
    alter = 0;
    accidental = 'natural';
  } else {
    alter = sfKeyAlterForStep(keyFifths || 0, step);
  }

  const midi = sfPitchToMidi(step, octave, alter);
  const accGlyph = alter === 1 ? '♯' : (alter === -1 ? '♭' : '');
  return {
    step,
    octave,
    alter,
    accidental,
    midi,
    label: step + accGlyph + octave
  };
}

function sfDecomposeRestDivs(remDivs, divisions) {
  const units = [
    { type: 'whole',   dots: 0, q: 4 },
    { type: 'half',    dots: 1, q: 3 },
    { type: 'half',    dots: 0, q: 2 },
    { type: 'quarter', dots: 1, q: 1.5 },
    { type: 'quarter', dots: 0, q: 1 },
    { type: 'eighth',  dots: 1, q: 0.75 },
    { type: 'eighth',  dots: 0, q: 0.5 },
    { type: '16th',    dots: 1, q: 0.375 },
    { type: '16th',    dots: 0, q: 0.25 }
  ];
  const out = [];
  let left = Math.round(remDivs);
  for (const u of units) {
    const uDivs = Math.round(u.q * divisions);
    if (uDivs <= 0) continue;
    while (left >= uDivs) {
      out.push({ type: u.type, dots: u.dots, durationDivs: uDivs, durationQ: u.q });
      left -= uDivs;
    }
  }
  if (left > 0) {
    out.push({
      type: sfInferBaseTypeFromQ(left / divisions, 0),
      dots: 0,
      durationDivs: left,
      durationQ: left / divisions
    });
  }
  return out;
}

function sfPlaceNoteAt(model, opts) {
  const o = opts || {};
  const pi = o.partIndex != null ? o.partIndex : 0;
  const mi = o.measureIndex != null ? o.measureIndex : 0;
  const part = model && model.parts && model.parts[pi];
  const measure = part && part.measures && part.measures[mi];
  if (!measure) return { ok: false, changed: false, entry: null };

  const baseType = o.type || 'quarter';
  const dots = o.dots ? 1 : 0;
  const durInfo = sfEnsureDivisionsForDuration(measure, baseType, dots);
  if (!durInfo) return { ok: false, changed: false, entry: null };

  const targetFound = o.targetEntryId ? sfFindEntry(model, o.targetEntryId) : null;
  const targetEntry = (targetFound && targetFound.measure === measure) ? targetFound.entry : null;
  const targetIdx = (targetFound && targetFound.measure === measure) ? targetFound.entryIndex : -1;

  const staff = o.staff || (targetEntry && targetEntry.staff) || 1;
  let voice = o.voice || (targetEntry && targetEntry.voice) || null;
  if (!voice) {
    const firstOnStaff = measure.entries.find(e => (e.kind === 'note' || e.kind === 'rest') && (e.staff || 1) === staff);
    voice = (firstOnStaff && firstOnStaff.voice) || String(staff);
  }

  const fifths = (measure.key && measure.key.fifths) || 0;
  const step = String(o.step || 'B').toUpperCase();
  const octave = isFinite(o.octave) ? Math.trunc(Number(o.octave)) : 4;
  const alter = (o.alter != null && isFinite(o.alter)) ? Math.trunc(Number(o.alter)) : sfKeyAlterForStep(fifths, step);
  const spoken = !!o.spoken;
  const tr = measure.activeTranspose || part.transpose;
  const trSemis = sfTransposeSemis(tr);

  const makeRestList = remDivs => sfDecomposeRestDivs(remDivs, measure.divisions).map(r => ({
    id: '',
    kind: 'rest',
    partIndex: pi,
    measureIndex: mi,
    voice,
    staff,
    isChord: false,
    isRest: true,
    isGrace: false,
    isCue: false,
    measureRest: false,
    step: null,
    octave: null,
    alter: null,
    accidental: null,
    durationDivs: r.durationDivs,
    durationQ: r.durationQ,
    type: r.type,
    dots: r.dots,
    ties: [],
    onsetQ: 0,
    midi: null,
    soundingMidi: null,
    spoken: false,
    notehead: null,
    isUnpitched: false,
    timeModification: null,
    extraXml: ''
  }));

  if (o.addChord && targetEntry && targetEntry.kind === 'note' && !targetEntry.isRest) {
    const group = sfCollectChordGroup(measure, targetIdx);
    const existing = group.find(g => g.step === step && g.octave === octave && (Number(g.alter) || 0) === alter);
    if (existing) return { ok: true, changed: false, entry: existing };

    const chordBase = group[0];
    const lastChordEl = group[group.length - 1];
    const insertAt = measure.entries.indexOf(lastChordEl) + 1;
    const priorAlter = sfPriorActiveAlter(measure, insertAt, chordBase.staff || staff, step, octave);
    const acc = spoken ? null : (o.accidental !== undefined ? o.accidental : ((alter !== priorAlter) ? sfAlterToAccidental(alter) : null));
    const midi = sfPitchToMidi(step, octave, alter);
    const newTone = {
      id: '',
      kind: 'note',
      partIndex: pi,
      measureIndex: mi,
      voice: chordBase.voice || voice,
      staff: chordBase.staff || staff,
      isChord: true,
      isRest: false,
      isGrace: false,
      isCue: false,
      measureRest: false,
      step,
      octave,
      alter,
      accidental: acc,
      durationDivs: chordBase.durationDivs,
      durationQ: chordBase.durationQ,
      type: chordBase.type,
      dots: chordBase.dots,
      ties: [],
      onsetQ: chordBase.onsetQ,
      midi,
      soundingMidi: midi !== null ? midi + trSemis : null,
      spoken,
      notehead: spoken ? 'x' : null,
      isUnpitched: false,
      timeModification: null,
      extraXml: ''
    };
    measure.entries.splice(insertAt, 0, newTone);
    sfReindexModelParts(model);
    sfRecalcMeasureOnsets(measure);
    return { ok: true, changed: true, entry: newTone };
  }

  let restIdx = (targetEntry && targetEntry.kind === 'rest') ? targetIdx : -1;
  if (restIdx < 0 && !targetEntry) {
    const beats = (measure.time && measure.time.beats) || 4;
    const bt = (measure.time && measure.time.beatType) || 4;
    const expectedQ = beats * 4 / bt;
    restIdx = measure.entries.findIndex(e =>
      e.kind === 'rest' && (e.staff || 1) === staff &&
      (e.measureRest || (e.durationQ || 0) >= expectedQ - 0.01)
    );
  }

  if (restIdx >= 0) {
    const rEntry = measure.entries[restIdx];
    const oldDivs = rEntry.durationDivs || 0;
    const newDivs = durInfo.durationDivs;
    const priorAlter = sfPriorActiveAlter(measure, restIdx, staff, step, octave);
    const acc = spoken ? null : (o.accidental !== undefined ? o.accidental : ((alter !== priorAlter) ? sfAlterToAccidental(alter) : null));
    const midi = sfPitchToMidi(step, octave, alter);

    rEntry.kind = 'note';
    rEntry.isRest = false;
    rEntry.measureRest = false;
    rEntry.step = step;
    rEntry.octave = octave;
    rEntry.alter = alter;
    rEntry.accidental = acc;
    rEntry.durationDivs = newDivs;
    rEntry.durationQ = durInfo.newQ;
    rEntry.type = baseType;
    rEntry.dots = dots;
    rEntry.midi = midi;
    rEntry.soundingMidi = midi !== null ? midi + trSemis : null;
    rEntry.spoken = spoken;
    rEntry.notehead = spoken ? 'x' : null;
    rEntry.extraXml = sfStripRestIncompatibleXml(rEntry.extraXml);

    if (oldDivs > newDivs) {
      const remRests = makeRestList(oldDivs - newDivs);
      measure.entries.splice(restIdx + 1, 0, ...remRests);
    }
    sfReindexModelParts(model);
    sfRecalcMeasureOnsets(measure);
    return { ok: true, changed: true, entry: rEntry };
  }

  if (targetEntry && targetEntry.kind === 'note') {
    const oldDivs = targetEntry.durationDivs || 0;
    const newDivs = durInfo.durationDivs;
    const priorAlter = sfPriorActiveAlter(measure, targetIdx, targetEntry.staff || staff, step, octave);
    const acc = spoken ? null : (o.accidental !== undefined ? o.accidental : ((alter !== priorAlter) ? sfAlterToAccidental(alter) : null));
    const midi = sfPitchToMidi(step, octave, alter);

    targetEntry.step = step;
    targetEntry.octave = octave;
    targetEntry.alter = alter;
    targetEntry.accidental = acc;
    targetEntry.midi = midi;
    targetEntry.soundingMidi = midi !== null ? midi + trSemis : null;
    targetEntry.spoken = spoken;
    targetEntry.notehead = spoken ? 'x' : null;

    const group = sfCollectChordGroup(measure, targetIdx);
    for (const g of group) {
      g.durationDivs = newDivs;
      g.durationQ = durInfo.newQ;
      g.type = baseType;
      g.dots = dots;
      g.extraXml = sfStripBeams(g.extraXml);
    }
    if (oldDivs > newDivs) {
      const lastGroupIdx = measure.entries.indexOf(group[group.length - 1]);
      const remRests = makeRestList(oldDivs - newDivs);
      measure.entries.splice(lastGroupIdx + 1, 0, ...remRests);
    }
    sfReindexModelParts(model);
    sfRecalcMeasureOnsets(measure);
    return { ok: true, changed: true, entry: targetEntry };
  }

  let insertAt = -1;
  for (let i = measure.entries.length - 1; i >= 0; i--) {
    const e = measure.entries[i];
    if ((e.kind === 'note' || e.kind === 'rest') && (e.voice || '1') === voice && (e.staff || 1) === staff) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt < 0) {
    const barIdx = measure.entries.findIndex(e => e.tag === 'barline');
    insertAt = barIdx >= 0 ? barIdx : measure.entries.length;
  }
  const priorAlter = sfPriorActiveAlter(measure, insertAt, staff, step, octave);
  const acc = spoken ? null : (o.accidental !== undefined ? o.accidental : ((alter !== priorAlter) ? sfAlterToAccidental(alter) : null));
  const midi = sfPitchToMidi(step, octave, alter);
  const appended = {
    id: '',
    kind: 'note',
    partIndex: pi,
    measureIndex: mi,
    voice,
    staff,
    isChord: false,
    isRest: false,
    isGrace: false,
    isCue: false,
    measureRest: false,
    step,
    octave,
    alter,
    accidental: acc,
    durationDivs: durInfo.durationDivs,
    durationQ: durInfo.newQ,
    type: baseType,
    dots,
    ties: [],
    onsetQ: 0,
    midi,
    soundingMidi: midi !== null ? midi + trSemis : null,
    spoken,
    notehead: spoken ? 'x' : null,
    isUnpitched: false,
    timeModification: null,
    extraXml: ''
  };
  measure.entries.splice(insertAt, 0, appended);
  sfReindexModelParts(model);
  sfRecalcMeasureOnsets(measure);
  return { ok: true, changed: true, entry: appended };
}

function sfStackChordNote(model, noteId, pitchOpts) {
  const found = sfFindEntry(model, noteId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { measure, entry, partIndex, measureIndex, entryIndex } = found;
  if (entry.kind !== 'note' || entry.isRest || entry.isGrace || !entry.step || !isFinite(entry.octave)) {
    return { ok: false, changed: false, entry: null };
  }

  const group = sfCollectChordGroup(measure, entryIndex);
  let topNote = group[0];
  for (const g of group) {
    if ((g.midi || 0) >= (topNote.midi || 0)) topNote = g;
  }

  const fifths = (measure.key && measure.key.fifths) || 0;
  let step, octave, alter;
  if (pitchOpts && pitchOpts.step && isFinite(pitchOpts.octave)) {
    step = String(pitchOpts.step).toUpperCase();
    octave = Math.trunc(Number(pitchOpts.octave));
    alter = (pitchOpts.alter != null && isFinite(pitchOpts.alter)) ? Math.trunc(Number(pitchOpts.alter)) : sfKeyAlterForStep(fifths, step);
  } else if (pitchOpts && pitchOpts.letter) {
    step = String(pitchOpts.letter).toUpperCase();
    if (SF_STEPS.indexOf(step) < 0) return { ok: false, changed: false, entry: null };
    alter = sfKeyAlterForStep(fifths, step);
    const topMidi = topNote.midi != null ? topNote.midi : sfPitchToMidi(topNote.step, topNote.octave, topNote.alter || 0);
    octave = topNote.octave;
    for (let oct = Math.max(0, topNote.octave); oct <= 8; oct++) {
      if (sfPitchToMidi(step, oct, alter) > topMidi) {
        octave = oct;
        break;
      }
    }
  } else {
    const topIdx = topNote.octave * 7 + SF_STEPS.indexOf(topNote.step);
    const nextIdx = Math.min(9 * 7 + 4, topIdx + 2);
    octave = Math.floor(nextIdx / 7);
    step = SF_STEPS[((nextIdx % 7) + 7) % 7];
    alter = sfKeyAlterForStep(fifths, step);
  }

  return sfPlaceNoteAt(model, {
    partIndex,
    measureIndex,
    staff: group[0].staff || 1,
    voice: group[0].voice || '1',
    targetEntryId: group[0].id,
    addChord: true,
    step,
    octave,
    alter,
    type: group[0].type || 'quarter',
    dots: group[0].dots || 0
  });
}

function sfRemoveEntry(model, entryId, opts) {
  const found = sfFindEntry(model, entryId);
  if (!found) return { ok: false, changed: false, entry: null };
  const { measure, entry, entryIndex } = found;
  if (entry.kind === 'other') {
    measure.entries.splice(entryIndex, 1);
    sfRecalcMeasureOnsets(measure);
    return { ok: true, changed: true, entry: null };
  }
  if (entry.kind === 'rest') {
    return sfDeleteOrMakeRest(model, entryId, 'delete');
  }
  if (entry.kind === 'note') {
    return sfDeleteOrMakeRest(model, entryId, (opts && opts.hard) ? 'delete' : 'rest');
  }
  return { ok: false, changed: false, entry: null };
}

function sfGetAdjacentEntryId(model, entryId, dir) {
  const found = sfFindEntry(model, entryId);
  if (!found) return null;
  const { part, measureIndex, entryIndex, entry } = found;
  const voice = entry.voice || '1';
  const stepDir = dir < 0 ? -1 : 1;

  for (let mi = measureIndex; mi >= 0 && mi < part.measures.length; mi += stepDir) {
    const m = part.measures[mi];
    if (!m) continue;
    let ei = (mi === measureIndex)
      ? (entryIndex + stepDir)
      : (stepDir > 0 ? 0 : m.entries.length - 1);
    for (; ei >= 0 && ei < m.entries.length; ei += stepDir) {
      const e = m.entries[ei];
      if ((e.kind === 'note' || e.kind === 'rest') && !e.isGrace && (e.voice || '1') === voice) {
        return e.id;
      }
    }
  }
  return null;
}

function sfBuildTapMap(model, osmdMeasureList, instruments, svgRoot) {
  const byNoteId = new Map();
  const entries = [];
  if (!model || !Array.isArray(osmdMeasureList)) {
    const ties = [];
  if (svgRoot && typeof svgRoot.querySelectorAll === 'function') {
    const textEls = Array.from(svgRoot.querySelectorAll('text'));
    const taggedTexts = new Set();
    const getBox = el => {
      if (!el) return null;
      if (typeof el.getBoundingClientRect === 'function') return el.getBoundingClientRect();
      if (typeof el.getBBox === 'function') {
        const b = el.getBBox();
        return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height, width: b.width, height: b.height };
      }
      return null;
    };

    const normSvgTxt = s => String(s || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .trim()
      .replace(/-+$/, '')
      .trim();

    // Tag rendered lyric <text> elements near matched notes
    for (const rec of entries) {
      if (rec.isRest || !rec.svgEl) continue;
      const lyr = sfGetNoteLyric(rec.entry, 1);
      if (!lyr) continue;
      const cleanLyr = normSvgTxt(lyr);
      if (!cleanLyr) continue;
      const noteBox = getBox(rec.svgEl);
      if (!noteBox) continue;
      let bestText = null;
      let bestDist = Infinity;
      for (const tEl of textEls) {
        if (taggedTexts.has(tEl)) continue;
        const tNorm = normSvgTxt(tEl.textContent);
        if (!tNorm || tNorm !== cleanLyr) continue;
        const tBox = getBox(tEl);
        if (!tBox) continue;
        const dx = Math.abs((tBox.left + tBox.width / 2) - (noteBox.left + noteBox.width / 2));
        const dy = tBox.top - noteBox.bottom;
        if (dx <= 48 && dy >= -10 && dy <= 140) {
          const d = dx + Math.abs(dy) * 0.25;
          if (d < bestDist) { bestDist = d; bestText = tEl; }
        }
      }
      if (bestText) {
        taggedTexts.add(bestText);
        bestText.setAttribute('data-sf-lyric', rec.noteId);
        bestText.setAttribute('data-sf-measure', String(rec.measureIndex));
      }
    }

    const dynEls = Array.from(svgRoot.querySelectorAll('.vf-dynamics, g[class*="dynamic"]'));

    // Tag rendered direction <words> & <dynamics> elements inside each measure's x-span
    for (let mi = 0; mi < osmdMeasureList.length; mi++) {
      const staffs = osmdMeasureList[mi] || [];
      let mLeft = Infinity, mRight = -Infinity;
      for (const rec of entries) {
        if (rec.measureIndex !== mi || !rec.svgEl) continue;
        const b = getBox(rec.svgEl);
        if (b) {
          if (b.left < mLeft) mLeft = b.left;
          if (b.right > mRight) mRight = b.right;
        }
      }
      if (!isFinite(mLeft)) {
        for (const gm of staffs) {
          const gEl = gm && typeof gm.getSVGGElement === 'function' ? gm.getSVGGElement() : null;
          const b = getBox(gEl);
          if (b) {
            if (b.left < mLeft) mLeft = b.left;
            if (b.right > mRight) mRight = b.right;
          }
        }
      }
      if (!isFinite(mLeft)) continue;

      for (const part of model.parts || []) {
        const m = part.measures && part.measures[mi];
        if (!m) continue;
        for (const e of m.entries || []) {
          if (e.kind !== 'other' || e.tag !== 'direction') continue;
          const txt = sfGetDirectionText(e);
          const normTxt = normSvgTxt(txt);
          const isDynamic = e.markingKind === 'dynamic' || (e.rawXml && e.rawXml.includes('<dynamics'));
          const metroMatch = (!normTxt && e.rawXml) ? e.rawXml.match(/<per-minute>\s*([^<]+?)\s*<\/per-minute>/) : null;
          const metroBpm = metroMatch ? metroMatch[1].trim() : '';
          let matchedEl = null;

          if (normTxt) {
            for (const tEl of textEls) {
              if (taggedTexts.has(tEl)) continue;
              if (normSvgTxt(tEl.textContent) !== normTxt) continue;
              const tBox = getBox(tEl);
              if (tBox && tBox.left >= mLeft - 36 && tBox.left <= mRight + 36) {
                matchedEl = tEl;
                break;
              }
            }
          }
          if (!matchedEl && metroBpm) {
            const metroRe = new RegExp('(?:^|[=♩♪]\\s*)' + metroBpm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\b|$)');
            for (const tEl of textEls) {
              if (taggedTexts.has(tEl)) continue;
              const tNorm = normSvgTxt(tEl.textContent);
              if (!tNorm || !metroRe.test(tNorm)) continue;
              const tBox = getBox(tEl);
              if (tBox && tBox.left >= mLeft - 36 && tBox.left <= mRight + 36) {
                matchedEl = tEl;
                break;
              }
            }
          }
          if (!matchedEl && isDynamic) {
            for (const dEl of dynEls) {
              if (taggedTexts.has(dEl)) continue;
              const dBox = getBox(dEl);
              if (dBox && dBox.left >= mLeft - 36 && dBox.left <= mRight + 36) {
                matchedEl = dEl;
                break;
              }
            }
          }
          if (matchedEl) {
            taggedTexts.add(matchedEl);
            matchedEl.setAttribute('data-sf-dir', e.id);
            matchedEl.setAttribute('data-sf-measure', String(mi));
          }
        }
      }
    }

    // Tag rendered header / credit / title / composer <text> elements
    const hdrItems = sfGetHeaderTexts(model);
    if (hdrItems.length) {
      const normHdr = s => normSvgTxt(s).replace(/\s+/g, ' ').toLowerCase();
      for (const tEl of textEls) {
        if (taggedTexts.has(tEl)) continue;
        if (tEl.getAttribute && (tEl.getAttribute('data-sf-lyric') || tEl.getAttribute('data-sf-dir'))) continue;
        const tRaw = (tEl.textContent || '').trim();
        const tNorm = normHdr(tRaw);
        if (!tNorm) continue;
        const hit = hdrItems.find(h => {
          const hNorm = normHdr(h.text);
          if (!hNorm) return false;
          if (hNorm === tNorm) return true;
          return tNorm.length >= 3 && (hNorm.includes(tNorm) || tNorm.includes(hNorm));
        });
        if (hit) {
          taggedTexts.add(tEl);
          tEl.setAttribute('data-sf-header', '1');
          tEl.setAttribute('data-sf-header-text', hit.text);
        }
      }
    }

    // Tag rendered tie SVG arcs (.vf-stavetie, g[class*="tie"], path[class*="tie"])
    const tieStarts = entries.filter(r => !r.isRest && r.svgEl && Array.isArray(r.entry.ties) && r.entry.ties.includes('start'));
    if (tieStarts.length) {
      const rawTieEls = Array.from(svgRoot.querySelectorAll('.vf-stavetie, g[class*="tie"], path[class*="tie"]'));
      const tieElSet = new Set(rawTieEls);
      for (const tieEl of rawTieEls) {
        const cls = String((tieEl.getAttribute && tieEl.getAttribute('class')) || (tieEl.className && tieEl.className.baseVal) || tieEl.className || '').toLowerCase();
        if (cls.includes('slur')) continue;
        if (tieEl.parentElement && tieElSet.has(tieEl.parentElement)) continue;
        const tBox = getBox(tieEl);
        if (!tBox) continue;
        const tx = tBox.left;
        const ty = tBox.top + (tBox.height || 0) / 2;
        let bestRec = null;
        let bestDist = Infinity;
        for (const rec of tieStarts) {
          const nBox = getBox(rec.svgEl);
          if (!nBox) continue;
          const nx = nBox.left + (nBox.width || 0) / 2;
          const ny = nBox.top + (nBox.height || 0) / 2;
          const d = Math.abs(tx - nx) + Math.abs(ty - ny) * 1.5;
          if (d < bestDist && d <= 200) {
            bestDist = d;
            bestRec = rec;
          }
        }
        if (bestRec) {
          tieEl.setAttribute('data-sf-tie', bestRec.noteId);
          tieEl.setAttribute('data-sf-measure', String(bestRec.measureIndex));
          ties.push({ noteId: bestRec.noteId, measureIndex: bestRec.measureIndex, el: tieEl, entry: bestRec.entry });
        }
      }
    }
  }

  return { byNoteId, entries, ties };
  }

  for (let mi = 0; mi < osmdMeasureList.length; mi++) {
    const staffs = osmdMeasureList[mi] || [];
    const usedIds = new Set();

    for (let gmIdx = 0; gmIdx < staffs.length; gmIdx++) {
      const gm = staffs[gmIdx];
      if (!gm) continue;
      if (gm.ParentStaff && gm.ParentStaff.ParentInstrument && gm.ParentStaff.ParentInstrument.Visible === false) {
        continue;
      }

      const pi = sfResolvePartIndex(model, gm, gmIdx, instruments);
      const part = model.parts[pi];
      if (!part) continue;
      const measure = part.measures[mi];
      if (!measure) continue;

      const staffNum = (gm.ParentStaff && gm.ParentStaff.Id) || gm.staffIndex || 1;
      const candidates = [];
      for (let ei = 0; ei < measure.entries.length; ei++) {
        const e = measure.entries[ei];
        if ((e.kind === 'note' || e.kind === 'rest') && !e.isGrace) {
          candidates.push({ entry: e, ei });
        }
      }

      for (const se of gm.staffEntries || []) {
        const seTs = (se.relInMeasureTimestamp && isFinite(se.relInMeasureTimestamp.RealValue))
          ? se.relInMeasureTimestamp.RealValue * 4
          : ((se.sourceStaffEntry && se.sourceStaffEntry.Timestamp && isFinite(se.sourceStaffEntry.Timestamp.RealValue))
            ? se.sourceStaffEntry.Timestamp.RealValue * 4
            : (typeof se.onsetQ === 'number' ? se.onsetQ : NaN));

        for (const gve of se.graphicalVoiceEntries || []) {
          const rawVid = (gve.parentVoiceEntry && gve.parentVoiceEntry.ParentVoice && gve.parentVoiceEntry.ParentVoice.VoiceId != null)
            ? gve.parentVoiceEntry.ParentVoice.VoiceId
            : (gve.voiceId != null ? gve.voiceId : null);
          const vid = rawVid != null ? String(rawVid) : '';

          for (const gn of gve.notes || []) {
            const sn = gn.sourceNote || gn;
            const isRest = typeof sn.isRest === 'function'
              ? !!sn.isRest()
              : (sn.isRest === true || sn.isRestFlag === true || (!sn.Pitch && !sn.pitch && sn.midi == null && sn.halfTone == null));
            const midiCands = isRest ? [] : sfExtractOsmdMidiCandidates(sn);
            const gnOnsetQ = isFinite(seTs)
              ? seTs
              : ((sn.VoiceEntry && sn.VoiceEntry.Timestamp && isFinite(sn.VoiceEntry.Timestamp.RealValue))
                ? sn.VoiceEntry.Timestamp.RealValue * 4
                : (typeof sn.onsetQ === 'number' ? sn.onsetQ : NaN));
            const durQ = (sn.Length && isFinite(sn.Length.RealValue))
              ? sn.Length.RealValue * 4
              : (typeof sn.durationQ === 'number' ? sn.durationQ : NaN);

            let best = null;
            let bestCost = Infinity;

            for (const c of candidates) {
              const e = c.entry;
              if (usedIds.has(e.id)) continue;
              if (e.isRest !== isRest) continue;

              let cost = c.ei * 1e-4;
              if (isFinite(gnOnsetQ)) {
                const dt = Math.abs(e.onsetQ - gnOnsetQ);
                if (dt > 0.25) continue;
                cost += dt * 100;
              }
              if (vid && e.voice !== vid) {
                cost += 5;
              }
              if (part.staves > 1 && e.staff !== staffNum) {
                cost += 10;
              }
              if (!isRest && midiCands.length && e.midi !== null) {
                let minPitchDiff = Infinity;
                for (let k = 0; k < midiCands.length; k++) {
                  const m = midiCands[k];
                  // Match against written MIDI first, also accept sounding MIDI if OSMD transposed pitch
                  const dWritten = Math.abs(m - e.midi) + (k > 0 ? 0.01 : 0);
                  const dSound = e.soundingMidi !== null ? (Math.abs(m - e.soundingMidi) + 0.05) : Infinity;
                  const d = Math.min(dWritten, dSound);
                  if (d < minPitchDiff) minPitchDiff = d;
                }
                cost += minPitchDiff * 20;
              }
              if (isFinite(durQ)) {
                cost += Math.abs(e.durationQ - durQ) * 2;
              }

              if (cost < bestCost) {
                bestCost = cost;
                best = e;
              }
            }

            if (!best) continue;
            usedIds.add(best.id);

            const svgEl = (typeof gn.getSVGGElement === 'function')
              ? gn.getSVGGElement()
              : (gn.svgEl || null);
            if (svgEl && typeof svgEl.setAttribute === 'function') {
              svgEl.setAttribute('data-sf-note', best.id);
              svgEl.setAttribute('data-sf-measure', String(mi));
              svgEl.setAttribute('data-sf-kind', best.isRest ? 'rest' : 'note');
            }

            const rec = {
              noteId: best.id,
              partIndex: pi,
              measureIndex: mi,
              voice: best.voice,
              isRest: best.isRest,
              onsetQ: best.onsetQ,
              midi: best.midi,
              entry: best,
              gn,
              gm,
              se,
              svgEl
            };
            byNoteId.set(best.id, rec);
            entries.push(rec);
          }
        }
      }
    }
  }

  const ties = [];
  if (svgRoot && typeof svgRoot.querySelectorAll === 'function') {
    const textEls = Array.from(svgRoot.querySelectorAll('text'));
    const taggedTexts = new Set();
    const getBox = el => {
      if (!el) return null;
      if (typeof el.getBoundingClientRect === 'function') return el.getBoundingClientRect();
      if (typeof el.getBBox === 'function') {
        const b = el.getBBox();
        return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height, width: b.width, height: b.height };
      }
      return null;
    };

    const normSvgTxt = s => String(s || '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .trim()
      .replace(/-+$/, '')
      .trim();

    // Tag rendered lyric <text> elements near matched notes
    for (const rec of entries) {
      if (rec.isRest || !rec.svgEl) continue;
      const lyr = sfGetNoteLyric(rec.entry, 1);
      if (!lyr) continue;
      const cleanLyr = normSvgTxt(lyr);
      if (!cleanLyr) continue;
      const noteBox = getBox(rec.svgEl);
      if (!noteBox) continue;
      let bestText = null;
      let bestDist = Infinity;
      for (const tEl of textEls) {
        if (taggedTexts.has(tEl)) continue;
        const tNorm = normSvgTxt(tEl.textContent);
        if (!tNorm || tNorm !== cleanLyr) continue;
        const tBox = getBox(tEl);
        if (!tBox) continue;
        const dx = Math.abs((tBox.left + tBox.width / 2) - (noteBox.left + noteBox.width / 2));
        const dy = tBox.top - noteBox.bottom;
        if (dx <= 48 && dy >= -10 && dy <= 140) {
          const d = dx + Math.abs(dy) * 0.25;
          if (d < bestDist) { bestDist = d; bestText = tEl; }
        }
      }
      if (bestText) {
        taggedTexts.add(bestText);
        bestText.setAttribute('data-sf-lyric', rec.noteId);
        bestText.setAttribute('data-sf-measure', String(rec.measureIndex));
      }
    }

    const dynEls = Array.from(svgRoot.querySelectorAll('.vf-dynamics, g[class*="dynamic"]'));

    // Tag rendered direction <words> & <dynamics> elements inside each measure's x-span
    for (let mi = 0; mi < osmdMeasureList.length; mi++) {
      const staffs = osmdMeasureList[mi] || [];
      let mLeft = Infinity, mRight = -Infinity;
      for (const rec of entries) {
        if (rec.measureIndex !== mi || !rec.svgEl) continue;
        const b = getBox(rec.svgEl);
        if (b) {
          if (b.left < mLeft) mLeft = b.left;
          if (b.right > mRight) mRight = b.right;
        }
      }
      if (!isFinite(mLeft)) {
        for (const gm of staffs) {
          const gEl = gm && typeof gm.getSVGGElement === 'function' ? gm.getSVGGElement() : null;
          const b = getBox(gEl);
          if (b) {
            if (b.left < mLeft) mLeft = b.left;
            if (b.right > mRight) mRight = b.right;
          }
        }
      }
      if (!isFinite(mLeft)) continue;

      for (const part of model.parts || []) {
        const m = part.measures && part.measures[mi];
        if (!m) continue;
        for (const e of m.entries || []) {
          if (e.kind !== 'other' || e.tag !== 'direction') continue;
          const txt = sfGetDirectionText(e);
          const normTxt = normSvgTxt(txt);
          const isDynamic = e.markingKind === 'dynamic' || (e.rawXml && e.rawXml.includes('<dynamics'));
          const metroMatch = (!normTxt && e.rawXml) ? e.rawXml.match(/<per-minute>\s*([^<]+?)\s*<\/per-minute>/) : null;
          const metroBpm = metroMatch ? metroMatch[1].trim() : '';
          let matchedEl = null;

          if (normTxt) {
            for (const tEl of textEls) {
              if (taggedTexts.has(tEl)) continue;
              if (normSvgTxt(tEl.textContent) !== normTxt) continue;
              const tBox = getBox(tEl);
              if (tBox && tBox.left >= mLeft - 36 && tBox.left <= mRight + 36) {
                matchedEl = tEl;
                break;
              }
            }
          }
          if (!matchedEl && metroBpm) {
            const metroRe = new RegExp('(?:^|[=♩♪]\\s*)' + metroBpm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\b|$)');
            for (const tEl of textEls) {
              if (taggedTexts.has(tEl)) continue;
              const tNorm = normSvgTxt(tEl.textContent);
              if (!tNorm || !metroRe.test(tNorm)) continue;
              const tBox = getBox(tEl);
              if (tBox && tBox.left >= mLeft - 36 && tBox.left <= mRight + 36) {
                matchedEl = tEl;
                break;
              }
            }
          }
          if (!matchedEl && isDynamic) {
            for (const dEl of dynEls) {
              if (taggedTexts.has(dEl)) continue;
              const dBox = getBox(dEl);
              if (dBox && dBox.left >= mLeft - 36 && dBox.left <= mRight + 36) {
                matchedEl = dEl;
                break;
              }
            }
          }
          if (matchedEl) {
            taggedTexts.add(matchedEl);
            matchedEl.setAttribute('data-sf-dir', e.id);
            matchedEl.setAttribute('data-sf-measure', String(mi));
          }
        }
      }
    }

    // Tag rendered header / credit / title / composer <text> elements
    const hdrItems = sfGetHeaderTexts(model);
    if (hdrItems.length) {
      const normHdr = s => normSvgTxt(s).replace(/\s+/g, ' ').toLowerCase();
      for (const tEl of textEls) {
        if (taggedTexts.has(tEl)) continue;
        if (tEl.getAttribute && (tEl.getAttribute('data-sf-lyric') || tEl.getAttribute('data-sf-dir'))) continue;
        const tRaw = (tEl.textContent || '').trim();
        const tNorm = normHdr(tRaw);
        if (!tNorm) continue;
        const hit = hdrItems.find(h => {
          const hNorm = normHdr(h.text);
          if (!hNorm) return false;
          if (hNorm === tNorm) return true;
          return tNorm.length >= 3 && (hNorm.includes(tNorm) || tNorm.includes(hNorm));
        });
        if (hit) {
          taggedTexts.add(tEl);
          tEl.setAttribute('data-sf-header', '1');
          tEl.setAttribute('data-sf-header-text', hit.text);
        }
      }
    }

    // Tag rendered tie SVG arcs (.vf-stavetie, g[class*="tie"], path[class*="tie"])
    const tieStarts = entries.filter(r => !r.isRest && r.svgEl && Array.isArray(r.entry.ties) && r.entry.ties.includes('start'));
    if (tieStarts.length) {
      const rawTieEls = Array.from(svgRoot.querySelectorAll('.vf-stavetie, g[class*="tie"], path[class*="tie"]'));
      const tieElSet = new Set(rawTieEls);
      for (const tieEl of rawTieEls) {
        const cls = String((tieEl.getAttribute && tieEl.getAttribute('class')) || (tieEl.className && tieEl.className.baseVal) || tieEl.className || '').toLowerCase();
        if (cls.includes('slur')) continue;
        if (tieEl.parentElement && tieElSet.has(tieEl.parentElement)) continue;
        const tBox = getBox(tieEl);
        if (!tBox) continue;
        const tx = tBox.left;
        const ty = tBox.top + (tBox.height || 0) / 2;
        let bestRec = null;
        let bestDist = Infinity;
        for (const rec of tieStarts) {
          const nBox = getBox(rec.svgEl);
          if (!nBox) continue;
          const nx = nBox.left + (nBox.width || 0) / 2;
          const ny = nBox.top + (nBox.height || 0) / 2;
          const d = Math.abs(tx - nx) + Math.abs(ty - ny) * 1.5;
          if (d < bestDist && d <= 200) {
            bestDist = d;
            bestRec = rec;
          }
        }
        if (bestRec) {
          tieEl.setAttribute('data-sf-tie', bestRec.noteId);
          tieEl.setAttribute('data-sf-measure', String(bestRec.measureIndex));
          ties.push({ noteId: bestRec.noteId, measureIndex: bestRec.measureIndex, el: tieEl, entry: bestRec.entry });
        }
      }
    }
  }

  return { byNoteId, entries, ties };
}

// ---------- Consistency Passes: OCR Lyric Cleanup, Signature Consensus, Rhythm Auto-Fix
function sfLevenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

function sfMatchCase(sourceWord, targetLower) {
  if (!sourceWord) return targetLower;
  if (sourceWord === sourceWord.toUpperCase() && /[A-Z]/.test(sourceWord)) {
    return targetLower.toUpperCase();
  }
  if (sourceWord[0] === sourceWord[0].toUpperCase() && sourceWord.slice(1) === sourceWord.slice(1).toLowerCase()) {
    return targetLower[0].toUpperCase() + targetLower.slice(1);
  }
  return targetLower;
}

function sfCleanOcrLyrics(model, pdfVocabulary) {
  const fixes = [];
  if (!model || !Array.isArray(model.parts)) return { fixedCount: 0, fixes };

  const vocabSet = new Set();
  const vocabList = [];
  if (Array.isArray(pdfVocabulary)) {
    for (const rawW of pdfVocabulary) {
      const w = String(rawW || '').trim().toLowerCase();
      if (w && !vocabSet.has(w)) {
        vocabSet.add(w);
        vocabList.push(w);
      }
    }
  }

  for (const part of model.parts) {
    for (const m of part.measures || []) {
      for (const e of m.entries || []) {
        if (e.kind !== 'note' || e.isRest || !Array.isArray(e.lyrics) || !e.lyrics.length) continue;
        for (const lyr of e.lyrics) {
          const before = lyr.text;
          if (!before) continue;

          // Strip stray OCR noise characters
          let cleaned = before.replace(/[|`~•]/g, '');
          // Preserve real contractions (e.g. I’m -> I'm if in vocab), otherwise strip stray curly quotes inside letters
          if (/([A-Za-z])[\u2018\u2019]([A-Za-z])/.test(cleaned)) {
            const asApos = cleaned.replace(/([A-Za-z])[\u2018\u2019]([A-Za-z])/g, "$1'$2");
            if (vocabSet.has(asApos.toLowerCase())) {
              cleaned = asApos;
            } else if (!vocabSet.size || !vocabSet.has(cleaned.toLowerCase())) {
              cleaned = cleaned.replace(/([A-Za-z])[\u2018\u2019]([A-Za-z])/g, '$1$2');
            }
          }

          if (vocabList.length) {
            const tokMatch = cleaned.match(/^([^A-Za-z]*)([A-Za-z][A-Za-z'-]*)([^A-Za-z]*)$/);
            if (tokMatch) {
              const lead = tokMatch[1], core = tokMatch[2], trail = tokMatch[3];
              const coreLower = core.toLowerCase();
              if (core.length >= 4 && !vocabSet.has(coreLower)) {
                const maxDist = core.length >= 5 ? 2 : 1;
                let bestDist = maxDist + 1;
                let bestWords = [];
                for (const vw of vocabList) {
                  if (Math.abs(vw.length - coreLower.length) > maxDist) continue;
                  const d = sfLevenshtein(coreLower, vw);
                  if (d < bestDist) {
                    bestDist = d;
                    bestWords = [vw];
                  } else if (d === bestDist) {
                    bestWords.push(vw);
                  }
                }
                if (bestWords.length === 1 && bestDist <= maxDist) {
                  cleaned = lead + sfMatchCase(core, bestWords[0]) + trail;
                }
              }
            }
          }

          if (cleaned !== before) {
            lyr.text = cleaned;
            fixes.push({ entryId: e.id, before, after: cleaned });
          }
        }
      }
    }
  }

  return { fixedCount: fixes.length, fixes };
}

function sfReconcileMeasureUnmarkedPitches(m, oldFifths, newFifths, partTranspose) {
  if (oldFifths === newFifths || !m || !Array.isArray(m.entries)) return 0;
  const trSemis = m.activeTranspose ? sfTransposeSemis(m.activeTranspose) : sfTransposeSemis(partTranspose);
  let updated = 0;
  for (const e of m.entries) {
    if (e.kind !== 'note' || e.isRest || e.spoken || !e.step || !isFinite(e.octave)) continue;
    if (!e.accidental && (e.alter || 0) === sfKeyAlterForStep(oldFifths, e.step)) {
      e.alter = sfKeyAlterForStep(newFifths, e.step);
      e.midi = sfPitchToMidi(e.step, e.octave, e.alter);
      e.soundingMidi = e.midi !== null ? e.midi + trSemis : null;
      updated++;
    }
  }
  return updated;
}

function sfStabilizeKeySignatures(model) {
  if (!model || !Array.isArray(model.parts)) return 0;
  if (!Array.isArray(model.autoRepairs)) model.autoRepairs = [];
  model.stabilizedKeyMeasures = 0;
  if (!model.parts.length) return 0;

  const byTrans = new Map();
  for (const part of model.parts) {
    const trChrom = (part.transpose && part.transpose.chromatic) || 0;
    if (!byTrans.has(trChrom)) byTrans.set(trChrom, []);
    byTrans.get(trChrom).push(part);
  }

  let repairedCount = 0;
  for (const group of byTrans.values()) {
    let maxMeasures = 0;
    for (const part of group) {
      if (part.measures && part.measures.length > maxMeasures) maxMeasures = part.measures.length;
    }
    if (!maxMeasures) continue;

    const counts = {};
    let totalPM = 0;
    const distinctFifths = new Set();
    let disagreementMeasures = 0;

    for (let mi = 0; mi < maxMeasures; mi++) {
      const barFifths = new Set();
      for (const part of group) {
        const m = part.measures && part.measures[mi];
        if (!m || !m.key) continue;
        const f = m.key.fifths || 0;
        counts[f] = (counts[f] || 0) + 1;
        totalPM++;
        distinctFifths.add(f);
        barFifths.add(f);
      }
      if (barFifths.size >= 2) disagreementMeasures++;
    }

    if (distinctFifths.size < 2 || totalPM === 0) continue;

    let revisitCount = 0;
    for (const part of group) {
      const visited = new Set();
      let prev = null;
      const measures = part.measures || [];
      for (let mi = 0; mi < measures.length; mi++) {
        const m = measures[mi];
        if (!m || !m.key) continue;
        const f = m.key.fifths || 0;
        if (f !== prev) {
          if (visited.has(f)) revisitCount++;
          visited.add(f);
          prev = f;
        }
      }
    }

    const uniq = Array.from(distinctFifths);
    const allNonPos = uniq.every(f => f <= 0);
    const allNonNeg = uniq.every(f => f >= 0);
    if (!(allNonPos || allNonNeg)) continue;

    if (group.length >= 2) {
      if (!(disagreementMeasures >= 1 && (revisitCount >= 1 || disagreementMeasures >= 2))) continue;
    } else {
      if (!(revisitCount >= 2)) continue;
    }

    const qualified = uniq.filter(f => counts[f] >= totalPM * 0.20);
    let targetFifths;
    if (qualified.length) {
      qualified.sort((a, b) => (Math.abs(b) - Math.abs(a)) || (counts[b] - counts[a]));
      targetFifths = qualified[0];
    } else {
      uniq.sort((a, b) => (counts[b] - counts[a]) || (Math.abs(b) - Math.abs(a)));
      targetFifths = uniq[0];
    }

    for (const part of group) {
      const measures = part.measures || [];
      for (let mi = 0; mi < measures.length; mi++) {
        const m = measures[mi];
        if (!m || !m.key) continue;
        const oldFifths = m.key.fifths || 0;
        if (oldFifths !== targetFifths) {
          m.key = Object.assign({}, m.key, { fifths: targetFifths });
          sfReconcileMeasureUnmarkedPitches(m, oldFifths, targetFifths, part.transpose);
          repairedCount++;
          model.autoRepairs.push({
            kind: 'key_signature_stabilize',
            measureNumber: m.number || String(mi + 1),
            partName: part.name || 'Part',
            detail: `Stabilized key signature ${oldFifths} -> ${targetFifths} fifths`
          });
        }
        m.hasKeyAttr = (mi === 0);
      }
    }
  }

  model.stabilizedKeyMeasures = repairedCount;
  return repairedCount;
}

if (typeof window !== 'undefined') {
  window.sfReconcileMeasureUnmarkedPitches = sfReconcileMeasureUnmarkedPitches;
  window.sfStabilizeKeySignatures = sfStabilizeKeySignatures;
}

function sfAlignPartSignatures(model) {
  if (!model || !Array.isArray(model.parts)) return model;
  if (!Array.isArray(model.autoRepairs)) model.autoRepairs = [];
  if (model.parts.length < 2) return model;

  let maxMeasures = 0;
  for (const p of model.parts) {
    if (p.measures && p.measures.length > maxMeasures) maxMeasures = p.measures.length;
  }

  for (let mi = 0; mi < maxMeasures; mi++) {
    // 1. Time signature consensus across all parts
    const timeCounts = {};
    const timeItems = [];
    for (const part of model.parts) {
      const m = part.measures && part.measures[mi];
      if (!m || !m.time) continue;
      const key = `${m.time.beats}/${m.time.beatType}`;
      timeCounts[key] = (timeCounts[key] || 0) + 1;
      timeItems.push({ part, m, key, beats: m.time.beats, beatType: m.time.beatType, symbol: m.time.symbol || null });
    }
    let bestTimeKey = null, bestTimeCount = 0;
    for (const k of Object.keys(timeCounts)) {
      if (timeCounts[k] > bestTimeCount) {
        bestTimeCount = timeCounts[k];
        bestTimeKey = k;
      }
    }
    if (bestTimeKey && bestTimeCount >= 2 && bestTimeCount > timeItems.length / 2) {
      const ref = timeItems.find(it => it.key === bestTimeKey);
      for (const it of timeItems) {
        if (it.key !== bestTimeKey) {
          const oldKey = it.key;
          it.m.time = { beats: ref.beats, beatType: ref.beatType, symbol: ref.symbol };
          it.m.hasTimeAttr = true;
          model.autoRepairs.push({
            kind: 'time_signature',
            measureNumber: it.m.number,
            partName: it.part.name,
            detail: `Aligned time signature ${oldKey} -> ${bestTimeKey}`
          });
        }
      }
    } else if (mi > 0) {
      // Mid-score single-staff propagation: if at least one part has an explicit <time> at mi > 0, propagate to others lacking it
      const explicitItems = timeItems.filter(it => it.m.hasTimeAttr);
      const nonExplicitItems = timeItems.filter(it => !it.m.hasTimeAttr);
      if (explicitItems.length >= 1 && nonExplicitItems.length >= 1) {
        const ref = explicitItems[0];
        for (const it of nonExplicitItems) {
          if (it.m.time.beats !== ref.beats || it.m.time.beatType !== ref.beatType) {
            sfPropagateTimeSigForward(it.part, mi, ref.beats, ref.beatType);
            model.autoRepairs.push({
              kind: 'time_signature_propagate',
              measureNumber: it.m.number,
              partName: it.part.name,
              detail: `Propagated ${ref.beats}/${ref.beatType} from ${ref.part.name}`
            });
          } else {
            it.m.hasTimeAttr = true;
          }
        }
      }
    }

    // 2. Transposition-aware key signature consensus
    const byTrans = {};
    for (const part of model.parts) {
      const m = part.measures && part.measures[mi];
      if (!m || !m.key) continue;
      const trChrom = (m.activeTranspose && m.activeTranspose.chromatic) || (part.transpose && part.transpose.chromatic) || 0;
      (byTrans[trChrom] || (byTrans[trChrom] = [])).push({ part, m, fifths: m.key.fifths || 0 });
    }
    for (const trKey of Object.keys(byTrans)) {
      const group = byTrans[trKey];
      if (group.length < 3) continue;
      const kCounts = {};
      for (const it of group) {
        kCounts[it.fifths] = (kCounts[it.fifths] || 0) + 1;
      }
      let bestFifths = null, bestKCount = 0;
      for (const fk of Object.keys(kCounts)) {
        if (kCounts[fk] > bestKCount) {
          bestKCount = kCounts[fk];
          bestFifths = Number(fk);
        }
      }
      if (bestFifths !== null && bestKCount >= 2 && bestKCount > group.length / 2) {
        for (const it of group) {
          if (it.fifths !== bestFifths) {
            const oldFifths = it.fifths;
            it.m.key.fifths = bestFifths;
            it.m.hasKeyAttr = true;
            sfReconcileMeasureUnmarkedPitches(it.m, oldFifths, bestFifths, it.part.transpose);
            model.autoRepairs.push({
              kind: 'key_signature',
              measureNumber: it.m.number,
              partName: it.part.name,
              detail: `Aligned key signature ${oldFifths} -> ${bestFifths} fifths`
            });
          }
        }
      }
    }
  }

  return model;
}

function sfFmtQCount(q) {
  const r = Math.round(q * 100) / 100;
  return String(r);
}

function sfSuggestRhythmFixes(model, flagReport) {
  const suggestions = [];
  if (!model || !flagReport || !Array.isArray(flagReport.measures)) return suggestions;

  const seen = new Set();
  const stdTypes = ['16th', 'eighth', 'quarter', 'half', 'whole'];
  const stdRestMap = [
    { q: 0.25, type: '16th',    dots: 0 },
    { q: 0.5,  type: 'eighth',  dots: 0 },
    { q: 0.75, type: 'eighth',  dots: 1 },
    { q: 1,    type: 'quarter', dots: 0 },
    { q: 1.5,  type: 'quarter', dots: 1 },
    { q: 2,    type: 'half',    dots: 0 },
    { q: 3,    type: 'half',    dots: 1 }
  ];

  for (const fm of flagReport.measures) {
    for (const f of fm.findings || []) {
      if (f.rule !== 'duration_mismatch') continue;
      const pi = f.partIndex != null ? f.partIndex : 0;
      const mi = fm.measureIndex;
      const vid = f.voice || '1';
      const dedupeKey = `${pi}:${mi}:${vid}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const part = model.parts && model.parts[pi];
      const m = part && part.measures && part.measures[mi];
      if (!m) continue;

      const beats = (m.time && m.time.beats) || 4;
      const bt = (m.time && m.time.beatType) || 4;
      const expectedQ = beats * 4 / bt;
      const items = (m.entries || []).filter(e =>
        (e.kind === 'note' || e.kind === 'rest') && !e.isGrace && !e.isChord && (e.voice || '1') === vid
      );
      if (!items.length) continue;

      let actualQ = 0;
      let maxEndQ = 0;
      let hasForward = false;
      for (const e of m.entries || []) {
        if (e.kind === 'forward' && (e.voice || '1') === vid) {
          hasForward = true;
          maxEndQ = Math.max(maxEndQ, (e.onsetQ || 0) + (e.durationQ || 0));
        } else if ((e.kind === 'note' || e.kind === 'rest') && !e.isGrace && !e.isChord && (e.voice || '1') === vid) {
          actualQ += (e.durationQ || 0);
          maxEndQ = Math.max(maxEndQ, (e.onsetQ || 0) + (e.durationQ || 0));
        }
      }
      if (hasForward) actualQ = maxEndQ;

      const deltaQ = expectedQ - actualQ;
      if (Math.abs(deltaQ) <= 1e-3) continue;

      const itemLabel = e => e.isRest ? 'rest' : ((e.step || '') + (e.octave != null ? e.octave : ''));
      const deltaBeats = deltaQ * bt / 4;

      // 1. Missing dot
      if (deltaQ > 0) {
        const cand = items.find(e => !e.dots && Math.abs((e.durationQ || 0) - 2 * deltaQ) <= 1e-3);
        if (cand) {
          suggestions.push({
            kind: 'add_dot',
            partIndex: pi,
            measureIndex: mi,
            voice: vid,
            entryId: cand.id,
            label: `Add dot to ${itemLabel(cand)} (+${sfFmtQCount(deltaBeats)} beat)`
          });
        }
      }

      // 2. Extra dot
      if (deltaQ < 0) {
        const cand = items.find(e => e.dots > 0 && Math.abs(((e.durationQ || 0) / 3) - (-deltaQ)) <= 1e-3);
        if (cand) {
          suggestions.push({
            kind: 'remove_dot',
            partIndex: pi,
            measureIndex: mi,
            voice: vid,
            entryId: cand.id,
            label: `Remove dot from ${itemLabel(cand)} (−${sfFmtQCount(-deltaBeats)} beat)`
          });
        }
      }

      // 3. Wrong standard duration
      for (const cand of items) {
        for (const nt of stdTypes) {
          const nq = SF_TYPE_TO_Q[nt];
          if (Math.abs((nq - (cand.durationQ || 0)) - deltaQ) <= 1e-3) {
            suggestions.push({
              kind: 'change_duration',
              partIndex: pi,
              measureIndex: mi,
              voice: vid,
              entryId: cand.id,
              newType: nt,
              newDots: 0,
              label: `Change ${itemLabel(cand)} to ${nt}`
            });
            break;
          }
        }
      }

      // 4. Trailing rest fill
      if (deltaQ > 0) {
        const rMatch = stdRestMap.find(r => Math.abs(r.q - deltaQ) <= 1e-3);
        if (rMatch) {
          const staff = (items[0] && items[0].staff) || 1;
          suggestions.push({
            kind: 'fill_rest',
            partIndex: pi,
            measureIndex: mi,
            voice: vid,
            staff,
            restType: rMatch.type,
            restDots: rMatch.dots,
            label: `Add ${rMatch.dots ? 'dotted ' : ''}${rMatch.type} rest to finish measure`
          });
        }
      }
    }
  }

  return suggestions;
}

function sfApplyRhythmFix(model, suggestion) {
  if (!model || !suggestion) return { ok: false, changed: false, entryId: null };
  if (suggestion.kind === 'add_dot' || suggestion.kind === 'remove_dot') {
    const res = sfToggleDot(model, suggestion.entryId);
    return { ok: res.ok, changed: res.changed, entryId: suggestion.entryId };
  }
  if (suggestion.kind === 'change_duration') {
    const res = sfEditDuration(model, suggestion.entryId, suggestion.newType, !!suggestion.newDots);
    return { ok: res.ok, changed: res.changed, entryId: suggestion.entryId };
  }
  if (suggestion.kind === 'fill_rest') {
    const part = model.parts && model.parts[suggestion.partIndex];
    const m = part && part.measures && part.measures[suggestion.measureIndex];
    if (!m) return { ok: false, changed: false, entryId: null };
    const durInfo = sfEnsureDivisionsForDuration(m, suggestion.restType, !!suggestion.restDots);
    if (!durInfo) return { ok: false, changed: false, entryId: null };

    const vid = suggestion.voice || '1';
    const staff = suggestion.staff || 1;
    let insertAt = -1;
    for (let i = m.entries.length - 1; i >= 0; i--) {
      const e = m.entries[i];
      if ((e.kind === 'note' || e.kind === 'rest') && (e.voice || '1') === vid && (e.staff || 1) === staff) {
        insertAt = i + 1;
        break;
      }
    }
    if (insertAt < 0) {
      const barIdx = m.entries.findIndex(e => e.tag === 'barline');
      insertAt = barIdx >= 0 ? barIdx : m.entries.length;
    }

    const newRest = {
      id: sfNextEntryId(suggestion.partIndex, suggestion.measureIndex, m),
      kind: 'rest',
      partIndex: suggestion.partIndex,
      measureIndex: suggestion.measureIndex,
      voice: vid,
      staff,
      isChord: false,
      isRest: true,
      isGrace: false,
      isCue: false,
      measureRest: false,
      step: null,
      octave: null,
      alter: null,
      accidental: null,
      durationDivs: durInfo.durationDivs,
      durationQ: durInfo.newQ,
      type: suggestion.restType,
      dots: suggestion.restDots ? 1 : 0,
      ties: [],
      onsetQ: 0,
      midi: null,
      soundingMidi: null,
      spoken: false,
      notehead: null,
      isUnpitched: false,
      timeModification: null,
      extraXml: ''
    };
    m.entries.splice(insertAt, 0, newRest);
    sfRecalcMeasureOnsets(m);
    return { ok: true, changed: true, entryId: newRest.id };
  }
  return { ok: false, changed: false, entryId: null };
}

const SF_NOISY_NOTATION_TAGS = new Set([
  'slur', 'articulations', 'ornaments', 'technical', 'fermata', 'dynamics',
  'arpeggiate', 'glissando', 'non-arpeggiate', 'other-notation'
]);

function sfFilterScoreByMode(model, mode) {
  const normMode = (mode === 'notes-lyrics' || mode === 'notes-only') ? mode : 'full';
  if (!model || !Array.isArray(model.parts) || normMode === 'full') {
    return { mode: 'full', removedDirections: 0, removedLyrics: 0, removedNotations: 0 };
  }

  let removedDirections = 0;
  let removedLyrics = 0;
  let removedNotations = 0;
  const stripLyrics = normMode === 'notes-only';

  for (const part of model.parts) {
    for (const m of part.measures || []) {
      const nextEntries = [];
      let measureChanged = false;

      for (const e of m.entries || []) {
        if (e.kind === 'other' && (e.tag === 'direction' || e.tag === 'harmony')) {
          removedDirections++;
          measureChanged = true;
          continue;
        }
        if (e.kind === 'note' && !e.isRest) {
          if (stripLyrics && Array.isArray(e.lyrics) && e.lyrics.length) {
            removedLyrics += e.lyrics.length;
            e.lyrics = [];
            measureChanged = true;
          }
          if (e.extraXml) {
            let children;
            try { children = sfParseExtraWrap(e.extraXml); } catch { children = null; }
            if (children) {
              const kept = [];
              let noteChanged = false;
              for (const ch of children) {
                if (ch.type !== 'element') {
                  kept.push(sfSerializeXmlNode(ch));
                  continue;
                }
                if (ch.tag === 'notations') {
                  const keptNot = [];
                  for (const nc of ch.children || []) {
                    if (nc.type === 'element' && SF_NOISY_NOTATION_TAGS.has(nc.tag)) {
                      removedNotations++;
                      noteChanged = true;
                    } else if (nc.type === 'element') {
                      keptNot.push(nc);
                    }
                  }
                  if (keptNot.length) {
                    ch.children = keptNot;
                    kept.push(sfSerializeXmlNode(ch));
                  } else if ((ch.children || []).length === 0) {
                    // empty <notations/>
                  } else {
                    noteChanged = true;
                  }
                  continue;
                }
                kept.push(sfSerializeXmlNode(ch));
              }
              if (noteChanged) {
                e.extraXml = kept.join('');
                // Ensure <notations><tied/></notations> stays synced with e.ties
                e.extraXml = sfSyncNotationsTied(e.extraXml, e.ties);
              }
            }
          }
        }
        nextEntries.push(e);
      }

      if (measureChanged) {
        m.entries = nextEntries;
        sfRecalcMeasureOnsets(m);
      }
    }
  }

  if (normMode === 'notes-lyrics' || normMode === 'notes-only') {
    sfClearHeaderCredits(model, { includeTitle: false });
  }

  return {
    mode: normMode,
    removedDirections,
    removedLyrics,
    removedNotations
  };
}

// ---------- Header / Credit / Title Erasure Helpers
function sfNormHeaderMatch(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sfGetHeaderTexts(model) {
  const out = [];
  if (!model) return out;
  const counts = { credit: 0, 'work-title': 0, 'movement-title': 0, creator: 0 };

  if (model.headerXml && model.headerXml.trim()) {
    let nodes = [];
    try { nodes = sfParseExtraWrap(model.headerXml); } catch { nodes = []; }
    for (const ch of nodes) {
      if (ch.type !== 'element') continue;
      if (ch.tag === 'credit') {
        const txt = sfXmlText(ch).trim();
        if (txt) out.push({ kind: 'credit', index: counts.credit++, text: txt });
      } else if (ch.tag === 'work') {
        const wt = sfXmlChild(ch, 'work-title');
        const txt = wt ? sfXmlText(wt).trim() : '';
        if (txt) out.push({ kind: 'work-title', index: counts['work-title']++, text: txt });
      } else if (ch.tag === 'movement-title') {
        const txt = sfXmlText(ch).trim();
        if (txt) out.push({ kind: 'movement-title', index: counts['movement-title']++, text: txt });
      } else if (ch.tag === 'identification') {
        for (const cr of sfXmlChildren(ch, 'creator')) {
          const txt = sfXmlText(cr).trim();
          if (txt) out.push({ kind: 'creator', index: counts.creator++, text: txt });
        }
      }
    }
  } else {
    if (model.workTitle && String(model.workTitle).trim()) {
      out.push({ kind: 'work-title', index: 0, text: String(model.workTitle).trim() });
    }
    if (model.composer && String(model.composer).trim()) {
      out.push({ kind: 'creator', index: 0, text: String(model.composer).trim() });
    }
  }
  return out;
}

function sfRemoveHeaderText(model, targetTextOrSpec) {
  if (!model) return false;
  const isSpec = targetTextOrSpec && typeof targetTextOrSpec === 'object';
  const targetKind = isSpec ? targetTextOrSpec.kind : null;
  const targetIdx = isSpec ? Number(targetTextOrSpec.index) : -1;
  const targetNorm = isSpec ? sfNormHeaderMatch(targetTextOrSpec.text || '') : sfNormHeaderMatch(targetTextOrSpec);
  if (!isSpec && !targetNorm) return false;

  const matchesText = txt => {
    const n = sfNormHeaderMatch(txt);
    if (!n || !targetNorm) return false;
    if (n === targetNorm) return true;
    return targetNorm.length >= 3 && (n.includes(targetNorm) || targetNorm.includes(n));
  };

  let removed = false;
  if (model.headerXml && model.headerXml.trim()) {
    let nodes = [];
    try { nodes = sfParseExtraWrap(model.headerXml); } catch { nodes = []; }
    const counts = { credit: 0, 'work-title': 0, 'movement-title': 0, creator: 0 };
    const kept = [];

    for (const ch of nodes) {
      if (ch.type !== 'element') continue;
      if (ch.tag === 'credit') {
        const txt = sfXmlText(ch).trim();
        const idx = txt ? counts.credit++ : -1;
        const hit = isSpec
          ? (targetKind === 'credit' && idx === targetIdx)
          : matchesText(txt);
        if (hit) { removed = true; continue; }
        kept.push(ch);
      } else if (ch.tag === 'work') {
        const nextWorkChildren = [];
        for (const wc of ch.children || []) {
          if (wc.type === 'element' && wc.tag === 'work-title') {
            const txt = sfXmlText(wc).trim();
            const idx = txt ? counts['work-title']++ : -1;
            const hit = isSpec
              ? (targetKind === 'work-title' && idx === targetIdx)
              : matchesText(txt);
            if (hit) {
              removed = true;
              if (sfNormHeaderMatch(model.workTitle) === sfNormHeaderMatch(txt)) model.workTitle = '';
              continue;
            }
          }
          if (wc.type === 'element') nextWorkChildren.push(wc);
        }
        if (nextWorkChildren.length) {
          ch.children = nextWorkChildren;
          kept.push(ch);
        }
      } else if (ch.tag === 'movement-title') {
        const txt = sfXmlText(ch).trim();
        const idx = txt ? counts['movement-title']++ : -1;
        const hit = isSpec
          ? (targetKind === 'movement-title' && idx === targetIdx)
          : matchesText(txt);
        if (hit) {
          removed = true;
          if (sfNormHeaderMatch(model.workTitle) === sfNormHeaderMatch(txt)) model.workTitle = '';
          continue;
        }
        kept.push(ch);
      } else if (ch.tag === 'identification') {
        const nextIdChildren = [];
        for (const ic of ch.children || []) {
          if (ic.type === 'element' && ic.tag === 'creator') {
            const txt = sfXmlText(ic).trim();
            const idx = txt ? counts.creator++ : -1;
            const hit = isSpec
              ? (targetKind === 'creator' && idx === targetIdx)
              : matchesText(txt);
            if (hit) {
              removed = true;
              if (sfNormHeaderMatch(model.composer) === sfNormHeaderMatch(txt)) model.composer = '';
              continue;
            }
          }
          if (ic.type === 'element') nextIdChildren.push(ic);
        }
        if (nextIdChildren.length) {
          ch.children = nextIdChildren;
          kept.push(ch);
        }
      } else {
        kept.push(ch);
      }
    }

    if (removed) {
      model.headerXml = kept.map(sfSerializeXmlNode).join('\n  ');
    }
  } else {
    if ((isSpec && targetKind === 'work-title') || (!isSpec && matchesText(model.workTitle))) {
      model.workTitle = '';
      removed = true;
    }
    if ((isSpec && targetKind === 'creator') || (!isSpec && matchesText(model.composer))) {
      model.composer = '';
      removed = true;
    }
  }
  return removed;
}

function sfClearHeaderCredits(model, opts) {
  if (!model) return 0;
  const o = opts || {};
  const includeTitle = o.includeTitle !== false;
  let removedCount = 0;

  if (model.headerXml && model.headerXml.trim()) {
    let nodes = [];
    try { nodes = sfParseExtraWrap(model.headerXml); } catch { nodes = []; }
    const kept = [];
    for (const ch of nodes) {
      if (ch.type !== 'element') continue;
      if (ch.tag === 'credit' || ch.tag === 'movement-title' || ch.tag === 'movement-number') {
        removedCount++;
        continue;
      }
      if (ch.tag === 'work') {
        if (includeTitle) {
          removedCount++;
          continue;
        }
        kept.push(ch);
        continue;
      }
      if (ch.tag === 'identification') {
        const nextIdChildren = [];
        for (const ic of ch.children || []) {
          if (ic.type === 'element' && ic.tag === 'creator') {
            removedCount++;
            continue;
          }
          if (ic.type === 'element') nextIdChildren.push(ic);
        }
        if (nextIdChildren.length) {
          ch.children = nextIdChildren;
          kept.push(ch);
        }
        continue;
      }
      kept.push(ch);
    }
    model.headerXml = kept.map(sfSerializeXmlNode).join('\n  ');
  } else {
    if (includeTitle && model.workTitle) removedCount++;
    if (model.composer) removedCount++;
  }

  model.composer = '';
  if (includeTitle) model.workTitle = '';
  return removedCount;
}

// ---------- Time Signature Editing & Beat-Count Consensus (#143)
function sfGetEffectiveTimeSig(model, measureIndex) {
  const parts = (model && model.parts) || [];
  const mi = Math.max(0, Math.trunc(Number(measureIndex) || 0));
  for (const p of parts) {
    const m = p.measures && p.measures[mi];
    if (m && m.hasTimeAttr && m.time) {
      return { beats: m.time.beats || 4, beatType: m.time.beatType || 4, explicit: true };
    }
  }
  for (let i = mi - 1; i >= 0; i--) {
    for (const p of parts) {
      const m = p.measures && p.measures[i];
      if (m && m.hasTimeAttr && m.time) {
        return { beats: m.time.beats || 4, beatType: m.time.beatType || 4, explicit: false };
      }
    }
  }
  const firstM = parts[0] && parts[0].measures && parts[0].measures[mi];
  if (firstM && firstM.time) {
    return { beats: firstM.time.beats || 4, beatType: firstM.time.beatType || 4, explicit: false };
  }
  return { beats: 4, beatType: 4, explicit: false };
}

function sfPropagateTimeSigForward(part, startMi, beats, beatType) {
  const measures = (part && part.measures) || [];
  if (startMi < 0 || startMi >= measures.length) return;
  for (let i = startMi; i < measures.length; i++) {
    const m = measures[i];
    if (i > startMi && m.hasTimeAttr) break;
    m.time = { beats, beatType, symbol: null };
    if (i === startMi) m.hasTimeAttr = true;
    sfSyncMeasureBackups(m);
    sfRecalcMeasureOnsets(m);
  }
}

function sfSetMeasureTimeSig(model, measureIndex, beats, beatType, opts) {
  const parts = (model && model.parts) || [];
  if (!parts.length) return false;
  const mi = Math.trunc(Number(measureIndex) || 0);
  if (mi < 0) return false;
  const b = Math.max(1, Math.trunc(Number(beats) || 4));
  const bt = Math.max(1, Math.trunc(Number(beatType) || 4));
  const o = opts || {};

  let maxMeasures = 0;
  for (const p of parts) {
    if (p.measures && p.measures.length > maxMeasures) maxMeasures = p.measures.length;
  }
  if (mi >= maxMeasures) return false;

  if (o.thisBarOnly && mi + 1 < maxMeasures) {
    const prev = sfGetEffectiveTimeSig(model, mi);
    for (const p of parts) {
      const nextM = p.measures && p.measures[mi + 1];
      if (nextM && !nextM.hasTimeAttr) {
        nextM.hasTimeAttr = true;
        sfPropagateTimeSigForward(p, mi + 1, prev.beats, prev.beatType);
      }
    }
  }

  for (const p of parts) {
    if (p.measures && p.measures[mi]) {
      sfPropagateTimeSigForward(p, mi, b, bt);
    }
  }
  return true;
}

function sfRemoveMeasureTimeSig(model, measureIndex) {
  const parts = (model && model.parts) || [];
  const mi = Math.trunc(Number(measureIndex) || 0);
  if (!parts.length || mi <= 0) return false;

  let anyExplicit = false;
  for (const p of parts) {
    const m = p.measures && p.measures[mi];
    if (m && m.hasTimeAttr) {
      anyExplicit = true;
      m.hasTimeAttr = false;
    }
  }
  if (!anyExplicit) return false;

  const prev = sfGetEffectiveTimeSig(model, mi - 1);
  for (const p of parts) {
    const measures = p.measures || [];
    for (let i = mi; i < measures.length; i++) {
      const m = measures[i];
      if (i > mi && m.hasTimeAttr) break;
      m.time = { beats: prev.beats, beatType: prev.beatType, symbol: null };
      sfSyncMeasureBackups(m);
      sfRecalcMeasureOnsets(m);
    }
  }
  return true;
}

function sfBeatTotalToMeter(totalQ, activeBt) {
  const candidates = [
    { q: 1.5, beats: 3, beatType: 8 },
    { q: 2,   beats: 2, beatType: 4 },
    { q: 3,   beats: activeBt === 8 ? 6 : 3, beatType: activeBt === 8 ? 8 : 4 },
    { q: 4,   beats: 4, beatType: 4 },
    { q: 4.5, beats: 9, beatType: 8 },
    { q: 5,   beats: 5, beatType: 4 },
    { q: 6,   beats: 6, beatType: 4 }
  ];
  for (const c of candidates) {
    if (Math.abs(totalQ - c.q) <= 0.02) return { beats: c.beats, beatType: c.beatType };
  }
  return null;
}

function sfMeasureStaffBeatTotals(model, mi) {
  const totals = [];
  for (const part of (model && model.parts) || []) {
    const m = part.measures && part.measures[mi];
    if (!m) continue;
    const numStaves = part.staves || 1;
    for (let st = 1; st <= numStaves; st++) {
      const items = (m.entries || []).filter(e =>
        (e.kind === 'note' || e.kind === 'rest') && !e.isGrace && !e.isChord && (e.staff || 1) === st
      );
      if (!items.length) continue;
      // Pick primary voice on that staff
      const primaryVoice = items[0].voice || '1';
      const vItems = items.filter(e => (e.voice || '1') === primaryVoice);
      const isWholeRest = vItems.length === 1 && vItems[0].isRest && (
        vItems[0].measureRest || (vItems[0].type === 'whole' && !vItems[0].dots)
      );
      if (isWholeRest) continue;
      const sumQ = vItems.reduce((s, e) => s + (e.durationQ || 0), 0);
      if (sumQ > 0.1) totals.push(sumQ);
    }
  }
  return totals;
}

function sfSuggestTimeSigChanges(model) {
  const parts = (model && model.parts) || [];
  if (!parts.length) return [];
  let maxMeasures = 0;
  for (const p of parts) {
    if (p.measures && p.measures.length > maxMeasures) maxMeasures = p.measures.length;
  }

  let totalStaves = 0;
  for (const p of parts) totalStaves += (p.staves || 1);

  const suggestions = [];
  for (let mi = 1; mi < maxMeasures; mi++) {
    const eff = sfGetEffectiveTimeSig(model, mi);
    const activeQ = eff.beats * 4 / eff.beatType;
    const totals = sfMeasureStaffBeatTotals(model, mi);
    if (!totals.length) continue;
    const minNeeded = totalStaves > 1 ? 2 : 1;
    if (totals.length < minNeeded) continue;

    const counts = {};
    for (const tq of totals) {
      const cand = sfBeatTotalToMeter(tq, eff.beatType);
      if (!cand) continue;
      const k = `${cand.beats}/${cand.beatType}`;
      counts[k] = (counts[k] || 0) + 1;
    }

    let bestKey = null, bestCount = 0;
    for (const k of Object.keys(counts)) {
      if (counts[k] > bestCount) { bestCount = counts[k]; bestKey = k; }
    }
    if (!bestKey) continue;
    if (bestCount / totals.length < 0.6) continue;

    const [bStr, btStr] = bestKey.split('/');
    const beats = Number(bStr), beatType = Number(btStr);
    if (beats === eff.beats && beatType === eff.beatType) continue;

    // Determine if thisBarOnly: check if mi+1 matches activeQ
    let thisBarOnly = false;
    if (mi + 1 < maxMeasures) {
      const nextTotals = sfMeasureStaffBeatTotals(model, mi + 1);
      if (nextTotals.length && nextTotals.every(tq => Math.abs(tq - activeQ) <= 0.02)) {
        thisBarOnly = true;
      }
    }

    const mNum = (parts[0] && parts[0].measures[mi] && parts[0].measures[mi].number) || String(mi + 1);
    suggestions.push({
      measureIndex: mi,
      beats,
      beatType,
      thisBarOnly,
      allAgree: bestCount === totals.length && totals.length >= 2,
      label: `Set m. ${mNum} to ${beats}/${beatType}${thisBarOnly ? ' (1 bar)' : ''}`
    });
  }
  return suggestions;
}

function sfAutoInferTimeSigChanges(model) {
  const sugs = sfSuggestTimeSigChanges(model);
  if (!sugs.length) return model;
  model.autoRepairs = model.autoRepairs || [];

  let i = 0;
  while (i < sugs.length) {
    if (!sugs[i].allAgree) { i++; continue; }
    let j = i;
    while (j + 1 < sugs.length &&
           sugs[j + 1].allAgree &&
           sugs[j + 1].measureIndex === sugs[j].measureIndex + 1 &&
           sugs[j + 1].beats === sugs[i].beats &&
           sugs[j + 1].beatType === sugs[i].beatType) {
      j++;
    }
    if (j - i + 1 >= 2) {
      const startMi = sugs[i].measureIndex;
      const b = sugs[i].beats, bt = sugs[i].beatType;
      sfSetMeasureTimeSig(model, startMi, b, bt, { thisBarOnly: false });
      const mNum = (model.parts[0] && model.parts[0].measures[startMi] && model.parts[0].measures[startMi].number) || String(startMi + 1);
      model.autoRepairs.push({
        kind: 'time_signature_infer',
        measureNumber: mNum,
        partName: 'All parts',
        detail: `Inferred ${b}/${bt} across ${j - i + 1} consecutive measures`
      });
    }
    i = j + 1;
  }
  return model;
}

// ---------- Tempo Editor Helpers (#152)
function sfIsTempoEntry(e) {
  if (!e || e.kind !== 'other') return false;
  if (e.tempoBpm > 0) return true;
  if ((e.tag === 'direction' || e.tag === 'sound') && e.rawXml) {
    return /<metronome\b/.test(e.rawXml) || /<sound\b[^>]*\btempo\s*=/.test(e.rawXml);
  }
  return false;
}

function sfExtractTempoFromMeasure(measure) {
  if (!measure || !Array.isArray(measure.entries)) return null;
  for (const e of measure.entries) {
    if (!sfIsTempoEntry(e) || !e.rawXml) continue;
    let el;
    try { el = sfParseXml(e.rawXml); } catch { continue; }
    const metEl = sfXmlFindFirst(el, 'metronome');
    const sndEl = el.tag === 'sound' ? el : sfXmlFindFirst(el, 'sound');
    const wordsEl = e.tag === 'direction' ? sfXmlFindFirst(el, 'words') : null;

    let beatUnit = 'quarter';
    let beatUnitDot = false;
    let bpm = 0;

    if (metEl) {
      const bu = sfXmlChildText(metEl, 'beat-unit').toLowerCase();
      if (bu === 'half' || bu === 'eighth' || bu === 'quarter') beatUnit = bu;
      beatUnitDot = !!sfXmlChild(metEl, 'beat-unit-dot');
      const pm = Number(sfXmlChildText(metEl, 'per-minute'));
      if (isFinite(pm) && pm > 0) bpm = Math.round(pm);
    }
    if (bpm <= 0 && sndEl) {
      const st = Number(sndEl.attrs.tempo);
      if (isFinite(st) && st > 0) bpm = Math.round(st);
    }
    if (bpm > 0) {
      return {
        bpm,
        beatUnit,
        beatUnitDot,
        label: wordsEl ? sfXmlText(wordsEl).trim() : ''
      };
    }
  }
  return null;
}

function sfGetMeasureTempo(model, measureIndex) {
  const part0 = model && model.parts && model.parts[0];
  const measures = (part0 && part0.measures) || [];
  const mi = Math.max(0, Math.min(measures.length - 1, Math.trunc(Number(measureIndex) || 0)));
  if (!measures.length) {
    return { bpm: 100, beatUnit: 'quarter', beatUnitDot: false, label: '', explicit: false };
  }

  const atCur = sfExtractTempoFromMeasure(measures[mi]);
  if (atCur) {
    return Object.assign({}, atCur, { explicit: true });
  }
  for (let i = mi - 1; i >= 0; i--) {
    const prev = sfExtractTempoFromMeasure(measures[i]);
    if (prev) {
      return Object.assign({}, prev, { explicit: false });
    }
  }
  return { bpm: 100, beatUnit: 'quarter', beatUnitDot: false, label: '', explicit: false };
}

function sfRemoveMeasureTempo(model, measureIndex) {
  const parts = (model && model.parts) || [];
  const mi = Math.trunc(Number(measureIndex) || 0);
  if (!parts.length || mi < 0) return false;
  let removed = false;
  for (const p of parts) {
    const m = p.measures && p.measures[mi];
    if (!m || !Array.isArray(m.entries)) continue;
    const before = m.entries.length;
    m.entries = m.entries.filter(e => !sfIsTempoEntry(e));
    if (m.entries.length !== before) {
      removed = true;
      sfRecalcMeasureOnsets(m);
    }
  }
  return removed;
}

function sfSetMeasureTempo(model, measureIndex, bpm, opts) {
  const parts = (model && model.parts) || [];
  const mi = Math.trunc(Number(measureIndex) || 0);
  if (!parts.length || !parts[0].measures || mi < 0 || mi >= parts[0].measures.length) return false;

  const o = opts || {};
  const clampedBpm = Math.max(20, Math.min(300, Math.round(Number(bpm) || 100)));
  const beatUnit = (o.beatUnit === 'half' || o.beatUnit === 'eighth') ? o.beatUnit : 'quarter';
  const beatUnitDot = !!o.beatUnitDot;
  const label = String(o.label == null ? '' : o.label).trim();

  const baseMult = beatUnit === 'half' ? 2 : (beatUnit === 'eighth' ? 0.5 : 1);
  const mult = baseMult * (beatUnitDot ? 1.5 : 1);
  const quarterBpm = Math.round(clampedBpm * mult * 100) / 100;

  sfRemoveMeasureTempo(model, mi);

  const labelXml = label
    ? `<direction-type><words font-weight="bold">${sfXmlEscape(label)}</words></direction-type>`
    : '';
  const dotXml = beatUnitDot ? '<beat-unit-dot/>' : '';
  const rawXml = `<direction placement="above">${labelXml}<direction-type><metronome><beat-unit>${beatUnit}</beat-unit>${dotXml}<per-minute>${clampedBpm}</per-minute></metronome></direction-type><sound tempo="${quarterBpm}"/></direction>`;

  const m0 = parts[0].measures[mi];
  const insertIdx = m0.entries.findIndex(e => !e.isAttributesSlot);
  const dirEntry = {
    id: sfNextEntryId(0, mi, m0),
    kind: 'other',
    partIndex: 0,
    measureIndex: mi,
    tag: 'direction',
    rawXml,
    markingKind: 'tempo',
    markingValue: label || String(clampedBpm),
    tempoBpm: quarterBpm,
    onsetQ: 0
  };
  m0.entries.splice(insertIdx >= 0 ? insertIdx : m0.entries.length, 0, dirEntry);
  sfRecalcMeasureOnsets(m0);
  return true;
}

// ---------- Key Signature Editor Helpers (#154)
function sfGetEffectiveKeySig(model, measureIndex) {
  const parts = (model && model.parts) || [];
  const mi = Math.max(0, Math.trunc(Number(measureIndex) || 0));
  const order = parts.length ? [parts[0], ...parts.slice(1)] : [];

  for (const p of order) {
    const m = p.measures && p.measures[mi];
    if (m && m.hasKeyAttr && m.key) {
      return { fifths: m.key.fifths || 0, mode: m.key.mode || 'major', explicit: true };
    }
  }
  for (let i = mi - 1; i >= 0; i--) {
    for (const p of order) {
      const m = p.measures && p.measures[i];
      if (m && m.hasKeyAttr && m.key) {
        return { fifths: m.key.fifths || 0, mode: m.key.mode || 'major', explicit: false };
      }
    }
  }
  const firstM = parts[0] && parts[0].measures && parts[0].measures[mi];
  if (firstM && firstM.key) {
    return { fifths: firstM.key.fifths || 0, mode: firstM.key.mode || 'major', explicit: false };
  }
  return { fifths: 0, mode: 'major', explicit: false };
}

function sfSetMeasureKeySig(model, measureIndex, fifths, opts) {
  const parts = (model && model.parts) || [];
  const mi = Math.trunc(Number(measureIndex) || 0);
  if (!parts.length || mi < 0) return false;
  let maxMeasures = 0;
  for (const p of parts) {
    if (p.measures && p.measures.length > maxMeasures) maxMeasures = p.measures.length;
  }
  if (mi >= maxMeasures) return false;

  const o = opts || {};
  const clampedFifths = Math.max(-7, Math.min(7, Math.round(Number(fifths) || 0)));
  const mode = o.mode || 'major';
  const modeGiven = !!o.mode;
  const oldFifths = sfGetEffectiveKeySig(model, mi).fifths;
  const updatePitches = o.updateUnmarkedPitches !== false && oldFifths !== clampedFifths;

  for (const p of parts) {
    const measures = p.measures || [];
    if (!measures[mi]) continue;
    const trSemis = sfTransposeSemis(p.transpose);
    for (let i = mi; i < measures.length; i++) {
      const m = measures[i];
      if (i > mi && m.hasKeyAttr) break;
      m.key = { fifths: clampedFifths, mode, modeGiven };
      if (i === mi) m.hasKeyAttr = true;

      if (updatePitches) {
        const mTrSemis = m.activeTranspose ? sfTransposeSemis(m.activeTranspose) : trSemis;
        for (const e of m.entries || []) {
          if (e.kind !== 'note' || e.isRest || e.spoken || !e.step || !isFinite(e.octave)) continue;
          if (!e.accidental && (e.alter || 0) === sfKeyAlterForStep(oldFifths, e.step)) {
            e.alter = sfKeyAlterForStep(clampedFifths, e.step);
            e.midi = sfPitchToMidi(e.step, e.octave, e.alter);
            e.soundingMidi = e.midi !== null ? e.midi + mTrSemis : null;
          }
        }
      }
    }
  }
  return true;
}

function sfRemoveMeasureKeySig(model, measureIndex) {
  const parts = (model && model.parts) || [];
  const mi = Math.trunc(Number(measureIndex) || 0);
  if (!parts.length || mi <= 0) return false;

  let anyExplicit = false;
  for (const p of parts) {
    const m = p.measures && p.measures[mi];
    if (m && m.hasKeyAttr) {
      anyExplicit = true;
      m.hasKeyAttr = false;
    }
  }
  if (!anyExplicit) return false;

  const prev = sfGetEffectiveKeySig(model, mi - 1);
  for (const p of parts) {
    const measures = p.measures || [];
    for (let i = mi; i < measures.length; i++) {
      const m = measures[i];
      if (i > mi && m.hasKeyAttr) break;
      m.key = { fifths: prev.fifths, mode: prev.mode, modeGiven: false };
    }
  }
  return true;
}

// ---------- Dedupe Doubled Identical Chord Heads
function sfDedupeChordNotes(model) {
  if (!model || !Array.isArray(model.parts)) return 0;
  let removed = 0;
  for (let pi = 0; pi < model.parts.length; pi++) {
    const part = model.parts[pi];
    for (let mi = 0; mi < (part.measures || []).length; mi++) {
      const m = part.measures[mi];
      if (!m || !Array.isArray(m.entries) || !m.entries.length) continue;
      const seen = new Set();
      const kept = [];
      let changed = false;
      for (const e of m.entries) {
        if (e.kind === 'note' && !e.isRest && !e.isGrace && e.step && isFinite(e.octave)) {
          const onsetKey = isFinite(e.onsetQ) ? Math.round(e.onsetQ * 1000) : 0;
          const key = `${e.staff || 1}:${e.voice || '1'}:${onsetKey}:${e.step}:${e.octave}:${e.alter || 0}`;
          if (e.isChord && seen.has(key)) {
            removed++;
            changed = true;
            continue;
          }
          seen.add(key);
        }
        kept.push(e);
      }
      if (changed) {
        m.entries = kept;
      }
    }
  }
  model.dedupedChords = removed;
  return removed;
}

if (typeof window !== 'undefined') {
  window.sfDedupeChordNotes = sfDedupeChordNotes;
}

// ---------- Deterministic Missing-Dot Auto-Repair
function sfSameMeasureDottedOnsets(model, mi, partIndex, staff, targetQ) {
  const onsets = new Set();
  const parts = (model && model.parts) || [];
  for (let pi = 0; pi < parts.length; pi++) {
    const m = parts[pi] && parts[pi].measures && parts[pi].measures[mi];
    if (!m) continue;
    for (const e of m.entries || []) {
      if (e.kind !== 'note' || e.isRest || e.isChord || e.isGrace) continue;
      if (pi === partIndex && String(e.staff || 1) === String(staff)) continue;
      if ((e.dots || 0) > 0 && Math.abs((e.durationQ || 0) - targetQ) < 0.01 && isFinite(e.onsetQ)) {
        onsets.add(Math.round(e.onsetQ * 1000));
      }
    }
  }
  return onsets;
}

function sfApplyDotToAnchor(measure, anchorObj) {
  const targets = [anchorObj.anchor].concat(anchorObj.chords || []);
  const needsDouble = targets.some(e => isFinite(e.durationDivs) && (Math.round(e.durationDivs) % 2 !== 0));
  if (needsDouble) {
    measure.divisions = (measure.divisions || 1) * 2;
    for (const e of measure.entries || []) {
      if (isFinite(e.durationDivs)) {
        e.durationDivs = Math.round(e.durationDivs) * 2;
      }
    }
  }
  const divs = measure.divisions || 1;
  for (const e of targets) {
    e.dots = (e.dots || 0) + 1;
    if (isFinite(e.durationDivs)) {
      e.durationDivs = Math.round(e.durationDivs * 1.5);
      e.durationQ = e.durationDivs / divs;
    } else if (isFinite(e.durationQ)) {
      e.durationQ = e.durationQ * 1.5;
    }
  }
}

function sfAutoFixMissingDots(model) {
  if (!model || !Array.isArray(model.parts)) return 0;
  model.autoRepairs = model.autoRepairs || [];
  let totalFixed = 0;

  for (let pi = 0; pi < model.parts.length; pi++) {
    const part = model.parts[pi];
    const measures = part.measures || [];
    for (let mi = 0; mi < measures.length; mi++) {
      const m = measures[mi];
      if (!m || mi === 0 || m.implicit || String(m.number) === '0') continue;
      const beats = (m.time && m.time.beats) || 4;
      const bt = (m.time && m.time.beatType) || 4;
      const expectedQ = beats * 4 / bt;

      // Group non-grace entries per (staff, voice)
      const voiceGroups = {};
      for (const e of m.entries || []) {
        if (e.isGrace) continue;
        if (e.kind !== 'note' && e.kind !== 'rest' && e.kind !== 'forward') continue;
        const st = e.staff || 1;
        const v = e.voice || '1';
        const key = `${st}:${v}`;
        (voiceGroups[key] || (voiceGroups[key] = { staff: st, voice: v, entries: [] })).entries.push(e);
      }

      let measureFixed = 0;
      for (const gk of Object.keys(voiceGroups)) {
        const g = voiceGroups[gk];
        if (g.entries.some(e => e.kind === 'forward' || e.timeModification)) continue;

        const anchors = [];
        for (const e of g.entries) {
          if (e.kind === 'note' && e.isChord) {
            if (anchors.length) anchors[anchors.length - 1].chords.push(e);
          } else {
            anchors.push({ anchor: e, chords: [] });
          }
        }
        if (!anchors.length) continue;
        if (anchors.length === 1 && (anchors[0].anchor.measureRest || (anchors[0].anchor.kind === 'rest' && anchors[0].anchor.type === 'whole'))) {
          continue;
        }

        const sumQ = anchors.reduce((acc, x) => acc + (x.anchor.durationQ || 0), 0);
        const deficit = expectedQ - sumQ;
        if (deficit <= 0.01) continue;

        let chosen = [];

        // Rule A: Single missing dot (deficit near 0.25, 0.5, 1.0, or 2.0)
        const singleDeficits = [0.25, 0.5, 1.0, 2.0];
        const matchedDef = singleDeficits.find(d => Math.abs(deficit - d) < 0.01);
        if (matchedDef != null) {
          const baseQ = matchedDef * 2;
          const candidates = anchors.filter(x =>
            x.anchor.kind === 'note' && !x.anchor.isRest && !(x.anchor.dots > 0) &&
            Math.abs((x.anchor.durationQ || 0) - baseQ) < 0.01
          );
          if (candidates.length === 1) {
            chosen = candidates;
          } else if (candidates.length > 1 && (baseQ === 1.0 || baseQ === 0.5)) {
            const halfFollow = candidates.filter(c => {
              const idx = anchors.indexOf(c);
              const nxt = anchors[idx + 1];
              return nxt && Math.abs((nxt.anchor.durationQ || 0) - baseQ / 2) < 0.01;
            });
            if (halfFollow.length === 1) {
              chosen = halfFollow;
            } else {
              const dottedOnsets = sfSameMeasureDottedOnsets(model, mi, pi, g.staff, baseQ * 1.5);
              const onsetMatches = candidates.filter(c => isFinite(c.anchor.onsetQ) && dottedOnsets.has(Math.round(c.anchor.onsetQ * 1000)));
              if (onsetMatches.length === 1) chosen = onsetMatches;
            }
          }
        }

        // Rule B: Paired missing dots & compound meter
        if (!chosen.length && Math.abs(deficit - 1.0) < 0.01) {
          const pairs = anchors.filter((x, idx) => {
            if (x.anchor.kind !== 'note' || x.anchor.isRest || (x.anchor.dots > 0)) return false;
            if (Math.abs((x.anchor.durationQ || 0) - 1.0) >= 0.01) return false;
            const nxt = anchors[idx + 1];
            return nxt && Math.abs((nxt.anchor.durationQ || 0) - 0.5) < 0.01;
          });
          if (pairs.length === 2) chosen = pairs;
        }
        if (!chosen.length && Math.abs(deficit - 0.5) < 0.01) {
          const pairs = anchors.filter((x, idx) => {
            if (x.anchor.kind !== 'note' || x.anchor.isRest || (x.anchor.dots > 0)) return false;
            if (Math.abs((x.anchor.durationQ || 0) - 0.5) >= 0.01) return false;
            const nxt = anchors[idx + 1];
            return nxt && Math.abs((nxt.anchor.durationQ || 0) - 0.25) < 0.01;
          });
          if (pairs.length === 2) chosen = pairs;
        }
        if (!chosen.length && bt === 8 && beats % 3 === 0) {
          const k = beats / 3;
          if (Math.abs(k * 0.5 - deficit) < 0.01) {
            const cands = anchors.filter(x =>
              x.anchor.kind === 'note' && !x.anchor.isRest && !(x.anchor.dots > 0) &&
              Math.abs((x.anchor.durationQ || 0) - 1.0) < 0.01
            );
            if (cands.length === k) chosen = cands;
          }
        }

        if (chosen.length) {
          for (const c of chosen) {
            sfApplyDotToAnchor(m, c);
            measureFixed++;
            totalFixed++;
          }
        }
      }

      if (measureFixed > 0) {
        sfRecalcMeasureOnsets(m);
        sfSyncMeasureBackups(m);
        model.autoRepairs.push({
          kind: 'missing_dot',
          measureNumber: m.number || String(mi + 1),
          partName: part.name || ('Part ' + (pi + 1)),
          detail: `Added ${measureFixed} missing augmentation dot${measureFixed > 1 ? 's' : ''}`
        });
      }
    }
  }

  model.autoFixedDots = totalFixed;
  return totalFixed;
}

// ---------- Measure Bounding-Box Extractor (Normalized [0..1] Page Coords)
function sfLayoutFloat(parent, tag, fallback) {
  const ch = sfXmlChild(parent, tag);
  if (!ch) return fallback;
  const txt = sfXmlText(ch).trim();
  if (!txt) return fallback;
  const val = Number(txt);
  return isFinite(val) ? val : fallback;
}

function sfExtractMeasureBoxes(xmlString) {
  if (!xmlString || typeof xmlString !== 'string') return [];
  let root;
  try {
    root = sfParseXml(xmlString);
  } catch {
    return [];
  }
  if (!root || root.tag !== 'score-partwise') return [];

  let pageW = 1860.0;
  let pageH = 2359.0;
  let leftMargin = 80.0;
  let topMargin = 80.0;
  const defaults = sfXmlChild(root, 'defaults');
  if (defaults) {
    const pl = sfXmlChild(defaults, 'page-layout');
    if (pl) {
      pageW = sfLayoutFloat(pl, 'page-width', pageW);
      pageH = sfLayoutFloat(pl, 'page-height', pageH);
      const pm = sfXmlChild(pl, 'page-margins');
      if (pm) {
        leftMargin = sfLayoutFloat(pm, 'left-margin', leftMargin);
        topMargin = sfLayoutFloat(pm, 'top-margin', topMargin);
      }
    }
  }

  const parts = sfXmlChildren(root, 'part');
  if (!parts.length) return [];
  const partMeasures = parts.map(p => sfXmlChildren(p, 'measure'));
  const maxMeasures = partMeasures.reduce((mx, ms) => Math.max(mx, ms.length), 0);

  const partStaves = parts.map(() => 1);
  const staffDists = {};
  let sysLeftMargin = 0.0;
  let page = 0;
  let yTop = topMargin;
  let prevSysBottom = topMargin;
  let xCursor = leftMargin;
  const boxes = [];

  for (let mi = 0; mi < maxMeasures; mi++) {
    const mP0 = mi < partMeasures[0].length ? partMeasures[0][mi] : null;
    if (!mP0) continue;

    for (let pi = 0; pi < partMeasures.length; pi++) {
      const ms = partMeasures[pi];
      if (mi >= ms.length) continue;
      const mEl = ms[mi];
      const attrEl = sfXmlChild(mEl, 'attributes');
      if (attrEl) {
        const stTxt = sfXmlChildText(attrEl, 'staves');
        if (stTxt && /^\d+$/.test(stTxt)) {
          partStaves[pi] = Math.max(1, parseInt(stTxt, 10));
        }
      }
      const prEl = sfXmlChild(mEl, 'print');
      if (prEl) {
        for (const sl of sfXmlChildren(prEl, 'staff-layout')) {
          const sNum = parseInt(sl.attrs.number || '1', 10) || 1;
          const sd = sfLayoutFloat(sl, 'staff-distance', NaN);
          if (isFinite(sd)) {
            staffDists[`${pi}:${sNum}`] = sd;
          }
        }
      }
    }

    const pr = sfXmlChild(mP0, 'print');
    const isNewPage = (mi === 0) || !!(pr && pr.attrs['new-page'] === 'yes');
    const isNewSys = isNewPage || !!(pr && pr.attrs['new-system'] === 'yes');

    if (isNewSys) {
      if (pr) {
        const sl = sfXmlChild(pr, 'system-layout');
        if (sl) {
          const sm = sfXmlChild(sl, 'system-margins');
          if (sm) {
            sysLeftMargin = sfLayoutFloat(sm, 'left-margin', sysLeftMargin);
          }
          if (isNewPage) {
            page += 1;
            const topDist = sfLayoutFloat(sl, 'top-system-distance', 200.0);
            yTop = topMargin + topDist;
          } else {
            const sysDist = sfLayoutFloat(sl, 'system-distance', 360.0);
            yTop = prevSysBottom + sysDist;
          }
        } else if (isNewPage) {
          page += 1;
          yTop = topMargin + 200.0;
        }
      } else if (isNewPage) {
        page += 1;
        yTop = topMargin + 200.0;
      }

      let sysHeight = 0.0;
      for (let pi = 0; pi < parts.length; pi++) {
        for (let sNum = 1; sNum <= partStaves[pi]; sNum++) {
          if (pi === 0 && sNum === 1) {
            sysHeight += 40.0;
          } else {
            const key = `${pi}:${sNum}`;
            const dist = Object.prototype.hasOwnProperty.call(staffDists, key)
              ? staffDists[key]
              : (sNum === 1 ? 90.0 : 65.0);
            sysHeight += dist + 40.0;
          }
        }
      }
      prevSysBottom = yTop + sysHeight;
      xCursor = leftMargin + sysLeftMargin;
    }

    const rawW = Number(mP0.attrs.width);
    const measW = (isFinite(rawW) && rawW > 0) ? rawW : 240.0;
    const measNum = String(mP0.attrs.number || (mi + 1));

    const padX = 36.0;
    const padTop = 85.0;
    const padBot = 115.0;
    const bx = Math.max(0.0, xCursor - padX);
    const bw = Math.min(pageW - bx, measW + 2 * padX);
    const by = Math.max(0.0, yTop - padTop);
    const bh = Math.min(pageH - by, (prevSysBottom - yTop) + padTop + padBot);

    const round5 = v => Math.round(v * 100000) / 100000;
    boxes.push({
      measure: measNum,
      index: mi,
      page: Math.max(1, page),
      x: round5(bx / pageW),
      y: round5(by / pageH),
      w: round5(bw / pageW),
      h: round5(bh / pageH)
    });
    xCursor += measW;
  }

  return boxes;
}

if (typeof window !== 'undefined') {
  window.sfAutoFixMissingDots = sfAutoFixMissingDots;
  window.sfExtractMeasureBoxes = sfExtractMeasureBoxes;
}
