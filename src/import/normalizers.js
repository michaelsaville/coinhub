// Shared normalizer maps used by BOTH the CLI script (scripts/import.js)
// and the web import wizard (src/server.js). When you discover a new
// freeform value worth mapping, edit it HERE and both consumers pick it
// up — no copy-paste between files.

export const MINT_MAP = {
  '': 'P',
  ' ': 'P',
  'p': 'P',
  'P': 'P',
  'd': 'D',
  'D': 'D',
  's': 'S',
  'S': 'S',
  'w': 'W',
  'W': 'W',
  'cc': 'CC',
  'CC': 'CC',
  'o': 'O',
  'O': 'O',
  // Special markers in source — not real mint marks
  'VDB': 'P',     // 1909 VDB designer initial, Philadelphia
  'SET': 'P',     // marks a multi-coin product; canonical anchor = P
  'D & P': 'P',   // mint set containing both; anchor = P
  '9': 'P',       // likely a data-entry slip
};

// Freeform → canonical grade. Unknown values fall through to 'UNG' and
// get reported up so callers can flag/fix them.
export const CONDITION_MAP = {
  'poor': 'PO-1',
  'fair': 'FR-2',
  'about good': 'AG-3',
  'ag': 'AG-3',
  'good': 'G-4',
  'g': 'G-4',
  'very good': 'VG-8',
  'vg': 'VG-8',
  'fine': 'F-12',
  'f': 'F-12',
  'very fine': 'VF-20',
  'vf': 'VF-20',
  'extremely fine': 'XF-40',
  'extra fine': 'XF-40',
  'xf': 'XF-40',
  'ef': 'XF-40',
  'about uncirculated': 'AU-50',
  'au': 'AU-50',
  'uncirculated': 'MS-60',
  'unciculated': 'MS-60', // typo seen in source
  'unc': 'MS-60',
  'mint state': 'MS-63',
  'ms': 'MS-63',
  'select uncirculated': 'MS-63',
  'choice uncirculated': 'MS-64',
  'gem uncirculated': 'MS-65',
  'gem': 'MS-65',
  'superb gem': 'MS-67',
  'brilliant uncirculated': 'MS-63',
  'brilliant unciculated': 'MS-63', // typo seen in source
  'bu': 'MS-63',
  'proof': 'PR-65',
  'pr': 'PR-65',
  'pf': 'PR-65',
  'ungraded': 'UNG',
  '': 'UNG',
};

