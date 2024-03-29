import {encode, decode} from '@browserfs/core/utils.js';
import {encodingTests} from 'helpers/bufferDataTests.helper.js';

// witness test 
describe('node:Buffer', ()=>{
    const bufAsArr = (b:Buffer)=>new Uint8Array(b.buffer, b.byteOffset, b.byteLength);

    encodingTests(
        (str:string, encoding:BufferEncoding)=> bufAsArr(Buffer.from(str, encoding)),
        (arr:Uint8Array, encoding:BufferEncoding)=> Buffer.from(arr).toString(encoding)
    );
});

// core test
describe('core encode/decode', ()=>{
    encodingTests(encode, decode);
});
