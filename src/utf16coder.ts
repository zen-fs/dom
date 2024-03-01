/**
 * Contains utility methods for encode/decode binary to string
 */

/* Convertion between Uint16 and char */
const itoc = (x)=> String.fromCodePoint((x>>11 !== 27) ? x : x|0x10000);
const ctoi = (x)=> x.codePointAt(0); // Uint16Array will trunc extra high bit

/* Tool to encode [Uint8, Uint7] to a char */
const iitoc = new Int16Array(Int8Array.from([-1,0]).buffer)[0] < 0 ?
  (a,b)=> String.fromCodePoint((a<<8)|b): // BigEndian
  (a,b)=> String.fromCharCode (a|(b<<8)); // LittleEndian

/**
 * Encode binary to string
 * @param data8 any binary data
 * @returns an UTF16 string with extra data
 */
export function utf16Encode(data8: Uint8Array): string {

  let {length, buffer, byteOffset, byteLength} = data8 ;
  const pfx = byteOffset % 2 ; // extra start byte to shift
  const sfx = byteLength % 2 ; // either odd and padding end bytes
  let head;

  if (pfx) {
    data8 = new Uint8Array(buffer, --byteOffset, byteLength + 1);
    // backup head and shift, to align to 16 bits word
    head = data8[0];
    data8.copyWithin(0,1);
  }

  const data16 = new Uint16Array(buffer, byteOffset, byteLength >> 1);
  const lastByte = sfx && data8[length - 1]; // odd end byte, else padding byte
  const extraByte = 2 - sfx; // padding bytes counts

  const dataChars = Array.from(data16, itoc);
  dataChars.push(iitoc(lastByte, extraByte));

  if (pfx) {
    // unshift and restore, to revert changes made to buffer
    data8.copyWithin(1,0);
    data8[0] = head;
  }

  return dataChars.join('');
}
  
/**
 * Decode binary from sting
 * @param string an UTF16 string with extra data
 * @returns copy of the original binary data
 */
export function utf16Decode(string: string): Uint8Array {

  const data16 = Uint16Array.from(string, ctoi);
  const data8 = new Uint8Array(data16.buffer);

  const {length, buffer} = data8;
  const sfx = data8[length - 1]; // extra bytes count

  return new Uint8Array(buffer, 0, length - sfx); // performance
  // return new Uint8Array(buffer.slice(0, length - sfx)); // compatibility
}
