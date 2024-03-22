# ZenFS DOM Backends

[ZenFS](https://github.com/zen-fs/core) backends for DOM APIs. DOM APIs are _only_ available natively in browsers.

> [!IMPORTANT]
> Please read the ZenFS core documentation!

## Backends

-   `Storage`: Stores files in a `Storage` object, like `localStorage` and `sessionStorage`.
-   `IndexedDB`: Stores files into an `IndexedDB` object database.
-   `FileSystemAccess`: Store files using the [Web File System API](https://developer.mozilla.org/Web/API/File_System_API).

For more information, see the [API documentation](https://zen-fs.github.io/dom).

## Usage

> [!NOTE]  
> The examples are written in ESM. If you are using CJS, you can `require` the package. If running in a browser you can add a script tag to your HTML pointing to the `browser.min.js` and use ZenFS DOM via the global `ZenFS_DOM` object.

```js
import { configure, fs } from '@zenfs/core';
import { Storage } from '@zenfs/dom';

await configure({ backend: Storage, storage: localStorage });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```