export const SERIES_MAP = {
  'indian head penny': 'Indian Head Penny',
  'indian head cent': 'Indian Head Penny',
  'lincoln cent': 'Lincoln Cent',
  'lincoln penny': 'Lincoln Cent',
  'lincoln wheat cent': 'Lincoln Cent',
  'lincoln memorial cent': 'Lincoln Cent',
  'wheat penny': 'Lincoln Cent',
  'memorial penny': 'Lincoln Cent',
  'memorial penny proof': 'Lincoln Cent',
  'shield penny': 'Lincoln Cent',
  'shield penny proof': 'Lincoln Cent',
  'shield penny roll': 'Lincoln Cent',
  'steel penny': 'Lincoln Cent',
  'bicentennial penny': 'Lincoln Cent',
  'jefferson nickel proof': 'Jefferson Nickel',
  'kennedy half dollar proof': 'Kennedy Half',
  'morgan dollar proof': 'Morgan Dollar',
  'peace dollar proof': 'Peace Dollar',
  'american eagle unc': 'Silver Eagle Dollar',
  'american eagle proof': 'Silver Eagle Dollar',
  'standing liberty half': 'Walking Liberty Half',
  'susan b anthony': 'Susan B. Anthony Dollar',
  'susan b anthony souvenir set': 'Susan B. Anthony Dollar',
  'jefferson nickel peace medal': 'Jefferson Nickel',
  'jefferson nickel peace medal proof': 'Jefferson Nickel',
  'jefferson nickel keelboat': 'Jefferson Nickel',
  'jefferson nickel keelboat proof': 'Jefferson Nickel',
  'jefferson nickel bison proof': 'Jefferson Nickel',
  'jefferson nickel roll ocean in view': 'Jefferson Nickel',
  'presidential dollar george washington': 'Presidential Dollar',
  'presidential dollar john tyler': 'Presidential Dollar',
  'presidential dollar james garfield': 'Presidential Dollar',
  'presidential dollar ulysses s. grant': 'Presidential Dollar',
  'eisenhower dollar variety i*': 'Eisenhower Dollar',
  'flying eagle cent': 'Flying Eagle Cent',
  'flying eagle': 'Flying Eagle Cent',
  'liberty v nickel': 'Liberty V Nickel',
  'liberty nickel': 'Liberty V Nickel',
  'v nickel': 'Liberty V Nickel',
  'buffalo nickel': 'Buffalo Nickel',
  'jefferson nickel': 'Jefferson Nickel',
  'shield nickel': 'Shield Nickel',
  'mercury dime': 'Mercury Dime',
  'murcury dime': 'Mercury Dime',
  'roosevelt dime': 'Roosevelt Dime',
  'barber dime': 'Barber Dime',
  'washington quarter': 'Washington Quarter',
  'washinton quarter': 'Washington Quarter',
  'barber quarter': 'Barber Quarter',
  'standing liberty quarter': 'Standing Liberty Quarter',
  'walking liberty half': 'Walking Liberty Half',
  'walking liberty half dollar': 'Walking Liberty Half',
  'franklin half': 'Franklin Half',
  'franklin half dollar': 'Franklin Half',
  'kennedy half': 'Kennedy Half',
  'kennedy half dollar': 'Kennedy Half',
  'liberty halp dollar': 'Walking Liberty Half',
  'barber half': 'Barber Half',
  'morgan dollar': 'Morgan Dollar',
  'morgan doller': 'Morgan Dollar',
  'peace dollar': 'Peace Dollar',
  'eisenhower dollar': 'Eisenhower Dollar',
  'ike dollar': 'Eisenhower Dollar',
  'susan b. anthony dollar': 'Susan B. Anthony Dollar',
  'susan b anthony dollar': 'Susan B. Anthony Dollar',
  'sba dollar': 'Susan B. Anthony Dollar',
  'sacagawea dollar': 'Sacagawea Dollar',
  'presidential dollar': 'Presidential Dollar',
  'silver eagle dollar': 'Silver Eagle Dollar',
  'silver eagle': 'Silver Eagle Dollar',
  'eagle dollar': 'Silver Eagle Dollar',
  'american eagle': 'Silver Eagle Dollar',
  'trade dollar': 'Trade Dollar',
  'seated liberty dollar': 'Seated Liberty Dollar',
};

export const SERIES_PREFIX_MAP = [
  ['presidential dollar ', 'Presidential Dollar'],
  ['jefferson nickel ', 'Jefferson Nickel'],
  ['kennedy half dollar', 'Kennedy Half'],
];

export const SERIES_KEYWORDS = [
  [/mint set|proof set|uncirculated set|over the years set|collector set|president set|state quarter set/i, 'Mint Set'],
  [/tube|roll\b|penney book|quarters book/i, 'Bulk Lot'],
  [/commem|constitution|uso silver|mt rushmore|stormin|desert storm|heros of|liberty silver dollar|first day cover/i, 'Commemorative'],
];

export const SERIAL_PREFIX_TO_SERIES = {
  'IND': 'Indian Head Penny',
  'WHT': 'Lincoln Cent',
  'SLD': 'Lincoln Cent',
  'MEM': 'Lincoln Cent',
  'LIB': 'Liberty V Nickel',
  'BUF': 'Buffalo Nickel',
  'JEF': 'Jefferson Nickel',
  'MRC': 'Mercury Dime',
  'ROO': 'Roosevelt Dime',
  'WAS': 'Washington Quarter',
  'WAL': 'Walking Liberty Half',
  'FRA': 'Franklin Half',
  'KEN': 'Kennedy Half',
  'MOR': 'Morgan Dollar',
  'PEA': 'Peace Dollar',
  'EIS': 'Eisenhower Dollar',
  'SBA': 'Susan B. Anthony Dollar',
  'SAC': 'Sacagawea Dollar',
  'PRE': 'Presidential Dollar',
  'AEU': 'Silver Eagle Dollar',
};

