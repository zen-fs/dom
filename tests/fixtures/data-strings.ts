type KeyOfType<T, V> = keyof {[P in keyof T as T[P] extends V? P: never]};
type Exports = typeof import('./data-strings.js');
type Data = string | readonly number[];
type dataset = 'bidiEncodings' | 'crossEncodings';
type datakey = KeyOfType<Omit<Exports, dataset>, Data>;

/**
 * 8-bits data
 */
export const
  data8 = Object.freeze(new Array(307).fill(0).map((_,i)=>17*i-3&255) as number[]),
  data7 = Object.freeze(data8.map(i=>i&127)),
  ascii = data7.flatMap(i=>String.fromCharCode(i)).join(''),
  bin = data8.flatMap(i=>String.fromCharCode(i)).join(''),
  hex = data8.flatMap(i=>i.toString(16).padStart(2,'0')).join(''),
  b64 = btoa(bin),
  b64url = b64.replaceAll('+','-').replaceAll('/','_').replaceAll('=','');

/**
 * unicode data
 */
const
  isSurrogate = (i:number)=> i>>11 === 27,
  toSupplementary = (i:number)=> (i&15)+1 << 16 | i,
  u16toUtf32 = (i:number)=> isSurrogate(i)? toSupplementary(i) : i;
export const
  data16 = Object.freeze(new Array(256*256).fill(0).map((_,i)=>17*i-3&0xffff) as number[]),
  unicode = data16.map(u16toUtf32).flatMap(i=>String.fromCodePoint(i)).join(''),
  utf8 = Object.freeze(Array.from(new TextEncoder().encode(unicode))),
  utf16 = Object.freeze(unicode.split('').map(c=>c.charCodeAt(0))),
  utf16be = Object.freeze(utf16.flatMap(i=>[i>>8,i&255])),
  utf16le = Object.freeze(utf16.flatMap(i=>[i&255,i>>8])),
  utf16as8 = Object.freeze(utf16.map(i=>i&255));

export const bidiEncodings = [
    ['ascii',     ascii,  data7],
    ['latin1',    bin,    data8],
    ['binary',    bin,    data8],
    ['hex',       hex,    data8],
    ['base64',    b64,    data8],
    ['base64url', b64url, data8],
    /* ---------------------- */
    ['utf8',      unicode, utf8],
    ['utf-8',     unicode, utf8],
    ['utf16le',   unicode, utf16le],
    ['utf-16le',  unicode, utf16le],
    ['ucs2',      unicode, utf16le],
    ['ucs-2',     unicode, utf16le],
] as [BufferEncoding, string, readonly number[]][];

export const crossEncodings = [
    'encode(unicode, "ascii")  => utf16as8',
    'encode(unicode, "latin1") => utf16as8',
    'encode(unicode, "binary") => utf16as8',
    'decode(data8,   "ascii")  => ascii',
    'encode(b64,     "base64url") => data8',
    'encode(b64url,  "base64")    => data8',
].map(s=>s.split(/\W+/)) as (
    ['encode'|'decode', datakey, BufferEncoding, datakey][]
);
