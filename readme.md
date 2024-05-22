# ZenFS DOM Backends

[ZenFS](https://github.com/zen-fs/core) backends for DOM APIs. DOM APIs are _only_ available natively in browsers.

> [!IMPORTANT]
> Please read the ZenFS core documentation!

## Backends

-   `WebStorage`: Stores files in a `Storage` object, like `localStorage` and `sessionStorage`.
-   `IndexedDB`: Stores files into an `IndexedDB` object database.
-   `WebAccess`: Store files using the [File System Access API](https://developer.mozilla.org/Web/API/File_System_API).

For more information, see the [API documentation](https://zen-fs.github.io/dom).

## Usage

> [!NOTE]
> The examples are written in ESM.  
> For CJS, you can `require` the package.  
> For a browser environment without support for `type=module` in `script` tags, you can add a `script` tag to your HTML pointing to the `browser.min.js` and use the global `ZenFS_DOM` object.

```js
import { configure, fs } from '@zenfs/core';
import { WebStorage } from '@zenfs/dom';

await configure({ backend: WebStorage, storage: localStorage });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```