export const FOREIGN_KEYWORDS = [
  [/canad/i, 'CA'],
  [/marshaa?l/i, 'MH'],
  [/korea/i, 'KR'],
  [/mexic/i, 'MX'],
  [/british|great britain|uk\b/i, 'GB'],
  [/olympic/i, 'XX'],
];

// Maps direct sheldon-grade values like 'MS-63', 'AU-55', 'F-12 Fine'.
// Accepts trailing descriptive text after the grade.
export function tryDirectGrade(value) {
  const raw = String(value).trim().toUpperCase();
  const m = raw.match(/^(MS|AU|XF|EF|VF|F|VG|G|AG|FR|PO|PR|PF)-?(\d{1,2})\b/);
  if (!m) return null;
  const prefix = m[1].replace(/^EF$/, 'XF').replace(/^PF$/, 'PR');
  return `${prefix}-${m[2]}`;
}

export function normalizeMint(raw) {
  if (raw === null || raw === undefined) return 'P';
  const key = String(raw).trim();
  if (MINT_MAP[key] !== undefined) return MINT_MAP[key];
  return null;
}

export function normalizeCondition(raw) {
  if (raw === null || raw === undefined) return 'UNG';
  const direct = tryDirectGrade(raw);
  if (direct) return direct;
  const key = String(raw).trim().toLowerCase();
  if (CONDITION_MAP[key] !== undefined) return CONDITION_MAP[key];
  return null;
}

export function normalizeSeries(desc, serial) {
  const key = desc ? String(desc).trim().toLowerCase().replace(/\s+/g, ' ') : '';
  if (key) {
    if (SERIES_MAP[key]) return SERIES_MAP[key];
    for (const [prefix, series] of SERIES_PREFIX_MAP) {
      if (key.startsWith(prefix)) return series;
    }
    for (const [re, series] of SERIES_KEYWORDS) {
      if (re.test(key)) return series;
    }
  }
  if (serial) {
    const m = String(serial).match(/^([A-Z]{3})/);
    if (m && SERIAL_PREFIX_TO_SERIES[m[1]]) return SERIAL_PREFIX_TO_SERIES[m[1]];
  }
  return null;
}

export function detectCountry(desc) {
  if (!desc) return 'US';
  for (const [re, code] of FOREIGN_KEYWORDS) if (re.test(desc)) return code;
  return 'US';
}

export function normalizeYear(raw) {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (Number.isFinite(n) && n >= 1700 && n <= 2100) return n;
  return null;
}

