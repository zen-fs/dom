import * as fixtures from 'fixtures/data-strings.js';
import * as smallbin from 'fixtures/data-bin-sm.js';
import {getRandomDatasetList} from 'fixtures/data-bin-xl.js';
import {equals} from 'utils/bufferDataEquality.util.js';

const {bidiEncodings, crossEncodings} = fixtures;

export function writeAndReadBackTests(
    write:(name:string, data:Uint8Array)=>void,
    read:(name:string)=>Uint8Array
){
    let starts = 0;
    let success = 0;
    beforeAll(()=>{starts = success = 0});

    test.each(Object.entries(smallbin))(
        'writeAndReadBack %s', (label, data)=>{
            starts++;

            write(label, Uint8Array.from(data));
            const input = Uint8Array.from(data);
            const ouput = read(label);

            expect(ouput).toEqual(input);
            success++;
        }
    );

    test('writeAndReadBack RandomData', ()=>{
        expect(success).toBe(starts);
        let label = "";
        for(const [groupId, group] of getRandomDatasetList())
        for(const [datasetId, dataset] of group)
        try {
            label = `${groupId}.${datasetId}`;

            write(label, dataset.u8array);
            const input = dataset.u8array;
            const ouput = read(label);

            expect(equals(ouput, input)).toBe(true);
        }
        catch (err) {
            err.message = `${label}: ${err.message}`;
            throw err;
        }
    });
};

export function encodingTests(
    encode:(data:string, encoding:BufferEncoding)=>Uint8Array,
    decode:(data:Uint8Array, encoding:BufferEncoding)=>string
){

    function u8array(array:readonly number[]) {
        return Uint8Array.from(array);
    }

    describe('bidirectional encodings', ()=>{
        describe.each(bidiEncodings)(
            '%s', (encoding, string, data)=>{

                test('encode', ()=>{ expect(equals(
                    encode(string, encoding), u8array(data)
                )).toBe(true) });

                test('decode', ()=>{ expect(equals(
                    decode(u8array(data), encoding), string
                )).toBe(true) });
            }
        );
    });

    describe('cross encodings', ()=>{
        const fn = {encode,decode};
        const get = (key:string, value?:any)=>(
            value = fixtures[key],
            typeof value === 'string' ? value : u8array(value)
        );
        test.each(crossEncodings)(
            '%s(%s, "%s") => %s',
            (name, input, encoding, expected)=>{
                expect(equals(
                    fn[name](get(input) as any, encoding), get(expected)
                )).toBe(true);
            }
        );
    });
};