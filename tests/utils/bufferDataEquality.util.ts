/**
 * Check equality of data related to read/write/Buffer operations
 */
export function equals<T = string|Uint8Array>(a:T, b:T):boolean {
    if (a === b) return true;
    if (!(a && b)) return false; // filter null/undefined
    if (Object.getPrototypeOf(a) !== Uint8Array.prototype) return false;
    if (Object.getPrototypeOf(b) !== Uint8Array.prototype) return false;
    // if string, then we know they are not equals...
    // if other type, then we don't care...
    // ... and so we have return false

    // now we have to check Uint8Array equality
    const arrA = a as Uint8Array;
    const arrB = b as Uint8Array;

    if (arrA.byteLength !== arrB.byteLength) return false;
    for (let i = 0; i < arrA.byteLength; i++) {
        if (arrA[i] !== arrB[i]) return false;
    }
    return true;
}

export default equals;