export function normalizeDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  // Already a Date (xlsx with cellDates: true)
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }
  // xlsx serial number — only when raw is in plausible Excel-date range
  if (typeof raw === 'number' && raw > 25_569 && raw < 80_000) {
    const d = new Date((raw - 25_569) * 86_400_000);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  // String — let Date parse it
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function normalizePrice(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  // Strip $, commas, whitespace.
  const cleaned = String(raw).replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ─── Web wizard helpers ─────────────────────────────────────────────────
//
// The CLI script knows the exact source headers (Serial, Date, Mint, …)
// because it points at one fixed workbook. The web wizard accepts
// arbitrary headers, so we need (a) header-name auto-detection and
// (b) a target field registry the user maps each column onto.

/** The target fields a user can map their columns onto. */
export const TARGET_FIELDS = [
  { key: 'serial',        label: 'Serial (unique key)', required: true },
  { key: 'year',          label: 'Year',                required: true },
  { key: 'mint',          label: 'Mint',                required: false },
  { key: 'desc',          label: 'Description / Series', required: false },
  { key: 'condition',     label: 'Condition / Grade',   required: false },
  { key: 'paid',          label: 'Price paid',          required: false },
  { key: 'book',          label: 'Book value',          required: false },
  { key: 'qty',           label: 'Quantity',            required: false },
  { key: 'acquired_date', label: 'Acquired date',       required: false },
  { key: 'source',        label: 'Source / dealer',     required: false },
  { key: 'comment_1',     label: 'Comment 1',           required: false },
  { key: 'comment_2',     label: 'Comment 2',           required: false },
  { key: 'photo',         label: 'Photo filename',      required: false },
];

/** Header-name candidates per target field, all lowercased + symbols stripped. */
const HEADER_HINTS = {
  serial:        ['serial', 'serialid', 'id', 'cert', 'certificate', 'slab'],
  year:          ['year', 'date', 'minted', 'mintyear'],
  mint:          ['mint', 'mintmark', 'mm'],
  desc:          ['desc', 'description', 'series', 'type', 'denomination'],
  condition:     ['condition', 'grade', 'cond', 'sheldon'],
  paid:          ['paid', 'price', 'cost', 'purchaseprice', 'amount', 'pricepaid'],
  book:          ['book', 'bookvalue', 'value', 'fmv', 'marketvalue', 'market'],
  qty:           ['qty', 'quantity', 'count', 'pieces'],
  acquired_date: ['acquired', 'acquireddate', 'purchasedate', 'datepurchased', 'datebought', 'purchased'],
  source:        ['source', 'dealer', 'vendor', 'seller', 'where', 'broker'],
  comment_1:     ['comment', 'comment1', 'note', 'notes', 'remarks'],
  comment_2:     ['comment2', 'note2', 'notes2'],
  photo:         ['photo', 'image', 'picture', 'photofile', 'imagefile'],
};

function normalizeHeader(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Auto-detect the best target field for each header. Returns
 * `{ [header]: targetKey | null }`. Each target is matched at most once
 * — first header wins, others stay unmapped so the user can override.
 */
export function autoDetectMapping(headers) {
  const used = new Set();
  const out = {};
  for (const header of headers) {
    const norm = normalizeHeader(header);
    let chosen = null;
    for (const [target, hints] of Object.entries(HEADER_HINTS)) {
      if (used.has(target)) continue;
      if (hints.includes(norm)) {
        chosen = target;
        break;
      }
      // Also try "contains" — handy for "Date Purchased", "Slab Serial", etc.
      if (hints.some((h) => norm.includes(h))) {
        chosen = target;
        break;
      }
    }
    if (chosen) used.add(chosen);
    out[header] = chosen;
  }
  return out;
}

/**
 * Apply a column mapping to a raw row + run all field normalizers.
 * Returns { normalized, issues[] }. `normalized` is a flat object
 * keyed by target-field name so the commit step can use it directly.
 */
export function projectRow(row, mapping) {
  const normalized = {};
  const issues = [];

  // Reverse the mapping → { targetKey: header } so we can look up by target.
  const targetToHeader = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (target) targetToHeader[target] = header;
  }
  const get = (target) => {
    const h = targetToHeader[target];
    return h ? row[h] : null;
  };

  const serial = get('serial');
  normalized.serial = serial != null && serial !== ''
    ? String(serial).trim()
    : null;
  if (!normalized.serial) issues.push('missing serial');

  normalized.year = normalizeYear(get('year'));
  if (!normalized.year) issues.push(`invalid year: ${JSON.stringify(get('year'))}`);

  normalized.mint = normalizeMint(get('mint'));
  if (normalized.mint === null) {
    issues.push(`unknown mint: ${JSON.stringify(get('mint'))}`);
  }

  const condRaw = get('condition');
  normalized.condition = normalizeCondition(condRaw);
  if (normalized.condition === null) {
    issues.push(`unknown condition: ${JSON.stringify(condRaw)}`);
  }

  const desc = get('desc');
  normalized.desc = desc != null && desc !== '' ? String(desc).trim() : null;
  normalized.series = normalizeSeries(normalized.desc, normalized.serial);
  normalized.country = detectCountry(normalized.desc);
  if (normalized.country === 'US' && !normalized.series) {
    issues.push(`unmapped series: ${JSON.stringify(normalized.desc)}`);
  }

  normalized.paid = normalizePrice(get('paid'));
  normalized.book = normalizePrice(get('book'));

  const qtyRaw = get('qty');
  if (qtyRaw == null || qtyRaw === '') {
    normalized.qty = 1;
  } else {
    const n = Number(qtyRaw);
    normalized.qty = Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
  }

  normalized.acquired_date = normalizeDate(get('acquired_date'));
  normalized.source = get('source')
    ? String(get('source')).trim() || null
    : null;
  normalized.comment_1 = get('comment_1')
    ? String(get('comment_1')).trim() || null
    : null;
  normalized.comment_2 = get('comment_2')
    ? String(get('comment_2')).trim() || null
    : null;
  normalized.photo = get('photo')
    ? String(get('photo')).trim() || null
    : null;

  return { normalized, issues };
}
