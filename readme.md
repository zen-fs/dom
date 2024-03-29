# @BrowserFS / DOM Backends - iontach

[@BrowserFS](https://github.com/saoirse-iontach/browser-fs-core) backends for DOM APIs. \
DOM APIs are *only* available natively in browsers.

**BrowserFS** is an in-browser file system that emulates the [Node JS file system API](http://nodejs.org/api/fs.html) and supports storing and retrieving files from various backends. BrowserFS also integrates nicely with other tools.

> [!NOTE]
> **@ZenFS** is an (breaking) update of **BrowserFS**, <ins>with a **node:fs**  interface</ins>. <sub>_As of April 2024, it is still in development, that's to say instable and not properly working (expectially encodings, with bad tests). More over contributors are actually dismissed. And **citation of original academic papers was sadly discarded...**_</sub>
>
> **@BrowserFS** is [transient](//github.com/browser-fs/NOTICE) project <sub>_from **BrowserFS** towards **@ZenFS**, (illegitimacy?) claiming to be the next **BrowserFS** (in fact it is **@ZenFS** before rebranding)_</sub>
> [!IMPORTANT]
> <ins>**@BrowserFS-iontach**</ins> is a bugfixed fork of **@BrowserFS @1.0**.
> | Project        | author    | timeline          | links |
> | -------------- | --------- | :---------------: | :---: |
> | **BrowserFS**  | John Vilk | 2014 - 2017       | [npm](//www.npmjs.com/package/browserfs) [github](//github.com/jvilk/BrowserFS) |
> | **@BrowserFS** | dr-Vortex | 09/2023 - 03/2024 | [npm](//www.npmjs.com/org/browserfs) [github](//github.com/browser-fs) |
> | **@ZenFS**     | dr-Vortex | 03/2024 - ...     | [npm](//www.npmjs.com/org/zenfs) [github](//github.com/zen-fs) |
> 
> <sup>_dr-Vortext_ is an alias of _James P_</sup>
### Citing

BrowserFS is a component of the [Doppio](http://doppiojvm.org/) and [Browsix](https://browsix.org/) research projects from the PLASMA lab at the University of Massachusetts Amherst. If you decide to use BrowserFS in a project that leads to a publication, please cite the academic papers on [Doppio](https://dl.acm.org/citation.cfm?doid=2594291.2594293) and [Browsix](https://dl.acm.org/citation.cfm?id=3037727).

<details><summary><i>citations</i></summary>

  - > John Vilk and Emery D. Berger. Doppio: Breaking the Browser Language Barrier. In
      *Proceedings of the 35th ACM SIGPLAN Conference on Programming Language Design and Implementation*
      (2014), pp. 508–518.

    <details><summary><i>references</i></summary>

    ```bibtex
    @inproceedings{VilkDoppio,
        author	= {John Vilk and Emery D. Berger},
        title	= {{Doppio: Breaking the Browser Language Barrier}},
        booktitle	= {Proceedings of the 35th {ACM} {SIGPLAN} Conference
        			on Programming Language Design and Implementation},
        pages	= {508--518},
        year	= {2014},
        url	= {http://doi.acm.org/10.1145/2594291.2594293},
        doi	= {10.1145/2594291.2594293}
    }
    ```
    </details>

  - > Bobby Powers, John Vilk, and Emery D. Berger. Browsix: Bridging the Gap Between Unix and the Browser.
      In *Proceedings of the Twenty-Second International Conference on Architectural Support
      for Programming Languages and Operating Systems* (2017), pp. 253–266.

    <details><summary><i>references</i></summary>

    ```bibtex
    @inproceedings{PowersBrowsix,
        author	= {Bobby Powers and John Vilk and Emery D. Berger},
        title	= {{Browsix: Bridging the Gap Between Unix and the Browser}},
        booktitle	= {Proceedings of the Twenty-Second International Conference
        			on Architectural Support for Programming Languages and Operating Systems},
        pages	= {253--266},
        year	= {2017},
        url	= {http://doi.acm.org/10.1145/3037697.3037727},
        doi	= {10.1145/3037697.3037727}
    }
    ```

    </details>
</details>

### License

**BrowserFS** and **ZenFS** are licensed under the MIT License. See [LICENSE](license.md) for details.

## Backends

- `HTTPRequest`: Downloads files on-demand from a webserver using `fetch`.
- `Storage`: Stores files in a `Storage` object, like `localStorage` and `seesionStorage`.
- `IndexedDB`: Stores files into an `IndexedDB` object database.
- `WorkerFS`: Lets you mount the BrowserFS file system configured in the main thread in a WebWorker, or the other way around!

For more information, see the [API documentation](https://saoirse-iontach.github.io/browser-fs-dom).

## Installing

```sh
npm install saoirse-iontach/browser-fs-dom    # @browserfs/fs-dom
```

#### Building

-   Make sure you have Node and NPM installed. You must have Node v18 or newer.
-   Install dependencies with `npm install`
-   Build using `npm run build`
-   You can find the built code in `dist`.

#### Testing

Run unit tests with `npm test`.

## Usage

> 🛈 The examples are written in ESM. If you are using CJS, you can `require` the package. If running in a browser you can add a script tag to your HTML pointing to the `browser.min.js` and use BrowserFS DOM via the global `BrowserFS_DOM` object.

You can use DOM backends, though you must register them if you plan on using `configure`:

```js
import { configure, fs, registerBackend } from '@browserfs/core';
import { Storage } from '@browserfs/fs-dom';

registerBackend(Storage);
await configure({ fs: 'Storage', options: { storage: localStorage } });

if (!fs.existsSync('/test.txt')) {
	fs.writeFileSync('/test.txt', 'This will persist across reloads!');
}

const contents = fs.readFileSync('/test.txt', 'utf-8');
console.log(contents);
```
