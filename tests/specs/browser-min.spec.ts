import * as expected from 'index.js';
import {readFileSync} from 'node:fs';
import vm = require('node:vm');

const ctxOptions:vm.CreateContextOptions = {
    codeGeneration: {strings: false, wasm: false},
    microtaskMode: 'afterEvaluate'
}
const runOptions:vm.RunningScriptOptions = {
    timeout: 500,
    microtaskMode: 'afterEvaluate'
}
test('browser.min.js', ()=>{
    const path = require.resolve('/../dist/browser.min.js');
    const src = readFileSync(path, 'utf8');
    const context:any = {TextEncoder, TextDecoder};

    vm.createContext(context, ctxOptions);
    vm.runInContext(src, context, {filename: 'browser.min.js', ...runOptions});
    expect(context.BrowserFS_DOM).toBeDefined();

    let name;
    for(name in expected)
    try {
        expect(typeof(context.BrowserFS_DOM[name]))
            .toBe(typeof(expected[name]));
    }
    catch (err) {
        err.message = `${name}: ${err.message}`
        throw err;
    }
})