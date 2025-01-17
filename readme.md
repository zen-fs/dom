# ZenFS DOM Backends

[ZenFS](https://github.com/zen-fs/core) backends for DOM APIs. DOM APIs are _only_ available natively in browsers.

Please read the ZenFS core documentation!

## Backends

- `WebStorage` stores files in a `Storage` object, like `localStorage` and `sessionStorage`.
- `IndexedDB` stores files into an `IndexedDB` object database.
- `WebAccess` uses the [File System Access API](https://developer.mozilla.org/Web/API/File_System_API).
- `XML` uses an `XMLDocument` to store files, which can be appended to the DOM.

For more information, see the [API documentation](https://zen-fs.github.io/dom).

## Usage

You can use the backends from `@zenfs/dom` just like the backends from `@zenfs/core`:

```js
import { configure, fs } from '@zenfs/core';
import { WebStorage } from '@zenfs/dom';

await configureSingle({ backend: WebStorage, storage: localStorage });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```

#### `XML`

The `XML` backend can be used to create a file system which lives in the DOM:

```html
<!-- ... -->
<fs />
<!-- ... -->
```

```js
import { configure, fs } from '@zenfs/core';
import { XML } from '@zenfs/dom';

await configureSingle({
	backend: XML,
	root: document.querySelector('fs'), // root is optional
});

fs.writeFileSync('/test.txt', 'This is in the DOM!');
```

If you choose to add the root element to the DOM by appending it, you will likely want to hide its contents (`display:none` works well).

The `root` option is not required. If you choose not to pass in a `root`, you can always append it to the DOM later:

```js
import { configure, fs, mounts } from '@zenfs/core';
import { XML } from '@zenfs/dom';

await configureSingle({ backend: XML });

const { root } = mounts.get('/');

document.body.append(root);
```

This may disrupt use cases that involve saving the HTML file locally and loading it later, since a new element is created when configuring. In contrast, when using an existing element and passing in a `root`, the existing element's contents will be preserved.
