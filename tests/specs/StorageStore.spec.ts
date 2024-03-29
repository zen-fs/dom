import {StorageStore} from 'backends/Storage.js';
import MockedStorage from 'mocks/Storage.mock.js';
import {writeAndReadBackTests} from 'helpers/bufferDataTests.helper.js';

/*
    file.js: getMount('/') insteadof this._fs

      shared.ts import from '../file.js';
      file.js   import from './emulation/shared.js';

      at Object.<anonymous> (node_modules/@browserfs/core/dist/backends/InMemory.js:38:41)
      at Object.<anonymous> (node_modules/@browserfs/core/dist/emulation/shared.js:5:1)
      at Object.<anonymous> (node_modules/@browserfs/core/dist/file.js:3:1)
      at Object.<anonymous> (node_modules/@browserfs/core/dist/backends/SyncStore.js:4:1)
      at Object.<anonymous> (src/backends/Storage.ts:1:1)
      at Object.<anonymous> (tests/specs/StorageStore.spec.ts:1:1)
*/

describe('StorageStore', ()=>{
    let mock = null, store = null;
    beforeEach(()=>{
        mock = new MockedStorage();
        store = new StorageStore(mock);
    });
    writeAndReadBackTests(
        (name, data)=> store.put(name, data, false),
        (name)=> store.get(name)
    );
});
