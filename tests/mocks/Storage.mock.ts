export default class MockedStorage implements Storage {

    #store: {[key:string]: Uint8Array};
    static readonly #storeFns = ['clear', 'getItem', 'setItem', 'removeItem'];

    constructor() {
        /* init, mock, freeze, disable oldstyled api */
        this.clear();
        for(const k of MockedStorage.#storeFns) this[k] = jest.fn(this[k]);
        Object.freeze(this);
        return new Proxy(this, MockedStorage.#handler);
    }

    /* Forbid full read */
    get length():number {
        throw new Error('Method not implemented.');
    }
    key(index: number): string {
        throw new Error('Method not implemented.');
    }

    /* Implement well defined Storage API */
    clear():void {
        this.#store = {};
    }
    getItem(key: string): string {
        if (!Object.hasOwn(this.#store, key)) return null;
        return new TextDecoder().decode(this.#store[key]);
    }
    setItem(key: string, value: string): void {
        this.#store[key] = new TextEncoder().encode(value);
    }
    removeItem(key: string): void {
        delete this.#store[key];
    }

    static {
        this.prototype[Symbol.toStringTag] = 'Storage';
    }

    /* Forbid legacy dict object api */
    static #target = Symbol();
    static {
        const proto = this.prototype;
        const callable:ProxyHandler<Function> = {
            apply: (t,o,a)=> Reflect.apply(t,o[MockedStorage.#target]||o,a)
        };
        for(const k of MockedStorage.#storeFns) {
            proto[k] = new Proxy(proto[k], callable);
        }
    }
    static #handler:ProxyHandler<MockedStorage> = {
        has: (t,p)=>{
            if (p === MockedStorage.#target) return true;
            if (Reflect.has(t,p)) return true;
            throw new Error('Method not implemented.');
        },
        get: (t,p,r)=>{
            if (p === MockedStorage.#target) return t;
            if (Reflect.has(t,p)) return Reflect.get(t,p,r);
            throw new Error('Method not implemented.');
        },
        set: (t,p,v,r)=>{
            if (Reflect.has(t,p)) return Reflect.set(t,p,v,r);
            throw new Error('Method not implemented.');
        },
        getOwnPropertyDescriptor: (t,p)=>{
            if (Reflect.has(t,p)) return Reflect.getOwnPropertyDescriptor(t,p);
            throw new Error('Method not implemented.');
        },
        ownKeys: ()=>{
            throw new Error('Method not implemented.');
        },
    }

    static unmocked(instance:MockedStorage) {
        return instance[MockedStorage.#target] as Storage;
    }
}