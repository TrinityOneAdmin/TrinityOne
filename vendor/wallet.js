(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/@cashu/cashu-ts/node_modules/@noble/hashes/utils.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  function anumber(n, title = "") {
    if (typeof n !== "number") {
      const prefix = title && `"${title}" `;
      throw new TypeError(`${prefix}expected number, got ${typeof n}`);
    }
    if (!Number.isSafeInteger(n) || n < 0) {
      const prefix = title && `"${title}" `;
      throw new RangeError(`${prefix}expected integer >= 0, got ${n}`);
    }
  }
  function abytes(value, length, title = "") {
    const bytes = isBytes(value);
    const len = value?.length;
    const needsLen = length !== void 0;
    if (!bytes || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes ? `length=${len}` : `type=${typeof value}`;
      const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
      if (!bytes)
        throw new TypeError(message);
      throw new RangeError(message);
    }
    return value;
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function")
      throw new TypeError("Hash must wrapped by utils.createHasher");
    anumber(h.outputLen);
    anumber(h.blockLen);
    if (h.outputLen < 1)
      throw new Error('"outputLen" must be >= 1');
    if (h.blockLen < 1)
      throw new Error('"blockLen" must be >= 1');
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput(out, instance) {
    abytes(out, void 0, "digestInto() output");
    const min = instance.outputLen;
    if (out.length < min) {
      throw new RangeError('"digestInto() output" expected to be of length >=' + min);
    }
  }
  function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  function rotl(word, shift) {
    return word << shift | word >>> 32 - shift >>> 0;
  }
  var hasHexBuiltin = /* @__PURE__ */ (() => (
    // @ts-ignore
    typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
  ))();
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_2, i) => i.toString(16).padStart(2, "0"));
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += hexes[bytes[i]];
    }
    return hex;
  }
  var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
  function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
      return ch - asciis._0;
    if (ch >= asciis.A && ch <= asciis.F)
      return ch - (asciis.A - 10);
    if (ch >= asciis.a && ch <= asciis.f)
      return ch - (asciis.a - 10);
    return;
  }
  function hexToBytes(hex) {
    if (typeof hex !== "string")
      throw new TypeError("hex string expected, got " + typeof hex);
    if (hasHexBuiltin) {
      try {
        return Uint8Array.fromHex(hex);
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new RangeError(error.message);
        throw error;
      }
    }
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
      throw new RangeError("hex string expected, got unpadded hex of length " + hl);
    const array = new Uint8Array(al);
    for (let ai2 = 0, hi = 0; ai2 < al; ai2++, hi += 2) {
      const n1 = asciiToBase16(hex.charCodeAt(hi));
      const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
      if (n1 === void 0 || n2 === void 0) {
        const char = hex[hi] + hex[hi + 1];
        throw new RangeError('hex string expected, got non-hex character "' + char + '" at index ' + hi);
      }
      array[ai2] = n1 * 16 + n2;
    }
    return array;
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new TypeError("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function concatBytes(...arrays) {
    let sum2 = 0;
    for (let i = 0; i < arrays.length; i++) {
      const a = arrays[i];
      abytes(a);
      sum2 += a.length;
    }
    const res = new Uint8Array(sum2);
    for (let i = 0, pad = 0; i < arrays.length; i++) {
      const a = arrays[i];
      res.set(a, pad);
      pad += a.length;
    }
    return res;
  }
  function createHasher(hashCons, info = {}) {
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.canXOF = tmp.canXOF;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  function randomBytes(bytesLength = 32) {
    anumber(bytesLength, "bytesLength");
    const cr = typeof globalThis === "object" ? globalThis.crypto : null;
    if (typeof cr?.getRandomValues !== "function")
      throw new Error("crypto.getRandomValues must be defined");
    if (bytesLength > 65536)
      throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
    return cr.getRandomValues(new Uint8Array(bytesLength));
  }
  var oidNist = (suffix) => ({
    // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
    // Larger suffix values would need base-128 OID encoding and a different length byte.
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
  });

  // node_modules/@cashu/cashu-ts/node_modules/@noble/curves/utils.js
  var abytes2 = (value, length, title) => abytes(value, length, title);
  var anumber2 = anumber;
  var bytesToHex2 = bytesToHex;
  var concatBytes2 = (...arrays) => concatBytes(...arrays);
  var hexToBytes2 = (hex) => hexToBytes(hex);
  var isBytes2 = isBytes;
  var randomBytes2 = (bytesLength) => randomBytes(bytesLength);
  var _0n = /* @__PURE__ */ BigInt(0);
  var _1n = /* @__PURE__ */ BigInt(1);
  function abool(value, title = "") {
    if (typeof value !== "boolean") {
      const prefix = title && `"${title}" `;
      throw new TypeError(prefix + "expected boolean, got type=" + typeof value);
    }
    return value;
  }
  function abignumber(n) {
    if (typeof n === "bigint") {
      if (!isPosBig(n))
        throw new RangeError("positive bigint expected, got " + n);
    } else
      anumber2(n);
    return n;
  }
  function asafenumber(value, title = "") {
    if (typeof value !== "number") {
      const prefix = title && `"${title}" `;
      throw new TypeError(prefix + "expected number, got type=" + typeof value);
    }
    if (!Number.isSafeInteger(value)) {
      const prefix = title && `"${title}" `;
      throw new RangeError(prefix + "expected safe integer, got " + value);
    }
  }
  function numberToHexUnpadded(num3) {
    const hex = abignumber(num3).toString(16);
    return hex.length & 1 ? "0" + hex : hex;
  }
  function hexToNumber(hex) {
    if (typeof hex !== "string")
      throw new TypeError("hex string expected, got " + typeof hex);
    return hex === "" ? _0n : BigInt("0x" + hex);
  }
  function bytesToNumberBE(bytes) {
    return hexToNumber(bytesToHex(bytes));
  }
  function bytesToNumberLE(bytes) {
    return hexToNumber(bytesToHex(copyBytes(abytes(bytes)).reverse()));
  }
  function numberToBytesBE(n, len) {
    anumber(len);
    if (len === 0)
      throw new RangeError("zero length");
    n = abignumber(n);
    const hex = n.toString(16);
    if (hex.length > len * 2)
      throw new RangeError("number too large");
    return hexToBytes(hex.padStart(len * 2, "0"));
  }
  function numberToBytesLE(n, len) {
    return numberToBytesBE(n, len).reverse();
  }
  function copyBytes(bytes) {
    return Uint8Array.from(abytes2(bytes));
  }
  function asciiToBytes(ascii) {
    if (typeof ascii !== "string")
      throw new TypeError("ascii string expected, got " + typeof ascii);
    return Uint8Array.from(ascii, (c, i) => {
      const charCode = c.charCodeAt(0);
      if (c.length !== 1 || charCode > 127) {
        throw new RangeError(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
      }
      return charCode;
    });
  }
  var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
  function inRange(n, min, max) {
    return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
  }
  function aInRange(title, n, min, max) {
    if (!inRange(n, min, max))
      throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
  }
  function bitLen(n) {
    if (n < _0n)
      throw new Error("expected non-negative bigint, got " + n);
    let len;
    for (len = 0; n > _0n; n >>= _1n, len += 1)
      ;
    return len;
  }
  var bitMask = (n) => (_1n << BigInt(n)) - _1n;
  function createHmacDrbg(hashLen, qByteLen, hmacFn) {
    anumber(hashLen, "hashLen");
    anumber(qByteLen, "qByteLen");
    if (typeof hmacFn !== "function")
      throw new TypeError("hmacFn must be a function");
    const u8n = (len) => new Uint8Array(len);
    const NULL = Uint8Array.of();
    const byte0 = Uint8Array.of(0);
    const byte1 = Uint8Array.of(1);
    const _maxDrbgIters = 1e3;
    let v2 = u8n(hashLen);
    let k2 = u8n(hashLen);
    let i = 0;
    const reset = () => {
      v2.fill(1);
      k2.fill(0);
      i = 0;
    };
    const h = (...msgs) => hmacFn(k2, concatBytes2(v2, ...msgs));
    const reseed = (seed = NULL) => {
      k2 = h(byte0, seed);
      v2 = h();
      if (seed.length === 0)
        return;
      k2 = h(byte1, seed);
      v2 = h();
    };
    const gen = () => {
      if (i++ >= _maxDrbgIters)
        throw new Error("drbg: tried max amount of iterations");
      let len = 0;
      const out = [];
      while (len < qByteLen) {
        v2 = h();
        const sl = v2.slice();
        out.push(sl);
        len += v2.length;
      }
      return concatBytes2(...out);
    };
    const genUntil = (seed, pred) => {
      reset();
      reseed(seed);
      let res = void 0;
      while ((res = pred(gen())) === void 0)
        reseed();
      reset();
      return res;
    };
    return genUntil;
  }
  function validateObject(object, fields = {}, optFields = {}) {
    if (Object.prototype.toString.call(object) !== "[object Object]")
      throw new TypeError("expected valid options object");
    function checkField(fieldName, expectedType, isOpt) {
      if (!isOpt && expectedType !== "function" && !Object.hasOwn(object, fieldName))
        throw new TypeError(`param "${fieldName}" is invalid: expected own property`);
      const val = object[fieldName];
      if (isOpt && val === void 0)
        return;
      const current = typeof val;
      if (current !== expectedType || val === null)
        throw new TypeError(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
    }
    const iter = (f, isOpt) => Object.entries(f).forEach(([k2, v2]) => checkField(k2, v2, isOpt));
    iter(fields, false);
    iter(optFields, true);
  }

  // node_modules/@cashu/cashu-ts/node_modules/@noble/hashes/_md.js
  function Chi(a, b2, c) {
    return a & b2 ^ ~a & c;
  }
  function Maj(a, b2, c) {
    return a & b2 ^ a & c ^ b2 & c;
  }
  var HashMD = class {
    constructor(blockLen, outputLen, padOffset, isLE) {
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "canXOF", false);
      __publicField(this, "padOffset");
      __publicField(this, "isLE");
      // For partial updates less than block size
      __publicField(this, "buffer");
      __publicField(this, "view");
      __publicField(this, "finished", false);
      __publicField(this, "length", 0);
      __publicField(this, "pos", 0);
      __publicField(this, "destroyed", false);
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      aexists(this);
      abytes(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView(data);
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          continue;
        }
        buffer.set(data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
        }
      }
      this.length += data.length;
      this.roundClean();
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      clean(this.buffer.subarray(pos));
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i = pos; i < blockLen; i++)
        buffer[i] = 0;
      view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
      this.process(view, 0);
      const oview = createView(out);
      const len = this.outputLen;
      if (len % 4)
        throw new Error("_sha2: outputLen must be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i = 0; i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneInto(to) {
      to || (to = new this.constructor());
      to.set(...this.get());
      const { blockLen, buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (length % blockLen)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  var SHA512_IV = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    4089235720,
    3144134277,
    2227873595,
    1013904242,
    4271175723,
    2773480762,
    1595750129,
    1359893119,
    2917565137,
    2600822924,
    725511199,
    528734635,
    4215389547,
    1541459225,
    327033209
  ]);

  // node_modules/@cashu/cashu-ts/node_modules/@noble/hashes/_u64.js
  var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
  var _32n = /* @__PURE__ */ BigInt(32);
  function fromBig(n, le2 = false) {
    if (le2)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le2 = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
      const { h, l } = fromBig(lst[i], le2);
      [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
  }
  var shrSH = (h, _l, s) => h >>> s;
  var shrSL = (h, l, s) => h << 32 - s | l >>> s;
  var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
  var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
  var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
  var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
  function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
  }
  var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
  var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;
  var add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
  var add4H = (low, Ah, Bh, Ch, Dh) => Ah + Bh + Ch + Dh + (low / 2 ** 32 | 0) | 0;
  var add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
  var add5H = (low, Ah, Bh, Ch, Dh, Eh) => Ah + Bh + Ch + Dh + Eh + (low / 2 ** 32 | 0) | 0;

  // node_modules/@cashu/cashu-ts/node_modules/@noble/hashes/sha2.js
  var SHA256_K = /* @__PURE__ */ Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
  var SHA2_32B = class extends HashMD {
    constructor(outputLen) {
      super(64, outputLen, 8, false);
    }
    get() {
      const { A: A2, B, C: C2, D: D2, E, F: F2, G: G2, H: H2 } = this;
      return [A2, B, C2, D2, E, F2, G2, H2];
    }
    // prettier-ignore
    set(A2, B, C2, D2, E, F2, G2, H2) {
      this.A = A2 | 0;
      this.B = B | 0;
      this.C = C2 | 0;
      this.D = D2 | 0;
      this.E = E | 0;
      this.F = F2 | 0;
      this.G = G2 | 0;
      this.H = H2 | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4)
        SHA256_W[i] = view.getUint32(offset, false);
      for (let i = 16; i < 64; i++) {
        const W15 = SHA256_W[i - 15];
        const W2 = SHA256_W[i - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
      }
      let { A: A2, B, C: C2, D: D2, E, F: F2, G: G2, H: H2 } = this;
      for (let i = 0; i < 64; i++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H2 + sigma1 + Chi(E, F2, G2) + SHA256_K[i] + SHA256_W[i] | 0;
        const sigma0 = rotr(A2, 2) ^ rotr(A2, 13) ^ rotr(A2, 22);
        const T2 = sigma0 + Maj(A2, B, C2) | 0;
        H2 = G2;
        G2 = F2;
        F2 = E;
        E = D2 + T1 | 0;
        D2 = C2;
        C2 = B;
        B = A2;
        A2 = T1 + T2 | 0;
      }
      A2 = A2 + this.A | 0;
      B = B + this.B | 0;
      C2 = C2 + this.C | 0;
      D2 = D2 + this.D | 0;
      E = E + this.E | 0;
      F2 = F2 + this.F | 0;
      G2 = G2 + this.G | 0;
      H2 = H2 + this.H | 0;
      this.set(A2, B, C2, D2, E, F2, G2, H2);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
      this.destroyed = true;
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      clean(this.buffer);
    }
  };
  var _SHA256 = class extends SHA2_32B {
    constructor() {
      super(32);
      // We cannot use array here since array allows indexing by variable
      // which means optimizer/compiler cannot use registers.
      __publicField(this, "A", SHA256_IV[0] | 0);
      __publicField(this, "B", SHA256_IV[1] | 0);
      __publicField(this, "C", SHA256_IV[2] | 0);
      __publicField(this, "D", SHA256_IV[3] | 0);
      __publicField(this, "E", SHA256_IV[4] | 0);
      __publicField(this, "F", SHA256_IV[5] | 0);
      __publicField(this, "G", SHA256_IV[6] | 0);
      __publicField(this, "H", SHA256_IV[7] | 0);
    }
  };
  var K512 = /* @__PURE__ */ (() => split([
    "0x428a2f98d728ae22",
    "0x7137449123ef65cd",
    "0xb5c0fbcfec4d3b2f",
    "0xe9b5dba58189dbbc",
    "0x3956c25bf348b538",
    "0x59f111f1b605d019",
    "0x923f82a4af194f9b",
    "0xab1c5ed5da6d8118",
    "0xd807aa98a3030242",
    "0x12835b0145706fbe",
    "0x243185be4ee4b28c",
    "0x550c7dc3d5ffb4e2",
    "0x72be5d74f27b896f",
    "0x80deb1fe3b1696b1",
    "0x9bdc06a725c71235",
    "0xc19bf174cf692694",
    "0xe49b69c19ef14ad2",
    "0xefbe4786384f25e3",
    "0x0fc19dc68b8cd5b5",
    "0x240ca1cc77ac9c65",
    "0x2de92c6f592b0275",
    "0x4a7484aa6ea6e483",
    "0x5cb0a9dcbd41fbd4",
    "0x76f988da831153b5",
    "0x983e5152ee66dfab",
    "0xa831c66d2db43210",
    "0xb00327c898fb213f",
    "0xbf597fc7beef0ee4",
    "0xc6e00bf33da88fc2",
    "0xd5a79147930aa725",
    "0x06ca6351e003826f",
    "0x142929670a0e6e70",
    "0x27b70a8546d22ffc",
    "0x2e1b21385c26c926",
    "0x4d2c6dfc5ac42aed",
    "0x53380d139d95b3df",
    "0x650a73548baf63de",
    "0x766a0abb3c77b2a8",
    "0x81c2c92e47edaee6",
    "0x92722c851482353b",
    "0xa2bfe8a14cf10364",
    "0xa81a664bbc423001",
    "0xc24b8b70d0f89791",
    "0xc76c51a30654be30",
    "0xd192e819d6ef5218",
    "0xd69906245565a910",
    "0xf40e35855771202a",
    "0x106aa07032bbd1b8",
    "0x19a4c116b8d2d0c8",
    "0x1e376c085141ab53",
    "0x2748774cdf8eeb99",
    "0x34b0bcb5e19b48a8",
    "0x391c0cb3c5c95a63",
    "0x4ed8aa4ae3418acb",
    "0x5b9cca4f7763e373",
    "0x682e6ff3d6b2b8a3",
    "0x748f82ee5defb2fc",
    "0x78a5636f43172f60",
    "0x84c87814a1f0ab72",
    "0x8cc702081a6439ec",
    "0x90befffa23631e28",
    "0xa4506cebde82bde9",
    "0xbef9a3f7b2c67915",
    "0xc67178f2e372532b",
    "0xca273eceea26619c",
    "0xd186b8c721c0c207",
    "0xeada7dd6cde0eb1e",
    "0xf57d4f7fee6ed178",
    "0x06f067aa72176fba",
    "0x0a637dc5a2c898a6",
    "0x113f9804bef90dae",
    "0x1b710b35131c471b",
    "0x28db77f523047d84",
    "0x32caab7b40c72493",
    "0x3c9ebe0a15c9bebc",
    "0x431d67c49c100d4c",
    "0x4cc5d4becb3e42b6",
    "0x597f299cfc657e2a",
    "0x5fcb6fab3ad6faec",
    "0x6c44198c4a475817"
  ].map((n) => BigInt(n))))();
  var SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
  var SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
  var SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
  var SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
  var SHA2_64B = class extends HashMD {
    constructor(outputLen) {
      super(128, outputLen, 16, false);
    }
    // prettier-ignore
    get() {
      const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    // prettier-ignore
    set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
      this.Ah = Ah | 0;
      this.Al = Al | 0;
      this.Bh = Bh | 0;
      this.Bl = Bl | 0;
      this.Ch = Ch | 0;
      this.Cl = Cl | 0;
      this.Dh = Dh | 0;
      this.Dl = Dl | 0;
      this.Eh = Eh | 0;
      this.El = El | 0;
      this.Fh = Fh | 0;
      this.Fl = Fl | 0;
      this.Gh = Gh | 0;
      this.Gl = Gl | 0;
      this.Hh = Hh | 0;
      this.Hl = Hl | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4) {
        SHA512_W_H[i] = view.getUint32(offset);
        SHA512_W_L[i] = view.getUint32(offset += 4);
      }
      for (let i = 16; i < 80; i++) {
        const W15h = SHA512_W_H[i - 15] | 0;
        const W15l = SHA512_W_L[i - 15] | 0;
        const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
        const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
        const W2h = SHA512_W_H[i - 2] | 0;
        const W2l = SHA512_W_L[i - 2] | 0;
        const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
        const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
        const SUMl = add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
        const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
        SHA512_W_H[i] = SUMh | 0;
        SHA512_W_L[i] = SUMl | 0;
      }
      let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      for (let i = 0; i < 80; i++) {
        const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
        const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
        const CHIh = Eh & Fh ^ ~Eh & Gh;
        const CHIl = El & Fl ^ ~El & Gl;
        const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
        const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
        const T1l = T1ll | 0;
        const sigma0h = rotrSH(Ah, Al, 28) ^ rotrBH(Ah, Al, 34) ^ rotrBH(Ah, Al, 39);
        const sigma0l = rotrSL(Ah, Al, 28) ^ rotrBL(Ah, Al, 34) ^ rotrBL(Ah, Al, 39);
        const MAJh = Ah & Bh ^ Ah & Ch ^ Bh & Ch;
        const MAJl = Al & Bl ^ Al & Cl ^ Bl & Cl;
        Hh = Gh | 0;
        Hl = Gl | 0;
        Gh = Fh | 0;
        Gl = Fl | 0;
        Fh = Eh | 0;
        Fl = El | 0;
        ({ h: Eh, l: El } = add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
        Dh = Ch | 0;
        Dl = Cl | 0;
        Ch = Bh | 0;
        Cl = Bl | 0;
        Bh = Ah | 0;
        Bl = Al | 0;
        const All = add3L(T1l, sigma0l, MAJl);
        Ah = add3H(All, T1h, sigma0h, MAJh);
        Al = All | 0;
      }
      ({ h: Ah, l: Al } = add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
      ({ h: Bh, l: Bl } = add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
      ({ h: Ch, l: Cl } = add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
      ({ h: Dh, l: Dl } = add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
      ({ h: Eh, l: El } = add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
      ({ h: Fh, l: Fl } = add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
      ({ h: Gh, l: Gl } = add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
      ({ h: Hh, l: Hl } = add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
      this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
      clean(SHA512_W_H, SHA512_W_L);
    }
    destroy() {
      this.destroyed = true;
      clean(this.buffer);
      this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
  };
  var _SHA512 = class extends SHA2_64B {
    constructor() {
      super(64);
      __publicField(this, "Ah", SHA512_IV[0] | 0);
      __publicField(this, "Al", SHA512_IV[1] | 0);
      __publicField(this, "Bh", SHA512_IV[2] | 0);
      __publicField(this, "Bl", SHA512_IV[3] | 0);
      __publicField(this, "Ch", SHA512_IV[4] | 0);
      __publicField(this, "Cl", SHA512_IV[5] | 0);
      __publicField(this, "Dh", SHA512_IV[6] | 0);
      __publicField(this, "Dl", SHA512_IV[7] | 0);
      __publicField(this, "Eh", SHA512_IV[8] | 0);
      __publicField(this, "El", SHA512_IV[9] | 0);
      __publicField(this, "Fh", SHA512_IV[10] | 0);
      __publicField(this, "Fl", SHA512_IV[11] | 0);
      __publicField(this, "Gh", SHA512_IV[12] | 0);
      __publicField(this, "Gl", SHA512_IV[13] | 0);
      __publicField(this, "Hh", SHA512_IV[14] | 0);
      __publicField(this, "Hl", SHA512_IV[15] | 0);
    }
  };
  var sha256 = /* @__PURE__ */ createHasher(
    () => new _SHA256(),
    /* @__PURE__ */ oidNist(1)
  );
  var sha512 = /* @__PURE__ */ createHasher(
    () => new _SHA512(),
    /* @__PURE__ */ oidNist(3)
  );

  // node_modules/@cashu/cashu-ts/node_modules/@scure/base/index.js
  function isBytes3(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  function isArrayOf(isString, arr) {
    if (!Array.isArray(arr))
      return false;
    if (arr.length === 0)
      return true;
    if (isString) {
      return arr.every((item) => typeof item === "string");
    } else {
      return arr.every((item) => Number.isSafeInteger(item));
    }
  }
  function afn(input) {
    if (typeof input !== "function")
      throw new TypeError("function expected");
    return true;
  }
  function astr(label, input) {
    if (typeof input !== "string")
      throw new TypeError(`${label}: string expected`);
    return true;
  }
  function anumber3(n) {
    if (typeof n !== "number")
      throw new TypeError(`number expected, got ${typeof n}`);
    if (!Number.isSafeInteger(n))
      throw new RangeError(`invalid integer: ${n}`);
  }
  function aArr(input) {
    if (!Array.isArray(input))
      throw new TypeError("array expected");
  }
  function astrArr(label, input) {
    if (!isArrayOf(true, input))
      throw new TypeError(`${label}: array of strings expected`);
  }
  function anumArr(label, input) {
    if (!isArrayOf(false, input))
      throw new TypeError(`${label}: array of numbers expected`);
  }
  // @__NO_SIDE_EFFECTS__
  function chain(...args) {
    const id = (a) => a;
    const wrap = (a, b2) => (c) => a(b2(c));
    const encode = args.map((x2) => x2.encode).reduceRight(wrap, id);
    const decode = args.map((x2) => x2.decode).reduce(wrap, id);
    return { encode, decode };
  }
  // @__NO_SIDE_EFFECTS__
  function alphabet(letters) {
    const lettersA = typeof letters === "string" ? letters.split("") : letters;
    const len = lettersA.length;
    astrArr("alphabet", lettersA);
    const indexes = new Map(lettersA.map((l, i) => [l, i]));
    return {
      encode: (digits) => {
        aArr(digits);
        return digits.map((i) => {
          if (!Number.isSafeInteger(i) || i < 0 || i >= len)
            throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${letters}`);
          return lettersA[i];
        });
      },
      decode: (input) => {
        aArr(input);
        return input.map((letter) => {
          astr("alphabet.decode", letter);
          const i = indexes.get(letter);
          if (i === void 0)
            throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
          return i;
        });
      }
    };
  }
  // @__NO_SIDE_EFFECTS__
  function join(separator = "") {
    astr("join", separator);
    return {
      encode: (from) => {
        astrArr("join.decode", from);
        return from.join(separator);
      },
      decode: (to) => {
        astr("join.decode", to);
        return to.split(separator);
      }
    };
  }
  function convertRadix(data, from, to) {
    if (from < 2)
      throw new RangeError(`convertRadix: invalid from=${from}, base cannot be less than 2`);
    if (to < 2)
      throw new RangeError(`convertRadix: invalid to=${to}, base cannot be less than 2`);
    aArr(data);
    if (!data.length)
      return [];
    let pos = 0;
    const res = [];
    const digits = Array.from(data, (d) => {
      anumber3(d);
      if (d < 0 || d >= from)
        throw new Error(`invalid integer: ${d}`);
      return d;
    });
    const dlen = digits.length;
    while (true) {
      let carry = 0;
      let done = true;
      for (let i = pos; i < dlen; i++) {
        const digit = digits[i];
        const fromCarry = from * carry;
        const digitBase = fromCarry + digit;
        if (!Number.isSafeInteger(digitBase) || fromCarry / from !== carry || digitBase - digit !== fromCarry) {
          throw new Error("convertRadix: carry overflow");
        }
        const div = digitBase / to;
        carry = digitBase % to;
        const rounded = Math.floor(div);
        digits[i] = rounded;
        if (!Number.isSafeInteger(rounded) || rounded * to + carry !== digitBase)
          throw new Error("convertRadix: carry overflow");
        if (!done)
          continue;
        else if (!rounded)
          pos = i;
        else
          done = false;
      }
      res.push(carry);
      if (done)
        break;
    }
    for (let i = 0; i < data.length - 1 && data[i] === 0; i++)
      res.push(0);
    return res.reverse();
  }
  // @__NO_SIDE_EFFECTS__
  function radix(num3) {
    anumber3(num3);
    const _256 = 2 ** 8;
    return {
      encode: (bytes) => {
        if (!isBytes3(bytes))
          throw new TypeError("radix.encode input should be Uint8Array");
        return convertRadix(Array.from(bytes), _256, num3);
      },
      decode: (digits) => {
        anumArr("radix.decode", digits);
        return Uint8Array.from(convertRadix(digits, num3, _256));
      }
    };
  }
  function checksum(len, fn2) {
    anumber3(len);
    if (len <= 0)
      throw new RangeError(`checksum length must be positive: ${len}`);
    afn(fn2);
    const _fn = fn2;
    return {
      encode(data) {
        if (!isBytes3(data))
          throw new TypeError("checksum.encode: input should be Uint8Array");
        const sum2 = _fn(data).slice(0, len);
        const res = new Uint8Array(data.length + len);
        res.set(data);
        res.set(sum2, data.length);
        return res;
      },
      decode(data) {
        if (!isBytes3(data))
          throw new TypeError("checksum.decode: input should be Uint8Array");
        const payload = data.slice(0, -len);
        const oldChecksum = data.slice(-len);
        const newChecksum = _fn(payload).slice(0, len);
        for (let i = 0; i < len; i++)
          if (newChecksum[i] !== oldChecksum[i])
            throw new Error("Invalid checksum");
        return payload;
      }
    };
  }
  var genBase58 = /* @__NO_SIDE_EFFECTS__ */ (abc) => /* @__PURE__ */ chain(/* @__PURE__ */ radix(58), /* @__PURE__ */ alphabet(abc), /* @__PURE__ */ join(""));
  var base58 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ genBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"));
  var createBase58check = (sha2562) => {
    afn(sha2562);
    const _sha256 = sha2562;
    return /* @__PURE__ */ chain(checksum(4, (data) => _sha256(_sha256(data))), base58);
  };

  // node_modules/@cashu/cashu-ts/node_modules/@noble/curves/abstract/modular.js
  var _0n2 = /* @__PURE__ */ BigInt(0);
  var _1n2 = /* @__PURE__ */ BigInt(1);
  var _2n = /* @__PURE__ */ BigInt(2);
  var _3n = /* @__PURE__ */ BigInt(3);
  var _4n = /* @__PURE__ */ BigInt(4);
  var _5n = /* @__PURE__ */ BigInt(5);
  var _7n = /* @__PURE__ */ BigInt(7);
  var _8n = /* @__PURE__ */ BigInt(8);
  var _9n = /* @__PURE__ */ BigInt(9);
  var _16n = /* @__PURE__ */ BigInt(16);
  function mod(a, b2) {
    if (b2 <= _0n2)
      throw new Error("mod: expected positive modulus, got " + b2);
    const result = a % b2;
    return result >= _0n2 ? result : b2 + result;
  }
  function pow2(x2, power, modulo) {
    if (power < _0n2)
      throw new Error("pow2: expected non-negative exponent, got " + power);
    let res = x2;
    while (power-- > _0n2) {
      res *= res;
      res %= modulo;
    }
    return res;
  }
  function invert(number, modulo) {
    if (number === _0n2)
      throw new Error("invert: expected non-zero number");
    if (modulo <= _0n2)
      throw new Error("invert: expected positive modulus, got " + modulo);
    let a = mod(number, modulo);
    let b2 = modulo;
    let x2 = _0n2, y2 = _1n2, u = _1n2, v2 = _0n2;
    while (a !== _0n2) {
      const q2 = b2 / a;
      const r = b2 - a * q2;
      const m = x2 - u * q2;
      const n = y2 - v2 * q2;
      b2 = a, a = r, x2 = u, y2 = v2, u = m, v2 = n;
    }
    const gcd = b2;
    if (gcd !== _1n2)
      throw new Error("invert: does not exist");
    return mod(x2, modulo);
  }
  function assertIsSquare(Fp, root, n) {
    const F2 = Fp;
    if (!F2.eql(F2.sqr(root), n))
      throw new Error("Cannot find square root");
  }
  function sqrt3mod4(Fp, n) {
    const F2 = Fp;
    const p1div4 = (F2.ORDER + _1n2) / _4n;
    const root = F2.pow(n, p1div4);
    assertIsSquare(F2, root, n);
    return root;
  }
  function sqrt5mod8(Fp, n) {
    const F2 = Fp;
    const p5div8 = (F2.ORDER - _5n) / _8n;
    const n2 = F2.mul(n, _2n);
    const v2 = F2.pow(n2, p5div8);
    const nv = F2.mul(n, v2);
    const i = F2.mul(F2.mul(nv, _2n), v2);
    const root = F2.mul(nv, F2.sub(i, F2.ONE));
    assertIsSquare(F2, root, n);
    return root;
  }
  function sqrt9mod16(P2) {
    const Fp_ = Field(P2);
    const tn2 = tonelliShanks(P2);
    const c1 = tn2(Fp_, Fp_.neg(Fp_.ONE));
    const c2 = tn2(Fp_, c1);
    const c3 = tn2(Fp_, Fp_.neg(c1));
    const c4 = (P2 + _7n) / _16n;
    return ((Fp, n) => {
      const F2 = Fp;
      let tv1 = F2.pow(n, c4);
      let tv2 = F2.mul(tv1, c1);
      const tv3 = F2.mul(tv1, c2);
      const tv4 = F2.mul(tv1, c3);
      const e1 = F2.eql(F2.sqr(tv2), n);
      const e22 = F2.eql(F2.sqr(tv3), n);
      tv1 = F2.cmov(tv1, tv2, e1);
      tv2 = F2.cmov(tv4, tv3, e22);
      const e32 = F2.eql(F2.sqr(tv2), n);
      const root = F2.cmov(tv1, tv2, e32);
      assertIsSquare(F2, root, n);
      return root;
    });
  }
  function tonelliShanks(P2) {
    if (P2 < _3n)
      throw new Error("sqrt is not defined for small field");
    let Q2 = P2 - _1n2;
    let S2 = 0;
    while (Q2 % _2n === _0n2) {
      Q2 /= _2n;
      S2++;
    }
    let Z2 = _2n;
    const _Fp = Field(P2);
    while (FpLegendre(_Fp, Z2) === 1) {
      if (Z2++ > 1e3)
        throw new Error("Cannot find square root: probably non-prime P");
    }
    if (S2 === 1)
      return sqrt3mod4;
    let cc = _Fp.pow(Z2, Q2);
    const Q1div2 = (Q2 + _1n2) / _2n;
    return function tonelliSlow(Fp, n) {
      const F2 = Fp;
      if (F2.is0(n))
        return n;
      if (FpLegendre(F2, n) !== 1)
        throw new Error("Cannot find square root");
      let M2 = S2;
      let c = F2.mul(F2.ONE, cc);
      let t = F2.pow(n, Q2);
      let R2 = F2.pow(n, Q1div2);
      while (!F2.eql(t, F2.ONE)) {
        if (F2.is0(t))
          return F2.ZERO;
        let i = 1;
        let t_tmp = F2.sqr(t);
        while (!F2.eql(t_tmp, F2.ONE)) {
          i++;
          t_tmp = F2.sqr(t_tmp);
          if (i === M2)
            throw new Error("Cannot find square root");
        }
        const exponent = _1n2 << BigInt(M2 - i - 1);
        const b2 = F2.pow(c, exponent);
        M2 = i;
        c = F2.sqr(b2);
        t = F2.mul(t, c);
        R2 = F2.mul(R2, b2);
      }
      return R2;
    };
  }
  function FpSqrt(P2) {
    if (P2 % _4n === _3n)
      return sqrt3mod4;
    if (P2 % _8n === _5n)
      return sqrt5mod8;
    if (P2 % _16n === _9n)
      return sqrt9mod16(P2);
    return tonelliShanks(P2);
  }
  var FIELD_FIELDS = [
    "create",
    "isValid",
    "is0",
    "neg",
    "inv",
    "sqrt",
    "sqr",
    "eql",
    "add",
    "sub",
    "mul",
    "pow",
    "div",
    "addN",
    "subN",
    "mulN",
    "sqrN"
  ];
  function validateField(field) {
    const initial = {
      ORDER: "bigint",
      BYTES: "number",
      BITS: "number"
    };
    const opts = FIELD_FIELDS.reduce((map, val) => {
      map[val] = "function";
      return map;
    }, initial);
    validateObject(field, opts);
    asafenumber(field.BYTES, "BYTES");
    asafenumber(field.BITS, "BITS");
    if (field.BYTES < 1 || field.BITS < 1)
      throw new Error("invalid field: expected BYTES/BITS > 0");
    if (field.ORDER <= _1n2)
      throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
    return field;
  }
  function FpPow(Fp, num3, power) {
    const F2 = Fp;
    if (power < _0n2)
      throw new Error("invalid exponent, negatives unsupported");
    if (power === _0n2)
      return F2.ONE;
    if (power === _1n2)
      return num3;
    let p = F2.ONE;
    let d = num3;
    while (power > _0n2) {
      if (power & _1n2)
        p = F2.mul(p, d);
      d = F2.sqr(d);
      power >>= _1n2;
    }
    return p;
  }
  function FpInvertBatch(Fp, nums, passZero = false) {
    const F2 = Fp;
    const inverted = new Array(nums.length).fill(passZero ? F2.ZERO : void 0);
    const multipliedAcc = nums.reduce((acc, num3, i) => {
      if (F2.is0(num3))
        return acc;
      inverted[i] = acc;
      return F2.mul(acc, num3);
    }, F2.ONE);
    const invertedAcc = F2.inv(multipliedAcc);
    nums.reduceRight((acc, num3, i) => {
      if (F2.is0(num3))
        return acc;
      inverted[i] = F2.mul(acc, inverted[i]);
      return F2.mul(acc, num3);
    }, invertedAcc);
    return inverted;
  }
  function FpLegendre(Fp, n) {
    const F2 = Fp;
    const p1mod2 = (F2.ORDER - _1n2) / _2n;
    const powered = F2.pow(n, p1mod2);
    const yes = F2.eql(powered, F2.ONE);
    const zero = F2.eql(powered, F2.ZERO);
    const no = F2.eql(powered, F2.neg(F2.ONE));
    if (!yes && !zero && !no)
      throw new Error("invalid Legendre symbol result");
    return yes ? 1 : zero ? 0 : -1;
  }
  function nLength(n, nBitLength) {
    if (nBitLength !== void 0)
      anumber2(nBitLength);
    if (n <= _0n2)
      throw new Error("invalid n length: expected positive n, got " + n);
    if (nBitLength !== void 0 && nBitLength < 1)
      throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
    const bits = bitLen(n);
    if (nBitLength !== void 0 && nBitLength < bits)
      throw new Error(`invalid n length: expected bit length (${bits}) >= n.length (${nBitLength})`);
    const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
  }
  var FIELD_SQRT = /* @__PURE__ */ new WeakMap();
  var _Field = class {
    constructor(ORDER, opts = {}) {
      __publicField(this, "ORDER");
      __publicField(this, "BITS");
      __publicField(this, "BYTES");
      __publicField(this, "isLE");
      __publicField(this, "ZERO", _0n2);
      __publicField(this, "ONE", _1n2);
      __publicField(this, "_lengths");
      __publicField(this, "_mod");
      if (ORDER <= _1n2)
        throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
      let _nbitLength = void 0;
      this.isLE = false;
      if (opts != null && typeof opts === "object") {
        if (typeof opts.BITS === "number")
          _nbitLength = opts.BITS;
        if (typeof opts.sqrt === "function")
          Object.defineProperty(this, "sqrt", { value: opts.sqrt, enumerable: true });
        if (typeof opts.isLE === "boolean")
          this.isLE = opts.isLE;
        if (opts.allowedLengths)
          this._lengths = Object.freeze(opts.allowedLengths.slice());
        if (typeof opts.modFromBytes === "boolean")
          this._mod = opts.modFromBytes;
      }
      const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
      if (nByteLength > 2048)
        throw new Error("invalid field: expected ORDER of <= 2048 bytes");
      this.ORDER = ORDER;
      this.BITS = nBitLength;
      this.BYTES = nByteLength;
      Object.freeze(this);
    }
    create(num3) {
      return mod(num3, this.ORDER);
    }
    isValid(num3) {
      if (typeof num3 !== "bigint")
        throw new TypeError("invalid field element: expected bigint, got " + typeof num3);
      return _0n2 <= num3 && num3 < this.ORDER;
    }
    is0(num3) {
      return num3 === _0n2;
    }
    // is valid and invertible
    isValidNot0(num3) {
      return !this.is0(num3) && this.isValid(num3);
    }
    isOdd(num3) {
      return (num3 & _1n2) === _1n2;
    }
    neg(num3) {
      return mod(-num3, this.ORDER);
    }
    eql(lhs, rhs) {
      return lhs === rhs;
    }
    sqr(num3) {
      return mod(num3 * num3, this.ORDER);
    }
    add(lhs, rhs) {
      return mod(lhs + rhs, this.ORDER);
    }
    sub(lhs, rhs) {
      return mod(lhs - rhs, this.ORDER);
    }
    mul(lhs, rhs) {
      return mod(lhs * rhs, this.ORDER);
    }
    pow(num3, power) {
      return FpPow(this, num3, power);
    }
    div(lhs, rhs) {
      return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
    }
    // Same as above, but doesn't normalize
    sqrN(num3) {
      return num3 * num3;
    }
    addN(lhs, rhs) {
      return lhs + rhs;
    }
    subN(lhs, rhs) {
      return lhs - rhs;
    }
    mulN(lhs, rhs) {
      return lhs * rhs;
    }
    inv(num3) {
      return invert(num3, this.ORDER);
    }
    sqrt(num3) {
      let sqrt = FIELD_SQRT.get(this);
      if (!sqrt)
        FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
      return sqrt(this, num3);
    }
    toBytes(num3) {
      return this.isLE ? numberToBytesLE(num3, this.BYTES) : numberToBytesBE(num3, this.BYTES);
    }
    fromBytes(bytes, skipValidation = false) {
      abytes2(bytes);
      const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
      if (allowedLengths) {
        if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
      if (modFromBytes)
        scalar = mod(scalar, ORDER);
      if (!skipValidation) {
        if (!this.isValid(scalar))
          throw new Error("invalid field element: outside of range 0..ORDER");
      }
      return scalar;
    }
    // TODO: we don't need it here, move out to separate fn
    invertBatch(lst) {
      return FpInvertBatch(this, lst);
    }
    // We can't move this out because Fp6, Fp12 implement it
    // and it's unclear what to return in there.
    cmov(a, b2, condition) {
      abool(condition, "condition");
      return condition ? b2 : a;
    }
  };
  Object.freeze(_Field.prototype);
  function Field(ORDER, opts = {}) {
    return new _Field(ORDER, opts);
  }
  function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== "bigint")
      throw new Error("field order must be bigint");
    if (fieldOrder <= _1n2)
      throw new Error("field order must be greater than 1");
    const bitLength = bitLen(fieldOrder - _1n2);
    return Math.ceil(bitLength / 8);
  }
  function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
  }
  function mapHashToField(key, fieldOrder, isLE = false) {
    abytes2(key);
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = Math.max(getMinHashLength(fieldOrder), 16);
    if (len < minLen || len > 1024)
      throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
    const num3 = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
    const reduced = mod(num3, fieldOrder - _1n2) + _1n2;
    return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
  }

  // node_modules/@cashu/cashu-ts/node_modules/@noble/curves/abstract/curve.js
  var _0n3 = /* @__PURE__ */ BigInt(0);
  var _1n3 = /* @__PURE__ */ BigInt(1);
  function negateCt(condition, item) {
    const neg = item.negate();
    return condition ? neg : item;
  }
  function normalizeZ(c, points) {
    const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
    return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
  }
  function validateW(W2, bits) {
    if (!Number.isSafeInteger(W2) || W2 <= 0 || W2 > bits)
      throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W2);
  }
  function calcWOpts(W2, scalarBits) {
    validateW(W2, scalarBits);
    const windows = Math.ceil(scalarBits / W2) + 1;
    const windowSize = 2 ** (W2 - 1);
    const maxNumber = 2 ** W2;
    const mask = bitMask(W2);
    const shiftBy = BigInt(W2);
    return { windows, windowSize, mask, maxNumber, shiftBy };
  }
  function calcOffsets(n, window2, wOpts) {
    const { windowSize, mask, maxNumber, shiftBy } = wOpts;
    let wbits = Number(n & mask);
    let nextN = n >> shiftBy;
    if (wbits > windowSize) {
      wbits -= maxNumber;
      nextN += _1n3;
    }
    const offsetStart = window2 * windowSize;
    const offset = offsetStart + Math.abs(wbits) - 1;
    const isZero = wbits === 0;
    const isNeg = wbits < 0;
    const isNegF = window2 % 2 !== 0;
    const offsetF = offsetStart;
    return { nextN, offset, isZero, isNeg, isNegF, offsetF };
  }
  var pointPrecomputes = /* @__PURE__ */ new WeakMap();
  var pointWindowSizes = /* @__PURE__ */ new WeakMap();
  function getW(P2) {
    return pointWindowSizes.get(P2) || 1;
  }
  function assert0(n) {
    if (n !== _0n3)
      throw new Error("invalid wNAF");
  }
  var wNAF = class {
    // Parametrized with a given Point class (not individual point)
    constructor(Point2, bits) {
      __publicField(this, "BASE");
      __publicField(this, "ZERO");
      __publicField(this, "Fn");
      __publicField(this, "bits");
      this.BASE = Point2.BASE;
      this.ZERO = Point2.ZERO;
      this.Fn = Point2.Fn;
      this.bits = bits;
    }
    // non-const time multiplication ladder
    _unsafeLadder(elm, n, p = this.ZERO) {
      let d = elm;
      while (n > _0n3) {
        if (n & _1n3)
          p = p.add(d);
        d = d.double();
        n >>= _1n3;
      }
      return p;
    }
    /**
     * Creates a wNAF precomputation window. Used for caching.
     * Default window size is set by `utils.precompute()` and is equal to 8.
     * Number of precomputed points depends on the curve size:
     * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
     * - 𝑊 is the window size
     * - 𝑛 is the bitlength of the curve order.
     * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
     * @param point - Point instance
     * @param W - window size
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(point, W2) {
      const { windows, windowSize } = calcWOpts(W2, this.bits);
      const points = [];
      let p = point;
      let base = p;
      for (let window2 = 0; window2 < windows; window2++) {
        base = p;
        points.push(base);
        for (let i = 1; i < windowSize; i++) {
          base = base.add(p);
          points.push(base);
        }
        p = base.double();
      }
      return points;
    }
    /**
     * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
     * More compact implementation:
     * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
     * @returns real and fake (for const-time) points
     */
    wNAF(W2, precomputes, n) {
      if (!this.Fn.isValid(n))
        throw new Error("invalid scalar");
      let p = this.ZERO;
      let f = this.BASE;
      const wo = calcWOpts(W2, this.bits);
      for (let window2 = 0; window2 < wo.windows; window2++) {
        const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window2, wo);
        n = nextN;
        if (isZero) {
          f = f.add(negateCt(isNegF, precomputes[offsetF]));
        } else {
          p = p.add(negateCt(isNeg, precomputes[offset]));
        }
      }
      assert0(n);
      return { p, f };
    }
    /**
     * Implements unsafe EC multiplication using precomputed tables
     * and w-ary non-adjacent form.
     * @param acc - accumulator point to add result of multiplication
     * @returns point
     */
    wNAFUnsafe(W2, precomputes, n, acc = this.ZERO) {
      const wo = calcWOpts(W2, this.bits);
      for (let window2 = 0; window2 < wo.windows; window2++) {
        if (n === _0n3)
          break;
        const { nextN, offset, isZero, isNeg } = calcOffsets(n, window2, wo);
        n = nextN;
        if (isZero) {
          continue;
        } else {
          const item = precomputes[offset];
          acc = acc.add(isNeg ? item.negate() : item);
        }
      }
      assert0(n);
      return acc;
    }
    getPrecomputes(W2, point, transform) {
      let comp = pointPrecomputes.get(point);
      if (!comp) {
        comp = this.precomputeWindow(point, W2);
        if (W2 !== 1) {
          if (typeof transform === "function")
            comp = transform(comp);
          pointPrecomputes.set(point, comp);
        }
      }
      return comp;
    }
    cached(point, scalar, transform) {
      const W2 = getW(point);
      return this.wNAF(W2, this.getPrecomputes(W2, point, transform), scalar);
    }
    unsafe(point, scalar, transform, prev) {
      const W2 = getW(point);
      if (W2 === 1)
        return this._unsafeLadder(point, scalar, prev);
      return this.wNAFUnsafe(W2, this.getPrecomputes(W2, point, transform), scalar, prev);
    }
    // We calculate precomputes for elliptic curve point multiplication
    // using windowed method. This specifies window size and
    // stores precomputed values. Usually only base point would be precomputed.
    createCache(P2, W2) {
      validateW(W2, this.bits);
      pointWindowSizes.set(P2, W2);
      pointPrecomputes.delete(P2);
    }
    hasCache(elm) {
      return getW(elm) !== 1;
    }
  };
  function mulEndoUnsafe(Point2, point, k1, k2) {
    let acc = point;
    let p1 = Point2.ZERO;
    let p2 = Point2.ZERO;
    while (k1 > _0n3 || k2 > _0n3) {
      if (k1 & _1n3)
        p1 = p1.add(acc);
      if (k2 & _1n3)
        p2 = p2.add(acc);
      acc = acc.double();
      k1 >>= _1n3;
      k2 >>= _1n3;
    }
    return { p1, p2 };
  }
  function createField(order, field, isLE) {
    if (field) {
      if (field.ORDER !== order)
        throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
      validateField(field);
      return field;
    } else {
      return Field(order, { isLE });
    }
  }
  function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
    if (FpFnLE === void 0)
      FpFnLE = type === "edwards";
    if (!CURVE || typeof CURVE !== "object")
      throw new Error(`expected valid ${type} CURVE object`);
    for (const p of ["p", "n", "h"]) {
      const val = CURVE[p];
      if (!(typeof val === "bigint" && val > _0n3))
        throw new Error(`CURVE.${p} must be positive bigint`);
    }
    const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
    const Fn2 = createField(CURVE.n, curveOpts.Fn, FpFnLE);
    const _b = type === "weierstrass" ? "b" : "d";
    const params = ["Gx", "Gy", "a", _b];
    for (const p of params) {
      if (!Fp.isValid(CURVE[p]))
        throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
    }
    CURVE = Object.freeze(Object.assign({}, CURVE));
    return { CURVE, Fp, Fn: Fn2 };
  }
  function createKeygen(randomSecretKey, getPublicKey) {
    return function keygen(seed) {
      const secretKey = randomSecretKey(seed);
      return { secretKey, publicKey: getPublicKey(secretKey) };
    };
  }

  // node_modules/@cashu/cashu-ts/node_modules/@noble/hashes/hmac.js
  var _HMAC = class {
    constructor(hash, key) {
      __publicField(this, "oHash");
      __publicField(this, "iHash");
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "canXOF", false);
      __publicField(this, "finished", false);
      __publicField(this, "destroyed", false);
      ahash(hash);
      abytes(key, void 0, "key");
      this.iHash = hash.create();
      if (typeof this.iHash.update !== "function")
        throw new Error("Expected instance of class which extends utils.Hash");
      this.blockLen = this.iHash.blockLen;
      this.outputLen = this.iHash.outputLen;
      const blockLen = this.blockLen;
      const pad = new Uint8Array(blockLen);
      pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54 ^ 92;
      this.oHash.update(pad);
      clean(pad);
    }
    update(buf) {
      aexists(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const buf = out.subarray(0, this.outputLen);
      this.iHash.digestInto(buf);
      this.oHash.update(buf);
      this.oHash.digestInto(buf);
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.oHash.outputLen);
      this.digestInto(out);
      return out;
    }
    _cloneInto(to) {
      to || (to = Object.create(Object.getPrototypeOf(this), {}));
      const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
      to = to;
      to.finished = finished;
      to.destroyed = destroyed;
      to.blockLen = blockLen;
      to.outputLen = outputLen;
      to.oHash = oHash._cloneInto(to.oHash);
      to.iHash = iHash._cloneInto(to.iHash);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true;
      this.oHash.destroy();
      this.iHash.destroy();
    }
  };
  var hmac = /* @__PURE__ */ (() => {
    const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
    hmac_.create = (hash, key) => new _HMAC(hash, key);
    return hmac_;
  })();

  // node_modules/@cashu/cashu-ts/node_modules/@noble/curves/abstract/weierstrass.js
  var divNearest = (num3, den) => (num3 + (num3 >= 0 ? den : -den) / _2n2) / den;
  function _splitEndoScalar(k2, basis, n) {
    aInRange("scalar", k2, _0n4, n);
    const [[a1, b1], [a2, b2]] = basis;
    const c1 = divNearest(b2 * k2, n);
    const c2 = divNearest(-b1 * k2, n);
    let k1 = k2 - c1 * a1 - c2 * a2;
    let k22 = -c1 * b1 - c2 * b2;
    const k1neg = k1 < _0n4;
    const k2neg = k22 < _0n4;
    if (k1neg)
      k1 = -k1;
    if (k2neg)
      k22 = -k22;
    const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
    if (k1 < _0n4 || k1 >= MAX_NUM || k22 < _0n4 || k22 >= MAX_NUM) {
      throw new Error("splitScalar (endomorphism): failed for k");
    }
    return { k1neg, k1, k2neg, k2: k22 };
  }
  function validateSigFormat(format) {
    if (!["compact", "recovered", "der"].includes(format))
      throw new Error('Signature format must be "compact", "recovered", or "der"');
    return format;
  }
  function validateSigOpts(opts, def) {
    validateObject(opts);
    const optsn = {};
    for (let optName of Object.keys(def)) {
      optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
    }
    abool(optsn.lowS, "lowS");
    abool(optsn.prehash, "prehash");
    if (optsn.format !== void 0)
      validateSigFormat(optsn.format);
    return optsn;
  }
  var DERErr = class extends Error {
    constructor(m = "") {
      super(m);
    }
  };
  var DER = {
    // asn.1 DER encoding utils
    Err: DERErr,
    // Basic building block is TLV (Tag-Length-Value)
    _tlv: {
      encode: (tag, data) => {
        const { Err: E } = DER;
        asafenumber(tag, "tag");
        if (tag < 0 || tag > 255)
          throw new E("tlv.encode: wrong tag");
        if (typeof data !== "string")
          throw new TypeError('"data" expected string, got type=' + typeof data);
        if (data.length & 1)
          throw new E("tlv.encode: unpadded data");
        const dataLen = data.length / 2;
        const len = numberToHexUnpadded(dataLen);
        if (len.length / 2 & 128)
          throw new E("tlv.encode: long form length too big");
        const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
        const t = numberToHexUnpadded(tag);
        return t + lenLen + len + data;
      },
      // v - value, l - left bytes (unparsed)
      decode(tag, data) {
        const { Err: E } = DER;
        data = abytes2(data, void 0, "DER data");
        let pos = 0;
        if (tag < 0 || tag > 255)
          throw new E("tlv.encode: wrong tag");
        if (data.length < 2 || data[pos++] !== tag)
          throw new E("tlv.decode: wrong tlv");
        const first = data[pos++];
        const isLong = !!(first & 128);
        let length = 0;
        if (!isLong)
          length = first;
        else {
          const lenLen = first & 127;
          if (!lenLen)
            throw new E("tlv.decode(long): indefinite length not supported");
          if (lenLen > 4)
            throw new E("tlv.decode(long): byte length is too big");
          const lengthBytes = data.subarray(pos, pos + lenLen);
          if (lengthBytes.length !== lenLen)
            throw new E("tlv.decode: length bytes not complete");
          if (lengthBytes[0] === 0)
            throw new E("tlv.decode(long): zero leftmost byte");
          for (const b2 of lengthBytes)
            length = length << 8 | b2;
          pos += lenLen;
          if (length < 128)
            throw new E("tlv.decode(long): not minimal encoding");
        }
        const v2 = data.subarray(pos, pos + length);
        if (v2.length !== length)
          throw new E("tlv.decode: wrong value length");
        return { v: v2, l: data.subarray(pos + length) };
      }
    },
    // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
    // since we always use positive integers here. It must always be empty:
    // - add zero byte if exists
    // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
    _int: {
      encode(num3) {
        const { Err: E } = DER;
        abignumber(num3);
        if (num3 < _0n4)
          throw new E("integer: negative integers are not allowed");
        let hex = numberToHexUnpadded(num3);
        if (Number.parseInt(hex[0], 16) & 8)
          hex = "00" + hex;
        if (hex.length & 1)
          throw new E("unexpected DER parsing assertion: unpadded hex");
        return hex;
      },
      decode(data) {
        const { Err: E } = DER;
        if (data.length < 1)
          throw new E("invalid signature integer: empty");
        if (data[0] & 128)
          throw new E("invalid signature integer: negative");
        if (data.length > 1 && data[0] === 0 && !(data[1] & 128))
          throw new E("invalid signature integer: unnecessary leading zero");
        return bytesToNumberBE(data);
      }
    },
    toSig(bytes) {
      const { Err: E, _int: int, _tlv: tlv } = DER;
      const data = abytes2(bytes, void 0, "signature");
      const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
      if (seqLeftBytes.length)
        throw new E("invalid signature: left bytes after parsing");
      const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
      const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
      if (sLeftBytes.length)
        throw new E("invalid signature: left bytes after parsing");
      return { r: int.decode(rBytes), s: int.decode(sBytes) };
    },
    hexFromSig(sig) {
      const { _tlv: tlv, _int: int } = DER;
      const rs = tlv.encode(2, int.encode(sig.r));
      const ss = tlv.encode(2, int.encode(sig.s));
      const seq = rs + ss;
      return tlv.encode(48, seq);
    }
  };
  Object.freeze(DER._tlv);
  Object.freeze(DER._int);
  Object.freeze(DER);
  var _0n4 = /* @__PURE__ */ BigInt(0);
  var _1n4 = /* @__PURE__ */ BigInt(1);
  var _2n2 = /* @__PURE__ */ BigInt(2);
  var _3n2 = /* @__PURE__ */ BigInt(3);
  var _4n2 = /* @__PURE__ */ BigInt(4);
  function weierstrass(params, extraOpts = {}) {
    const validated = createCurveFields("weierstrass", params, extraOpts);
    const Fp = validated.Fp;
    const Fn2 = validated.Fn;
    let CURVE = validated.CURVE;
    const { h: cofactor, n: CURVE_ORDER } = CURVE;
    validateObject(extraOpts, {}, {
      allowInfinityPoint: "boolean",
      clearCofactor: "function",
      isTorsionFree: "function",
      fromBytes: "function",
      toBytes: "function",
      endo: "object"
    });
    const { endo, allowInfinityPoint } = extraOpts;
    if (endo) {
      if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) {
        throw new Error('invalid endo: expected "beta": bigint and "basises": array');
      }
    }
    const lengths = getWLengths(Fp, Fn2);
    function assertCompressionIsSupported() {
      if (!Fp.isOdd)
        throw new Error("compression is not supported: Field does not have .isOdd()");
    }
    function pointToBytes2(_c, point, isCompressed) {
      if (allowInfinityPoint && point.is0())
        return Uint8Array.of(0);
      const { x: x2, y: y2 } = point.toAffine();
      const bx = Fp.toBytes(x2);
      abool(isCompressed, "isCompressed");
      if (isCompressed) {
        assertCompressionIsSupported();
        const hasEvenY = !Fp.isOdd(y2);
        return concatBytes2(pprefix(hasEvenY), bx);
      } else {
        return concatBytes2(Uint8Array.of(4), bx, Fp.toBytes(y2));
      }
    }
    function pointFromBytes(bytes) {
      abytes2(bytes, void 0, "Point");
      const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
      const length = bytes.length;
      const head = bytes[0];
      const tail = bytes.subarray(1);
      if (allowInfinityPoint && length === 1 && head === 0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (length === comp && (head === 2 || head === 3)) {
        const x2 = Fp.fromBytes(tail);
        if (!Fp.isValid(x2))
          throw new Error("bad point: is not on curve, wrong x");
        const y2 = weierstrassEquation(x2);
        let y3;
        try {
          y3 = Fp.sqrt(y2);
        } catch (sqrtError) {
          const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
          throw new Error("bad point: is not on curve, sqrt error" + err);
        }
        assertCompressionIsSupported();
        const evenY = Fp.isOdd(y3);
        const evenH = (head & 1) === 1;
        if (evenH !== evenY)
          y3 = Fp.neg(y3);
        return { x: x2, y: y3 };
      } else if (length === uncomp && head === 4) {
        const L2 = Fp.BYTES;
        const x2 = Fp.fromBytes(tail.subarray(0, L2));
        const y2 = Fp.fromBytes(tail.subarray(L2, L2 * 2));
        if (!isValidXY(x2, y2))
          throw new Error("bad point: is not on curve");
        return { x: x2, y: y2 };
      } else {
        throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
      }
    }
    const encodePoint = extraOpts.toBytes === void 0 ? pointToBytes2 : extraOpts.toBytes;
    const decodePoint = extraOpts.fromBytes === void 0 ? pointFromBytes : extraOpts.fromBytes;
    function weierstrassEquation(x2) {
      const x22 = Fp.sqr(x2);
      const x3 = Fp.mul(x22, x2);
      return Fp.add(Fp.add(x3, Fp.mul(x2, CURVE.a)), CURVE.b);
    }
    function isValidXY(x2, y2) {
      const left = Fp.sqr(y2);
      const right = weierstrassEquation(x2);
      return Fp.eql(left, right);
    }
    if (!isValidXY(CURVE.Gx, CURVE.Gy))
      throw new Error("bad curve params: generator point");
    const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n2), _4n2);
    const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
    if (Fp.is0(Fp.add(_4a3, _27b2)))
      throw new Error("bad curve params: a or b");
    function acoord(title, n, banZero = false) {
      if (!Fp.isValid(n) || banZero && Fp.is0(n))
        throw new Error(`bad point coordinate ${title}`);
      return n;
    }
    function aprjpoint(other) {
      if (!(other instanceof Point2))
        throw new Error("Weierstrass Point expected");
    }
    function splitEndoScalarN(k2) {
      if (!endo || !endo.basises)
        throw new Error("no endo");
      return _splitEndoScalar(k2, endo.basises, Fn2.ORDER);
    }
    function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
      k2p = new Point2(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
      k1p = negateCt(k1neg, k1p);
      k2p = negateCt(k2neg, k2p);
      return k1p.add(k2p);
    }
    const _Point = class _Point {
      /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
      constructor(X2, Y2, Z2) {
        __publicField(this, "X");
        __publicField(this, "Y");
        __publicField(this, "Z");
        this.X = acoord("x", X2);
        this.Y = acoord("y", Y2, true);
        this.Z = acoord("z", Z2);
        Object.freeze(this);
      }
      static CURVE() {
        return CURVE;
      }
      /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
      static fromAffine(p) {
        const { x: x2, y: y2 } = p || {};
        if (!p || !Fp.isValid(x2) || !Fp.isValid(y2))
          throw new Error("invalid affine point");
        if (p instanceof _Point)
          throw new Error("projective point not allowed");
        if (Fp.is0(x2) && Fp.is0(y2))
          return _Point.ZERO;
        return new _Point(x2, y2, Fp.ONE);
      }
      static fromBytes(bytes) {
        const P2 = _Point.fromAffine(decodePoint(abytes2(bytes, void 0, "point")));
        P2.assertValidity();
        return P2;
      }
      static fromHex(hex) {
        return _Point.fromBytes(hexToBytes2(hex));
      }
      get x() {
        return this.toAffine().x;
      }
      get y() {
        return this.toAffine().y;
      }
      /**
       *
       * @param windowSize
       * @param isLazy - true will defer table computation until the first multiplication
       * @returns
       */
      precompute(windowSize = 8, isLazy = true) {
        wnaf.createCache(this, windowSize);
        if (!isLazy)
          this.multiply(_3n2);
        return this;
      }
      // TODO: return `this`
      /** A point on curve is valid if it conforms to equation. */
      assertValidity() {
        const p = this;
        if (p.is0()) {
          if (extraOpts.allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z))
            return;
          throw new Error("bad point: ZERO");
        }
        const { x: x2, y: y2 } = p.toAffine();
        if (!Fp.isValid(x2) || !Fp.isValid(y2))
          throw new Error("bad point: x or y not field elements");
        if (!isValidXY(x2, y2))
          throw new Error("bad point: equation left != right");
        if (!p.isTorsionFree())
          throw new Error("bad point: not in prime-order subgroup");
      }
      hasEvenY() {
        const { y: y2 } = this.toAffine();
        if (!Fp.isOdd)
          throw new Error("Field doesn't support isOdd");
        return !Fp.isOdd(y2);
      }
      /** Compare one point to another. */
      equals(other) {
        aprjpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
        const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
        return U1 && U2;
      }
      /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
      negate() {
        return new _Point(this.X, Fp.neg(this.Y), this.Z);
      }
      // Renes-Costello-Batina exception-free doubling formula.
      // There is 30% faster Jacobian formula, but it is not complete.
      // https://eprint.iacr.org/2015/1060, algorithm 3
      // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
      double() {
        const { a, b: b2 } = CURVE;
        const b3 = Fp.mul(b2, _3n2);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
        let t0 = Fp.mul(X1, X1);
        let t1 = Fp.mul(Y1, Y1);
        let t2 = Fp.mul(Z1, Z1);
        let t3 = Fp.mul(X1, Y1);
        t3 = Fp.add(t3, t3);
        Z3 = Fp.mul(X1, Z1);
        Z3 = Fp.add(Z3, Z3);
        X3 = Fp.mul(a, Z3);
        Y3 = Fp.mul(b3, t2);
        Y3 = Fp.add(X3, Y3);
        X3 = Fp.sub(t1, Y3);
        Y3 = Fp.add(t1, Y3);
        Y3 = Fp.mul(X3, Y3);
        X3 = Fp.mul(t3, X3);
        Z3 = Fp.mul(b3, Z3);
        t2 = Fp.mul(a, t2);
        t3 = Fp.sub(t0, t2);
        t3 = Fp.mul(a, t3);
        t3 = Fp.add(t3, Z3);
        Z3 = Fp.add(t0, t0);
        t0 = Fp.add(Z3, t0);
        t0 = Fp.add(t0, t2);
        t0 = Fp.mul(t0, t3);
        Y3 = Fp.add(Y3, t0);
        t2 = Fp.mul(Y1, Z1);
        t2 = Fp.add(t2, t2);
        t0 = Fp.mul(t2, t3);
        X3 = Fp.sub(X3, t0);
        Z3 = Fp.mul(t2, t1);
        Z3 = Fp.add(Z3, Z3);
        Z3 = Fp.add(Z3, Z3);
        return new _Point(X3, Y3, Z3);
      }
      // Renes-Costello-Batina exception-free addition formula.
      // There is 30% faster Jacobian formula, but it is not complete.
      // https://eprint.iacr.org/2015/1060, algorithm 1
      // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
      add(other) {
        aprjpoint(other);
        const { X: X1, Y: Y1, Z: Z1 } = this;
        const { X: X2, Y: Y2, Z: Z2 } = other;
        let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
        const a = CURVE.a;
        const b3 = Fp.mul(CURVE.b, _3n2);
        let t0 = Fp.mul(X1, X2);
        let t1 = Fp.mul(Y1, Y2);
        let t2 = Fp.mul(Z1, Z2);
        let t3 = Fp.add(X1, Y1);
        let t4 = Fp.add(X2, Y2);
        t3 = Fp.mul(t3, t4);
        t4 = Fp.add(t0, t1);
        t3 = Fp.sub(t3, t4);
        t4 = Fp.add(X1, Z1);
        let t5 = Fp.add(X2, Z2);
        t4 = Fp.mul(t4, t5);
        t5 = Fp.add(t0, t2);
        t4 = Fp.sub(t4, t5);
        t5 = Fp.add(Y1, Z1);
        X3 = Fp.add(Y2, Z2);
        t5 = Fp.mul(t5, X3);
        X3 = Fp.add(t1, t2);
        t5 = Fp.sub(t5, X3);
        Z3 = Fp.mul(a, t4);
        X3 = Fp.mul(b3, t2);
        Z3 = Fp.add(X3, Z3);
        X3 = Fp.sub(t1, Z3);
        Z3 = Fp.add(t1, Z3);
        Y3 = Fp.mul(X3, Z3);
        t1 = Fp.add(t0, t0);
        t1 = Fp.add(t1, t0);
        t2 = Fp.mul(a, t2);
        t4 = Fp.mul(b3, t4);
        t1 = Fp.add(t1, t2);
        t2 = Fp.sub(t0, t2);
        t2 = Fp.mul(a, t2);
        t4 = Fp.add(t4, t2);
        t0 = Fp.mul(t1, t4);
        Y3 = Fp.add(Y3, t0);
        t0 = Fp.mul(t5, t4);
        X3 = Fp.mul(t3, X3);
        X3 = Fp.sub(X3, t0);
        t0 = Fp.mul(t3, t1);
        Z3 = Fp.mul(t5, Z3);
        Z3 = Fp.add(Z3, t0);
        return new _Point(X3, Y3, Z3);
      }
      subtract(other) {
        aprjpoint(other);
        return this.add(other.negate());
      }
      is0() {
        return this.equals(_Point.ZERO);
      }
      /**
       * Constant time multiplication.
       * Uses wNAF method. Windowed method may be 10% faster,
       * but takes 2x longer to generate and consumes 2x memory.
       * Uses precomputes when available.
       * Uses endomorphism for Koblitz curves.
       * @param scalar - by which the point would be multiplied
       * @returns New point
       */
      multiply(scalar) {
        const { endo: endo2 } = extraOpts;
        if (!Fn2.isValidNot0(scalar))
          throw new RangeError("invalid scalar: out of range");
        let point, fake;
        const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(_Point, p));
        if (endo2) {
          const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
          const { p: k1p, f: k1f } = mul(k1);
          const { p: k2p, f: k2f } = mul(k2);
          fake = k1f.add(k2f);
          point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
        } else {
          const { p, f } = mul(scalar);
          point = p;
          fake = f;
        }
        return normalizeZ(_Point, [point, fake])[0];
      }
      /**
       * Non-constant-time multiplication. Uses double-and-add algorithm.
       * It's faster, but should only be used when you don't care about
       * an exposed secret key e.g. sig verification, which works over *public* keys.
       */
      multiplyUnsafe(scalar) {
        const { endo: endo2 } = extraOpts;
        const p = this;
        const sc = scalar;
        if (!Fn2.isValid(sc))
          throw new RangeError("invalid scalar: out of range");
        if (sc === _0n4 || p.is0())
          return _Point.ZERO;
        if (sc === _1n4)
          return p;
        if (wnaf.hasCache(this))
          return this.multiply(sc);
        if (endo2) {
          const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
          const { p1, p2 } = mulEndoUnsafe(_Point, p, k1, k2);
          return finishEndo(endo2.beta, p1, p2, k1neg, k2neg);
        } else {
          return wnaf.unsafe(p, sc);
        }
      }
      /**
       * Converts Projective point to affine (x, y) coordinates.
       * (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
       * @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
       */
      toAffine(invertedZ) {
        const p = this;
        let iz = invertedZ;
        const { X: X2, Y: Y2, Z: Z2 } = p;
        if (Fp.eql(Z2, Fp.ONE))
          return { x: X2, y: Y2 };
        const is0 = p.is0();
        if (iz == null)
          iz = is0 ? Fp.ONE : Fp.inv(Z2);
        const x2 = Fp.mul(X2, iz);
        const y2 = Fp.mul(Y2, iz);
        const zz = Fp.mul(Z2, iz);
        if (is0)
          return { x: Fp.ZERO, y: Fp.ZERO };
        if (!Fp.eql(zz, Fp.ONE))
          throw new Error("invZ was invalid");
        return { x: x2, y: y2 };
      }
      /**
       * Checks whether Point is free of torsion elements (is in prime subgroup).
       * Always torsion-free for cofactor=1 curves.
       */
      isTorsionFree() {
        const { isTorsionFree } = extraOpts;
        if (cofactor === _1n4)
          return true;
        if (isTorsionFree)
          return isTorsionFree(_Point, this);
        return wnaf.unsafe(this, CURVE_ORDER).is0();
      }
      clearCofactor() {
        const { clearCofactor } = extraOpts;
        if (cofactor === _1n4)
          return this;
        if (clearCofactor)
          return clearCofactor(_Point, this);
        return this.multiplyUnsafe(cofactor);
      }
      isSmallOrder() {
        if (cofactor === _1n4)
          return this.is0();
        return this.clearCofactor().is0();
      }
      toBytes(isCompressed = true) {
        abool(isCompressed, "isCompressed");
        this.assertValidity();
        return encodePoint(_Point, this, isCompressed);
      }
      toHex(isCompressed = true) {
        return bytesToHex2(this.toBytes(isCompressed));
      }
      toString() {
        return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
      }
    };
    // base / generator point
    __publicField(_Point, "BASE", new _Point(CURVE.Gx, CURVE.Gy, Fp.ONE));
    // zero / infinity / identity point
    __publicField(_Point, "ZERO", new _Point(Fp.ZERO, Fp.ONE, Fp.ZERO));
    // 0, 1, 0
    // math field
    __publicField(_Point, "Fp", Fp);
    // scalar field
    __publicField(_Point, "Fn", Fn2);
    let Point2 = _Point;
    const bits = Fn2.BITS;
    const wnaf = new wNAF(Point2, extraOpts.endo ? Math.ceil(bits / 2) : bits);
    if (bits >= 8)
      Point2.BASE.precompute(8);
    Object.freeze(Point2.prototype);
    Object.freeze(Point2);
    return Point2;
  }
  function pprefix(hasEvenY) {
    return Uint8Array.of(hasEvenY ? 2 : 3);
  }
  function getWLengths(Fp, Fn2) {
    return {
      secretKey: Fn2.BYTES,
      publicKey: 1 + Fp.BYTES,
      publicKeyUncompressed: 1 + 2 * Fp.BYTES,
      publicKeyHasPrefix: true,
      // Raw compact `(r || s)` signature width; DER and recovered signatures use
      // different lengths outside this helper.
      signature: 2 * Fn2.BYTES
    };
  }
  function ecdh(Point2, ecdhOpts = {}) {
    const { Fn: Fn2 } = Point2;
    const randomBytes_ = ecdhOpts.randomBytes === void 0 ? randomBytes2 : ecdhOpts.randomBytes;
    const lengths = Object.assign(getWLengths(Point2.Fp, Fn2), {
      seed: Math.max(getMinHashLength(Fn2.ORDER), 16)
    });
    function isValidSecretKey(secretKey) {
      try {
        const num3 = Fn2.fromBytes(secretKey);
        return Fn2.isValidNot0(num3);
      } catch (error) {
        return false;
      }
    }
    function isValidPublicKey(publicKey, isCompressed) {
      const { publicKey: comp, publicKeyUncompressed } = lengths;
      try {
        const l = publicKey.length;
        if (isCompressed === true && l !== comp)
          return false;
        if (isCompressed === false && l !== publicKeyUncompressed)
          return false;
        return !!Point2.fromBytes(publicKey);
      } catch (error) {
        return false;
      }
    }
    function randomSecretKey(seed) {
      seed = seed === void 0 ? randomBytes_(lengths.seed) : seed;
      return mapHashToField(abytes2(seed, lengths.seed, "seed"), Fn2.ORDER);
    }
    function getPublicKey(secretKey, isCompressed = true) {
      return Point2.BASE.multiply(Fn2.fromBytes(secretKey)).toBytes(isCompressed);
    }
    function isProbPub(item) {
      const { secretKey, publicKey, publicKeyUncompressed } = lengths;
      const allowedLengths = Fn2._lengths;
      if (!isBytes2(item))
        return void 0;
      const l = abytes2(item, void 0, "key").length;
      const isPub = l === publicKey || l === publicKeyUncompressed;
      const isSec = l === secretKey || !!allowedLengths?.includes(l);
      if (isPub && isSec)
        return void 0;
      return isPub;
    }
    function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
      if (isProbPub(secretKeyA) === true)
        throw new Error("first arg must be private key");
      if (isProbPub(publicKeyB) === false)
        throw new Error("second arg must be public key");
      const s = Fn2.fromBytes(secretKeyA);
      const b2 = Point2.fromBytes(publicKeyB);
      return b2.multiply(s).toBytes(isCompressed);
    }
    const utils = {
      isValidSecretKey,
      isValidPublicKey,
      randomSecretKey
    };
    const keygen = createKeygen(randomSecretKey, getPublicKey);
    Object.freeze(utils);
    Object.freeze(lengths);
    return Object.freeze({ getPublicKey, getSharedSecret, keygen, Point: Point2, utils, lengths });
  }
  function ecdsa(Point2, hash, ecdsaOpts = {}) {
    const hash_ = hash;
    ahash(hash_);
    validateObject(ecdsaOpts, {}, {
      hmac: "function",
      lowS: "boolean",
      randomBytes: "function",
      bits2int: "function",
      bits2int_modN: "function"
    });
    ecdsaOpts = Object.assign({}, ecdsaOpts);
    const randomBytes3 = ecdsaOpts.randomBytes === void 0 ? randomBytes2 : ecdsaOpts.randomBytes;
    const hmac2 = ecdsaOpts.hmac === void 0 ? (key, msg) => hmac(hash_, key, msg) : ecdsaOpts.hmac;
    const { Fp, Fn: Fn2 } = Point2;
    const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn2;
    const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point2, ecdsaOpts);
    const defaultSigOpts = {
      prehash: true,
      lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : true,
      format: "compact",
      extraEntropy: false
    };
    const hasLargeRecoveryLifts = CURVE_ORDER * _2n2 + _1n4 < Fp.ORDER;
    function isBiggerThanHalfOrder(number) {
      const HALF = CURVE_ORDER >> _1n4;
      return number > HALF;
    }
    function validateRS(title, num3) {
      if (!Fn2.isValidNot0(num3))
        throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
      return num3;
    }
    function assertRecoverableCurve() {
      if (hasLargeRecoveryLifts)
        throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
    }
    function validateSigLength(bytes, format) {
      validateSigFormat(format);
      const size = lengths.signature;
      const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
      return abytes2(bytes, sizer);
    }
    class Signature {
      constructor(r, s, recovery) {
        __publicField(this, "r");
        __publicField(this, "s");
        __publicField(this, "recovery");
        this.r = validateRS("r", r);
        this.s = validateRS("s", s);
        if (recovery != null) {
          assertRecoverableCurve();
          if (![0, 1, 2, 3].includes(recovery))
            throw new Error("invalid recovery id");
          this.recovery = recovery;
        }
        Object.freeze(this);
      }
      static fromBytes(bytes, format = defaultSigOpts.format) {
        validateSigLength(bytes, format);
        let recid;
        if (format === "der") {
          const { r: r2, s: s2 } = DER.toSig(abytes2(bytes));
          return new Signature(r2, s2);
        }
        if (format === "recovered") {
          recid = bytes[0];
          format = "compact";
          bytes = bytes.subarray(1);
        }
        const L2 = lengths.signature / 2;
        const r = bytes.subarray(0, L2);
        const s = bytes.subarray(L2, L2 * 2);
        return new Signature(Fn2.fromBytes(r), Fn2.fromBytes(s), recid);
      }
      static fromHex(hex, format) {
        return this.fromBytes(hexToBytes2(hex), format);
      }
      assertRecovery() {
        const { recovery } = this;
        if (recovery == null)
          throw new Error("invalid recovery id: must be present");
        return recovery;
      }
      addRecoveryBit(recovery) {
        return new Signature(this.r, this.s, recovery);
      }
      // Unlike the top-level helper below, this method expects a digest that has
      // already been hashed to the curve's message representative.
      recoverPublicKey(messageHash) {
        const { r, s } = this;
        const recovery = this.assertRecovery();
        const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
        if (!Fp.isValid(radj))
          throw new Error("invalid recovery id: sig.r+curve.n != R.x");
        const x2 = Fp.toBytes(radj);
        const R2 = Point2.fromBytes(concatBytes2(pprefix((recovery & 1) === 0), x2));
        const ir = Fn2.inv(radj);
        const h = bits2int_modN(abytes2(messageHash, void 0, "msgHash"));
        const u1 = Fn2.create(-h * ir);
        const u2 = Fn2.create(s * ir);
        const Q2 = Point2.BASE.multiplyUnsafe(u1).add(R2.multiplyUnsafe(u2));
        if (Q2.is0())
          throw new Error("invalid recovery: point at infinify");
        Q2.assertValidity();
        return Q2;
      }
      // Signatures should be low-s, to prevent malleability.
      hasHighS() {
        return isBiggerThanHalfOrder(this.s);
      }
      toBytes(format = defaultSigOpts.format) {
        validateSigFormat(format);
        if (format === "der")
          return hexToBytes2(DER.hexFromSig(this));
        const { r, s } = this;
        const rb = Fn2.toBytes(r);
        const sb = Fn2.toBytes(s);
        if (format === "recovered") {
          assertRecoverableCurve();
          return concatBytes2(Uint8Array.of(this.assertRecovery()), rb, sb);
        }
        return concatBytes2(rb, sb);
      }
      toHex(format) {
        return bytesToHex2(this.toBytes(format));
      }
    }
    Object.freeze(Signature.prototype);
    Object.freeze(Signature);
    const bits2int = ecdsaOpts.bits2int === void 0 ? function bits2int_def(bytes) {
      if (bytes.length > 8192)
        throw new Error("input is too large");
      const num3 = bytesToNumberBE(bytes);
      const delta = bytes.length * 8 - fnBits;
      return delta > 0 ? num3 >> BigInt(delta) : num3;
    } : ecdsaOpts.bits2int;
    const bits2int_modN = ecdsaOpts.bits2int_modN === void 0 ? function bits2int_modN_def(bytes) {
      return Fn2.create(bits2int(bytes));
    } : ecdsaOpts.bits2int_modN;
    const ORDER_MASK = bitMask(fnBits);
    function int2octets(num3) {
      aInRange("num < 2^" + fnBits, num3, _0n4, ORDER_MASK);
      return Fn2.toBytes(num3);
    }
    function validateMsgAndHash(message, prehash) {
      abytes2(message, void 0, "message");
      return prehash ? abytes2(hash_(message), void 0, "prehashed message") : message;
    }
    function prepSig(message, secretKey, opts) {
      const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
      message = validateMsgAndHash(message, prehash);
      const h1int = bits2int_modN(message);
      const d = Fn2.fromBytes(secretKey);
      if (!Fn2.isValidNot0(d))
        throw new Error("invalid private key");
      const seedArgs = [int2octets(d), int2octets(h1int)];
      if (extraEntropy != null && extraEntropy !== false) {
        const e19 = extraEntropy === true ? randomBytes3(lengths.secretKey) : extraEntropy;
        seedArgs.push(abytes2(e19, void 0, "extraEntropy"));
      }
      const seed = concatBytes2(...seedArgs);
      const m = h1int;
      function k2sig(kBytes) {
        const k2 = bits2int(kBytes);
        if (!Fn2.isValidNot0(k2))
          return;
        const ik = Fn2.inv(k2);
        const q2 = Point2.BASE.multiply(k2).toAffine();
        const r = Fn2.create(q2.x);
        if (r === _0n4)
          return;
        const s = Fn2.create(ik * Fn2.create(m + r * d));
        if (s === _0n4)
          return;
        let recovery = (q2.x === r ? 0 : 2) | Number(q2.y & _1n4);
        let normS = s;
        if (lowS && isBiggerThanHalfOrder(s)) {
          normS = Fn2.neg(s);
          recovery ^= 1;
        }
        return new Signature(r, normS, hasLargeRecoveryLifts ? void 0 : recovery);
      }
      return { seed, k2sig };
    }
    function sign(message, secretKey, opts = {}) {
      const { seed, k2sig } = prepSig(message, secretKey, opts);
      const drbg = createHmacDrbg(hash_.outputLen, Fn2.BYTES, hmac2);
      const sig = drbg(seed, k2sig);
      return sig.toBytes(opts.format);
    }
    function verify(signature, message, publicKey, opts = {}) {
      const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
      publicKey = abytes2(publicKey, void 0, "publicKey");
      message = validateMsgAndHash(message, prehash);
      if (!isBytes2(signature)) {
        const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
        throw new Error("verify expects Uint8Array signature" + end);
      }
      validateSigLength(signature, format);
      try {
        const sig = Signature.fromBytes(signature, format);
        const P2 = Point2.fromBytes(publicKey);
        if (lowS && sig.hasHighS())
          return false;
        const { r, s } = sig;
        const h = bits2int_modN(message);
        const is = Fn2.inv(s);
        const u1 = Fn2.create(h * is);
        const u2 = Fn2.create(r * is);
        const R2 = Point2.BASE.multiplyUnsafe(u1).add(P2.multiplyUnsafe(u2));
        if (R2.is0())
          return false;
        const v2 = Fn2.create(R2.x);
        return v2 === r;
      } catch (e19) {
        return false;
      }
    }
    function recoverPublicKey(signature, message, opts = {}) {
      const { prehash } = validateSigOpts(opts, defaultSigOpts);
      message = validateMsgAndHash(message, prehash);
      return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
    }
    return Object.freeze({
      keygen,
      getPublicKey,
      getSharedSecret,
      utils,
      lengths,
      Point: Point2,
      sign,
      verify,
      recoverPublicKey,
      Signature,
      hash: hash_
    });
  }

  // node_modules/@cashu/cashu-ts/node_modules/@noble/curves/secp256k1.js
  var secp256k1_CURVE = {
    p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
    n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
    h: BigInt(1),
    a: BigInt(0),
    b: BigInt(7),
    Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
    Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
  };
  var secp256k1_ENDO = {
    beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
    basises: [
      [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
      [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
    ]
  };
  var _0n5 = /* @__PURE__ */ BigInt(0);
  var _2n3 = /* @__PURE__ */ BigInt(2);
  function sqrtMod(y2) {
    const P2 = secp256k1_CURVE.p;
    const _3n3 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
    const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
    const b2 = y2 * y2 * y2 % P2;
    const b3 = b2 * b2 * y2 % P2;
    const b6 = pow2(b3, _3n3, P2) * b3 % P2;
    const b9 = pow2(b6, _3n3, P2) * b3 % P2;
    const b11 = pow2(b9, _2n3, P2) * b2 % P2;
    const b22 = pow2(b11, _11n, P2) * b11 % P2;
    const b44 = pow2(b22, _22n, P2) * b22 % P2;
    const b88 = pow2(b44, _44n, P2) * b44 % P2;
    const b176 = pow2(b88, _88n, P2) * b88 % P2;
    const b220 = pow2(b176, _44n, P2) * b44 % P2;
    const b223 = pow2(b220, _3n3, P2) * b3 % P2;
    const t1 = pow2(b223, _23n, P2) * b22 % P2;
    const t2 = pow2(t1, _6n, P2) * b2 % P2;
    const root = pow2(t2, _2n3, P2);
    if (!Fpk1.eql(Fpk1.sqr(root), y2))
      throw new Error("Cannot find square root");
    return root;
  }
  var Fpk1 = Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
  var Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
    Fp: Fpk1,
    endo: secp256k1_ENDO
  });
  var secp256k1 = /* @__PURE__ */ ecdsa(Pointk1, sha256);
  var TAGGED_HASH_PREFIXES = {};
  function taggedHash(tag, ...messages) {
    let tagP = TAGGED_HASH_PREFIXES[tag];
    if (tagP === void 0) {
      const tagH = sha256(asciiToBytes(tag));
      tagP = concatBytes2(tagH, tagH);
      TAGGED_HASH_PREFIXES[tag] = tagP;
    }
    return sha256(concatBytes2(tagP, ...messages));
  }
  var pointToBytes = (point) => point.toBytes(true).slice(1);
  var hasEven = (y2) => y2 % _2n3 === _0n5;
  function schnorrGetExtPubKey(priv) {
    const { Fn: Fn2, BASE } = Pointk1;
    const d_ = Fn2.fromBytes(priv);
    const p = BASE.multiply(d_);
    const scalar = hasEven(p.y) ? d_ : Fn2.neg(d_);
    return { scalar, bytes: pointToBytes(p) };
  }
  function lift_x(x2) {
    const Fp = Fpk1;
    if (!Fp.isValidNot0(x2))
      throw new Error("invalid x: Fail if x \u2265 p");
    const xx = Fp.create(x2 * x2);
    const c = Fp.create(xx * x2 + BigInt(7));
    let y2 = Fp.sqrt(c);
    if (!hasEven(y2))
      y2 = Fp.neg(y2);
    const p = Pointk1.fromAffine({ x: x2, y: y2 });
    p.assertValidity();
    return p;
  }
  var num = bytesToNumberBE;
  function challenge(...args) {
    return Pointk1.Fn.create(num(taggedHash("BIP0340/challenge", ...args)));
  }
  function schnorrGetPublicKey(secretKey) {
    return schnorrGetExtPubKey(secretKey).bytes;
  }
  function schnorrSign(message, secretKey, auxRand = randomBytes(32)) {
    const { Fn: Fn2, BASE } = Pointk1;
    const m = abytes2(message, void 0, "message");
    const { bytes: px, scalar: d } = schnorrGetExtPubKey(secretKey);
    const a = abytes2(auxRand, 32, "auxRand");
    const t = Fn2.toBytes(d ^ num(taggedHash("BIP0340/aux", a)));
    const rand = taggedHash("BIP0340/nonce", t, px, m);
    const k_ = Fn2.create(num(rand));
    if (k_ === 0n)
      throw new Error("sign failed: k is zero");
    const p = BASE.multiply(k_);
    const k2 = hasEven(p.y) ? k_ : Fn2.neg(k_);
    const rx = pointToBytes(p);
    const e19 = challenge(rx, px, m);
    const sig = new Uint8Array(64);
    sig.set(rx, 0);
    sig.set(Fn2.toBytes(Fn2.create(k2 + e19 * d)), 32);
    if (!schnorrVerify(sig, m, px))
      throw new Error("sign: Invalid signature produced");
    return sig;
  }
  function schnorrVerify(signature, message, publicKey) {
    const { Fp, Fn: Fn2, BASE } = Pointk1;
    const sig = abytes2(signature, 64, "signature");
    const m = abytes2(message, void 0, "message");
    const pub = abytes2(publicKey, 32, "publicKey");
    try {
      const P2 = lift_x(num(pub));
      const r = num(sig.subarray(0, 32));
      if (!Fp.isValidNot0(r))
        return false;
      const s = num(sig.subarray(32, 64));
      if (!Fn2.isValidNot0(s))
        return false;
      const e19 = challenge(Fn2.toBytes(r), pointToBytes(P2), m);
      const R2 = BASE.multiplyUnsafe(s).add(P2.multiplyUnsafe(Fn2.neg(e19)));
      const { x: x2, y: y2 } = R2.toAffine();
      if (R2.is0() || !hasEven(y2) || x2 !== r)
        return false;
      return true;
    } catch (error) {
      return false;
    }
  }
  var schnorr = /* @__PURE__ */ (() => {
    const size = 32;
    const seedLength = 48;
    const randomSecretKey = (seed) => {
      seed = seed === void 0 ? randomBytes(seedLength) : seed;
      return mapHashToField(seed, secp256k1_CURVE.n);
    };
    return Object.freeze({
      keygen: createKeygen(randomSecretKey, schnorrGetPublicKey),
      getPublicKey: schnorrGetPublicKey,
      sign: schnorrSign,
      verify: schnorrVerify,
      Point: Pointk1,
      utils: Object.freeze({
        randomSecretKey,
        taggedHash,
        lift_x,
        pointToBytes
      }),
      lengths: Object.freeze({
        secretKey: size,
        publicKey: size,
        publicKeyHasPrefix: false,
        signature: size * 2,
        seed: seedLength
      })
    });
  })();

  // node_modules/@cashu/cashu-ts/node_modules/@noble/hashes/legacy.js
  var Rho160 = /* @__PURE__ */ Uint8Array.from([
    7,
    4,
    13,
    1,
    10,
    6,
    15,
    3,
    12,
    0,
    9,
    5,
    2,
    14,
    11,
    8
  ]);
  var Id160 = /* @__PURE__ */ (() => Uint8Array.from(new Array(16).fill(0).map((_2, i) => i)))();
  var Pi160 = /* @__PURE__ */ (() => Id160.map((i) => (9 * i + 5) % 16))();
  var idxLR = /* @__PURE__ */ (() => {
    const L2 = [Id160];
    const R2 = [Pi160];
    const res = [L2, R2];
    for (let i = 0; i < 4; i++)
      for (let j2 of res)
        j2.push(j2[i].map((k2) => Rho160[k2]));
    return res;
  })();
  var idxL = /* @__PURE__ */ (() => idxLR[0])();
  var idxR = /* @__PURE__ */ (() => idxLR[1])();
  var shifts160 = /* @__PURE__ */ [
    [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8],
    [12, 13, 11, 15, 6, 9, 9, 7, 12, 15, 11, 13, 7, 8, 7, 7],
    [13, 15, 14, 11, 7, 7, 6, 8, 13, 14, 13, 12, 5, 5, 6, 9],
    [14, 11, 12, 14, 8, 6, 5, 5, 15, 12, 15, 14, 9, 9, 8, 6],
    [15, 12, 13, 13, 9, 5, 8, 6, 14, 11, 12, 11, 8, 6, 5, 5]
  ].map((i) => Uint8Array.from(i));
  var shiftsL160 = /* @__PURE__ */ idxL.map((idx, i) => idx.map((j2) => shifts160[i][j2]));
  var shiftsR160 = /* @__PURE__ */ idxR.map((idx, i) => idx.map((j2) => shifts160[i][j2]));
  var Kl160 = /* @__PURE__ */ Uint32Array.from([
    0,
    1518500249,
    1859775393,
    2400959708,
    2840853838
  ]);
  var Kr160 = /* @__PURE__ */ Uint32Array.from([
    1352829926,
    1548603684,
    1836072691,
    2053994217,
    0
  ]);
  function ripemd_f(group, x2, y2, z) {
    if (group === 0)
      return x2 ^ y2 ^ z;
    if (group === 1)
      return x2 & y2 | ~x2 & z;
    if (group === 2)
      return (x2 | ~y2) ^ z;
    if (group === 3)
      return x2 & z | y2 & ~z;
    return x2 ^ (y2 | ~z);
  }
  var BUF_160 = /* @__PURE__ */ new Uint32Array(16);
  var _RIPEMD160 = class extends HashMD {
    constructor() {
      super(64, 20, 8, true);
      __publicField(this, "h0", 1732584193 | 0);
      __publicField(this, "h1", 4023233417 | 0);
      __publicField(this, "h2", 2562383102 | 0);
      __publicField(this, "h3", 271733878 | 0);
      __publicField(this, "h4", 3285377520 | 0);
    }
    get() {
      const { h0, h1, h2, h3, h4 } = this;
      return [h0, h1, h2, h3, h4];
    }
    set(h0, h1, h2, h3, h4) {
      this.h0 = h0 | 0;
      this.h1 = h1 | 0;
      this.h2 = h2 | 0;
      this.h3 = h3 | 0;
      this.h4 = h4 | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4)
        BUF_160[i] = view.getUint32(offset, true);
      let al = this.h0 | 0, ar = al, bl = this.h1 | 0, br = bl, cl = this.h2 | 0, cr = cl, dl = this.h3 | 0, dr = dl, el = this.h4 | 0, er = el;
      for (let group = 0; group < 5; group++) {
        const rGroup = 4 - group;
        const hbl = Kl160[group], hbr = Kr160[group];
        const rl = idxL[group], rr = idxR[group];
        const sl = shiftsL160[group], sr = shiftsR160[group];
        for (let i = 0; i < 16; i++) {
          const tl = rotl(al + ripemd_f(group, bl, cl, dl) + BUF_160[rl[i]] + hbl, sl[i]) + el | 0;
          al = el, el = dl, dl = rotl(cl, 10) | 0, cl = bl, bl = tl;
        }
        for (let i = 0; i < 16; i++) {
          const tr = rotl(ar + ripemd_f(rGroup, br, cr, dr) + BUF_160[rr[i]] + hbr, sr[i]) + er | 0;
          ar = er, er = dr, dr = rotl(cr, 10) | 0, cr = br, br = tr;
        }
      }
      this.set(this.h1 + cl + dr | 0, this.h2 + dl + er | 0, this.h3 + el + ar | 0, this.h4 + al + br | 0, this.h0 + bl + cr | 0);
    }
    roundClean() {
      clean(BUF_160);
    }
    destroy() {
      this.destroyed = true;
      clean(this.buffer);
      this.set(0, 0, 0, 0, 0);
    }
  };
  var ripemd160 = /* @__PURE__ */ createHasher(() => new _RIPEMD160());

  // node_modules/@cashu/cashu-ts/node_modules/@scure/bip32/index.js
  var Point = /* @__PURE__ */ (() => secp256k1.Point)();
  var Fn = /* @__PURE__ */ (() => Point.Fn)();
  var base58check = /* @__PURE__ */ createBase58check(sha256);
  var MASTER_SECRET = /* @__PURE__ */ (() => {
    return Uint8Array.from("Bitcoin seed".split(""), (char) => char.charCodeAt(0));
  })();
  var BITCOIN_VERSIONS = { private: 76066276, public: 76067358 };
  var HARDENED_OFFSET = 2147483648;
  var hash160 = (data) => ripemd160(sha256(data));
  var fromU32 = (data) => createView(data).getUint32(0, false);
  var toU32 = (n) => {
    if (typeof n !== "number")
      throw new TypeError("invalid number, should be from 0 to 2**32-1, got " + n);
    if (!Number.isSafeInteger(n) || n < 0 || n > 2 ** 32 - 1)
      throw new RangeError("invalid number, should be from 0 to 2**32-1, got " + n);
    const buf = new Uint8Array(4);
    createView(buf).setUint32(0, n, false);
    return buf;
  };
  var HDKey = class _HDKey {
    constructor(opt) {
      __publicField(this, "versions");
      __publicField(this, "depth", 0);
      __publicField(this, "index", 0);
      __publicField(this, "chainCode", null);
      __publicField(this, "parentFingerprint", 0);
      __publicField(this, "_privateKey");
      __publicField(this, "_publicKey");
      __publicField(this, "pubHash");
      if (!opt || typeof opt !== "object") {
        throw new Error("HDKey.constructor must not be called directly");
      }
      this.versions = opt.versions || BITCOIN_VERSIONS;
      this.depth = opt.depth || 0;
      this.chainCode = opt.chainCode ? Uint8Array.from(opt.chainCode) : null;
      this.index = opt.index || 0;
      this.parentFingerprint = opt.parentFingerprint || 0;
      if (!this.depth) {
        if (this.parentFingerprint || this.index) {
          throw new Error("HDKey: zero depth with non-zero index/parent fingerprint");
        }
      }
      if (this.depth > 255) {
        throw new Error("HDKey: depth exceeds the serializable value 255");
      }
      if (opt.publicKey && opt.privateKey) {
        throw new Error("HDKey: publicKey and privateKey at same time.");
      }
      if (opt.privateKey) {
        if (!secp256k1.utils.isValidSecretKey(opt.privateKey))
          throw new Error("Invalid private key");
        this._privateKey = Uint8Array.from(opt.privateKey);
        this._publicKey = secp256k1.getPublicKey(this._privateKey, true);
      } else if (opt.publicKey) {
        this._publicKey = Point.fromBytes(opt.publicKey).toBytes(true);
      } else {
        throw new Error("HDKey: no public or private key provided");
      }
      this.pubHash = hash160(this._publicKey);
    }
    get fingerprint() {
      if (!this.pubHash) {
        throw new Error("No publicKey set!");
      }
      return fromU32(this.pubHash);
    }
    get identifier() {
      return this.pubHash;
    }
    get pubKeyHash() {
      return this.pubHash;
    }
    // Returns the live private key buffer for this instance.
    // Copy it first if you need an immutable snapshot.
    get privateKey() {
      return this._privateKey || null;
    }
    get publicKey() {
      return this._publicKey || null;
    }
    get privateExtendedKey() {
      const priv = this._privateKey;
      if (!priv) {
        throw new Error("No private key");
      }
      return base58check.encode(this.serialize(this.versions.private, concatBytes(Uint8Array.of(0), priv)));
    }
    get publicExtendedKey() {
      if (!this._publicKey) {
        throw new Error("No public key");
      }
      return base58check.encode(this.serialize(this.versions.public, this._publicKey));
    }
    static fromMasterSeed(seed, versions = BITCOIN_VERSIONS) {
      abytes(seed);
      if (8 * seed.length < 128 || 8 * seed.length > 512) {
        throw new RangeError("HDKey: seed length must be between 128 and 512 bits; 256 bits is advised, got " + seed.length);
      }
      const I2 = hmac(sha512, MASTER_SECRET, seed);
      const privateKey = I2.slice(0, 32);
      const chainCode = I2.slice(32);
      return new _HDKey({ versions, chainCode, privateKey });
    }
    static fromExtendedKey(base58key, versions = BITCOIN_VERSIONS) {
      const keyBuffer = base58check.decode(base58key);
      const keyView = createView(keyBuffer);
      const version = keyView.getUint32(0, false);
      const opt = {
        versions,
        depth: keyBuffer[4],
        parentFingerprint: keyView.getUint32(5, false),
        index: keyView.getUint32(9, false),
        chainCode: keyBuffer.slice(13, 45)
      };
      const key = keyBuffer.slice(45);
      const isPriv = key[0] === 0;
      if (version !== versions[isPriv ? "private" : "public"]) {
        throw new Error("Version mismatch");
      }
      if (isPriv) {
        return new _HDKey({ ...opt, privateKey: key.slice(1) });
      } else {
        return new _HDKey({ ...opt, publicKey: key });
      }
    }
    static fromJSON(json) {
      return _HDKey.fromExtendedKey(json.xpriv);
    }
    derive(path) {
      if (!/^[mM]'?/.test(path)) {
        throw new Error('Path must start with "m" or "M"');
      }
      if (/^[mM]'?$/.test(path)) {
        return this;
      }
      const parts = path.replace(/^[mM]'?\//, "").split("/");
      let child = this;
      for (const c of parts) {
        const m = /^(\d+)('?)$/.exec(c);
        const m1 = m && m[1];
        if (!m || m.length !== 3 || typeof m1 !== "string")
          throw new Error("invalid child index: " + c);
        let idx = +m1;
        if (!Number.isSafeInteger(idx) || idx >= HARDENED_OFFSET) {
          throw new Error("Invalid index");
        }
        if (m[2] === "'") {
          idx += HARDENED_OFFSET;
        }
        child = child.deriveChild(idx);
      }
      return child;
    }
    /**
     * @param _I - Test-only override for the 64-byte HMAC-SHA512 output; normal callers must omit it.
     */
    deriveChild(index, _I) {
      if (!this._publicKey || !this.chainCode) {
        throw new Error("No publicKey or chainCode set");
      }
      let data = toU32(index);
      if (index >= HARDENED_OFFSET) {
        const priv = this._privateKey;
        if (!priv) {
          throw new Error("Could not derive hardened child key");
        }
        data = concatBytes(Uint8Array.of(0), priv, data);
      } else {
        data = concatBytes(this._publicKey, data);
      }
      const out = _I || hmac(sha512, this.chainCode, data);
      abytes(out, 64);
      const childTweak = out.slice(0, 32);
      const chainCode = out.slice(32);
      const opt = {
        versions: this.versions,
        chainCode,
        depth: this.depth + 1,
        parentFingerprint: this.fingerprint,
        index
      };
      if (opt.depth > 255) {
        throw new Error("HDKey: depth exceeds the serializable value 255");
      }
      try {
        const ctweak = Fn.fromBytes(childTweak);
        if (this._privateKey) {
          const added = Fn.create(Fn.fromBytes(this._privateKey) + ctweak);
          if (!Fn.isValidNot0(added)) {
            throw new Error("The tweak was out of range or the resulted private key is invalid");
          }
          opt.privateKey = Fn.toBytes(added);
        } else {
          const point = Point.fromBytes(this._publicKey);
          const added = ctweak === 0n ? point : point.add(Point.BASE.multiply(ctweak));
          if (added.equals(Point.ZERO)) {
            throw new Error("The tweak was equal to negative P, which made the result key invalid");
          }
          opt.publicKey = added.toBytes(true);
        }
        return new _HDKey(opt);
      } catch (err) {
        return this.deriveChild(index + 1);
      }
    }
    sign(hash) {
      if (!this._privateKey) {
        throw new Error("No privateKey set!");
      }
      abytes(hash, 32);
      return secp256k1.sign(hash, this._privateKey, { prehash: false });
    }
    verify(hash, signature) {
      abytes(hash, 32);
      abytes(signature, 64);
      if (!this._publicKey) {
        throw new Error("No publicKey set!");
      }
      return secp256k1.verify(signature, hash, this._publicKey, { prehash: false });
    }
    wipePrivateData() {
      if (this._privateKey) {
        this._privateKey.fill(0);
        this._privateKey = void 0;
      }
      return this;
    }
    toJSON() {
      return {
        xpriv: this.privateExtendedKey,
        xpub: this.publicExtendedKey
      };
    }
    serialize(version, key) {
      if (!this.chainCode) {
        throw new Error("No chainCode set");
      }
      abytes(key, 33);
      return concatBytes(toU32(version), new Uint8Array([this.depth]), toU32(this.parentFingerprint), toU32(this.index), this.chainCode, key);
    }
  };

  // node_modules/@cashu/cashu-ts/lib/cashu-ts.es.js
  var _ = class e extends Error {
    constructor(t, n) {
      super(t), this.name = "CTSError", n?.cause !== void 0 && Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: n.cause,
        writable: true
      }), Object.setPrototypeOf(this, e.prototype);
    }
  };
  var v = class e2 extends _ {
    constructor(t, n, r) {
      super(t, r), this.status = n, this.name = "HttpResponseError", Object.setPrototypeOf(this, e2.prototype);
    }
  };
  var y = class e3 extends _ {
    constructor(t, n) {
      super(t, n), this.name = "NetworkError", Object.setPrototypeOf(this, e3.prototype);
    }
  };
  var b = class e4 extends v {
    constructor(t, n) {
      super(t, 429), this.retryAfterMs = n, this.name = "RateLimitError", Object.setPrototypeOf(this, e4.prototype);
    }
  };
  var x = class e5 extends v {
    constructor(t, n) {
      super(n || "Unknown mint operation error", 400), this.code = t, this.name = "MintOperationError", Object.setPrototypeOf(this, e5.prototype);
    }
  };
  var S = {
    error() {
    },
    warn() {
    },
    info() {
    },
    debug() {
    },
    trace() {
    },
    log() {
    }
  };
  function C(e19, t = S, n) {
    throw t.error(e19, n), new _(e19);
  }
  function w(e19, t, n = S, r) {
    e19 && C(t, n, r);
  }
  function ee(e19, t, n = S, r) {
    e19 ?? C(t, n, r);
  }
  function T(e19, t, n = S, r) {
    if (e19) try {
      let i = e19(t);
      i && typeof i.then == "function" && i.catch((t2) => {
        try {
          n.warn("callback failed", {
            ...r ?? {},
            error: t2,
            cb: e19.name ?? ""
          });
        } catch {
        }
      });
    } catch (t2) {
      try {
        n.warn("callback failed", {
          ...r ?? {},
          error: t2,
          cb: e19.name ?? ""
        });
      } catch {
      }
    }
  }
  function ne() {
    let e19 = Date.now();
    return { elapsed: () => Date.now() - e19 };
  }
  function re() {
    return globalThis.Buffer;
  }
  var D = class {
    static fromHex(e19) {
      if (e19 = e19.trim(), e19.length === 0) return new Uint8Array();
      if (e19.length < 2 || e19.length & 1) throw new _("Invalid hex string: odd length.");
      if ((e19.startsWith("0x") || e19.startsWith("0X")) && (e19 = e19.slice(2)), !e19.match(/^[0-9a-fA-F]*$/)) throw new _("Invalid hex string: contains non-hex characters");
      let t = e19.match(/.{1,2}/g);
      if (!t) throw new _("Invalid hex string");
      return new Uint8Array(t.map((e20) => parseInt(e20, 16)));
    }
    static toHex(e19) {
      return Array.from(e19, (e20) => e20.toString(16).padStart(2, "0")).join("");
    }
    static fromString(e19) {
      return e19 = e19.trim(), new TextEncoder().encode(e19);
    }
    static toString(e19) {
      return new TextDecoder("utf-8").decode(e19);
    }
    static concat(...e19) {
      let t = e19.reduce((e20, t2) => e20 + t2.length, 0), n = new Uint8Array(t), r = 0;
      for (let t2 of e19) n.set(t2, r), r += t2.length;
      return n;
    }
    static alloc(e19) {
      return new Uint8Array(e19);
    }
    static writeBigUint64BE(e19) {
      let t = /* @__PURE__ */ new ArrayBuffer(8);
      return new DataView(t).setBigUint64(0, e19, false), new Uint8Array(t);
    }
    static toBase64(e19) {
      let t = re();
      if (t) return t.from(e19).toString("base64");
      if (e19.length > 32768) {
        let t2 = "";
        for (let n = 0; n < e19.length; n += 32768) {
          let r = e19.slice(n, n + 32768);
          t2 += btoa(String.fromCharCode(...r));
        }
        return t2;
      }
      return btoa(String.fromCharCode(...e19));
    }
    static fromBase64(e19) {
      e19 = e19.trim();
      let t = e19.replace(/-/g, "+").replace(/_/g, "/");
      for (; t.length % 4; ) t += "=";
      let n = re();
      return n ? new Uint8Array(n.from(t, "base64")) : new Uint8Array([...atob(t)].map((e20) => e20.charCodeAt(0)));
    }
    static equals(e19, t) {
      if (e19.length !== t.length) return false;
      let n = 0;
      for (let r = 0; r < e19.length; r++) n |= e19[r] ^ t[r];
      return n === 0;
    }
    static compare(e19, t) {
      let n = Math.min(e19.length, t.length);
      for (let r = 0; r < n; r++) {
        if (e19[r] < t[r]) return -1;
        if (e19[r] > t[r]) return 1;
      }
      return e19.length - t.length;
    }
    static toBigInt(e19) {
      let t = 0n;
      for (let n of e19) t = t << 8n | BigInt(n);
      return t;
    }
    static fromBigInt(e19) {
      if (e19 < 0n) throw RangeError("value must be non-negative");
      if (e19 === 0n) return new Uint8Array([0]);
      let t = e19, n = 0;
      for (; t > 0n; ) n++, t >>= 8n;
      let r = new Uint8Array(n);
      t = e19;
      for (let e20 = n - 1; e20 >= 0; e20--) r[e20] = Number(t & 255n), t >>= 8n;
      return r;
    }
  };
  var O = class e6 extends _ {
    constructor(t) {
      super(t), this.name = "AmountError", Object.setPrototypeOf(this, e6.prototype);
    }
  };
  var k = class e7 {
    constructor(e19) {
      this.value = e19, Object.freeze(this);
    }
    static from(t) {
      if (t instanceof e7) return t;
      if (typeof t == "bigint") {
        if (t < 0n) throw new O(`Amount must be >= 0, got ${t}`);
        return new e7(t);
      }
      if (typeof t == "number") {
        if (!Number.isFinite(t) || !Number.isInteger(t)) throw new O(`Invalid number amount: ${t}`);
        if (t < 0) throw new O(`Amount must be >= 0, got ${t}`);
        if (!Number.isSafeInteger(t)) throw new O(`Unsafe integer amount: ${t}. Use bigint or decimal string.`);
        return new e7(BigInt(t));
      }
      if (typeof t == "string") {
        if (!/^(0|[1-9]\d*)$/.test(t)) throw new O(`Invalid amount string "${t}". Expected non-negative decimal integer.`);
        return new e7(BigInt(t));
      }
      throw new O("Unsupported amount input type");
    }
    static zero() {
      return new e7(0n);
    }
    static one() {
      return new e7(1n);
    }
    toBigInt() {
      return this.value;
    }
    toNumber() {
      if (!this.isSafeNumber()) throw new O(`Amount ${this.value} exceeds Number.MAX_SAFE_INTEGER; use toBigInt/toString/toJSON.`);
      return Number(this.value);
    }
    toNumberUnsafe() {
      return Number(this.value);
    }
    toString() {
      return this.value.toString(10);
    }
    toJSON() {
      return this.toString();
    }
    add(t) {
      let n = e7.from(t);
      return new e7(this.value + n.value);
    }
    subtract(t) {
      let n = e7.from(t), r = this.value - n.value;
      if (r < 0n) throw new O(`Amount underflow: ${this.value} - ${n.value} would be negative`);
      return new e7(r);
    }
    multiplyBy(t) {
      let n = e7.from(t).value;
      return new e7(this.value * n);
    }
    divideBy(t) {
      let n = e7.from(t).value;
      if (n <= 0n) throw new O(`Divisor must be > 0, got ${n}`);
      return new e7(this.value / n);
    }
    modulo(t) {
      let n = e7.from(t).value;
      if (n <= 0n) throw new O(`Divisor must be > 0, got ${n}`);
      return new e7(this.value % n);
    }
    ceilPercent(e19, t = 100) {
      if (!Number.isInteger(e19) || e19 <= 0) throw new O(`ceilPercent: numerator must be a positive integer, got ${e19}`);
      if (!Number.isInteger(t) || t <= 0) throw new O(`ceilPercent: denominator must be a positive integer, got ${t}`);
      return this.multiplyBy(e19).add(t - 1).divideBy(t);
    }
    floorPercent(e19, t = 100) {
      if (!Number.isInteger(e19) || e19 <= 0) throw new O(`floorPercent: numerator must be a positive integer, got ${e19}`);
      if (!Number.isInteger(t) || t <= 0) throw new O(`floorPercent: denominator must be a positive integer, got ${t}`);
      return this.multiplyBy(e19).divideBy(t);
    }
    inRange(t, n) {
      let r = e7.from(t), i = e7.from(n);
      if (r.greaterThan(i)) throw new O(`inRange: min (${r.toString()}) must be <= max (${i.toString()})`);
      return this.greaterThanOrEqual(r) && this.lessThanOrEqual(i);
    }
    clamp(t, n) {
      let r = e7.from(t), i = e7.from(n);
      if (r.greaterThan(i)) throw new O(`clamp: min (${r.toString()}) must be <= max (${i.toString()})`);
      return e7.max(r, e7.min(i, this));
    }
    scaledBy(t, n) {
      let r = e7.from(t), i = e7.from(n);
      if (r.isZero()) return e7.zero();
      if (i.isZero()) throw new O("scaledBy: denominator must be > 0");
      return this.multiplyBy(r).multiplyBy(2).add(i).divideBy(i.multiplyBy(2));
    }
    isSafeNumber() {
      let e19 = BigInt(2 ** 53 - 1);
      return this.value <= e19;
    }
    isZero() {
      return this.value === 0n;
    }
    equals(t) {
      return this.value === e7.from(t).value;
    }
    compareTo(t) {
      let n = e7.from(t).value;
      return this.value < n ? -1 : +(this.value > n);
    }
    lessThan(e19) {
      return this.compareTo(e19) < 0;
    }
    lessThanOrEqual(e19) {
      return this.compareTo(e19) <= 0;
    }
    greaterThan(e19) {
      return this.compareTo(e19) > 0;
    }
    greaterThanOrEqual(e19) {
      return this.compareTo(e19) >= 0;
    }
    static min(t, n) {
      let r = e7.from(t), i = e7.from(n);
      return r.compareTo(i) <= 0 ? r : i;
    }
    static max(t, n) {
      let r = e7.from(t), i = e7.from(n);
      return r.compareTo(i) >= 0 ? r : i;
    }
    static sum(t) {
      let n = 0n;
      for (let r of t) n += e7.from(r).value;
      return new e7(n);
    }
    withUnit(e19) {
      return new ae(this, e19);
    }
  };
  var ie = class e8 extends _ {
    constructor(t) {
      super(t), this.name = "AmountWithUnitError", Object.setPrototypeOf(this, e8.prototype);
    }
  };
  var ae = class e9 {
    constructor(e19, t) {
      if (typeof t != "string" || t.length === 0) throw new ie("unit required");
      this._amount = e19, this.unit = t, Object.freeze(this);
    }
    static from(t, n) {
      return new e9(k.from(t), n);
    }
    static zero(t) {
      return new e9(k.zero(), t);
    }
    static one(t) {
      return new e9(k.one(), t);
    }
    toAmount() {
      return this._amount;
    }
    toBigInt() {
      return this._amount.toBigInt();
    }
    toNumber() {
      return this._amount.toNumber();
    }
    toString() {
      return `[${this.unit}]: ${this._amount.toString()}`;
    }
    toJSON() {
      return {
        amount: this._amount.toString(),
        unit: this.unit
      };
    }
    [Symbol.toPrimitive](e19) {
      if (e19 === "string") return this.toString();
      throw new ie(`Implicit ${e19 === "number" ? "numeric" : "default"} coercion of AmountWithUnit is unsafe; use .toAmount() then explicit arithmetic, or .toString() for display.`);
    }
    isZero() {
      return this._amount.isZero();
    }
    isSafeNumber() {
      return this._amount.isSafeNumber();
    }
    requireSameUnit(e19) {
      if (this.unit !== e19.unit) throw new ie(`unit mismatch: ${this.unit} vs ${e19.unit}`);
    }
    add(t) {
      return this.requireSameUnit(t), new e9(this._amount.add(t._amount), this.unit);
    }
    subtract(t) {
      return this.requireSameUnit(t), new e9(this._amount.subtract(t._amount), this.unit);
    }
    equals(e19) {
      return this.requireSameUnit(e19), this._amount.equals(e19._amount);
    }
    compareTo(e19) {
      return this.requireSameUnit(e19), this._amount.compareTo(e19._amount);
    }
    lessThan(e19) {
      return this.compareTo(e19) < 0;
    }
    lessThanOrEqual(e19) {
      return this.compareTo(e19) <= 0;
    }
    greaterThan(e19) {
      return this.compareTo(e19) > 0;
    }
    greaterThanOrEqual(e19) {
      return this.compareTo(e19) >= 0;
    }
    inRange(e19, t) {
      return this.requireSameUnit(e19), this.requireSameUnit(t), this._amount.inRange(e19._amount, t._amount);
    }
    clamp(t, n) {
      return this.requireSameUnit(t), this.requireSameUnit(n), new e9(this._amount.clamp(t._amount, n._amount), this.unit);
    }
    multiplyBy(t) {
      return new e9(this._amount.multiplyBy(t), this.unit);
    }
    divideBy(t) {
      return new e9(this._amount.divideBy(t), this.unit);
    }
    modulo(t) {
      return new e9(this._amount.modulo(t), this.unit);
    }
    ceilPercent(t, n) {
      return new e9(this._amount.ceilPercent(t, n), this.unit);
    }
    floorPercent(t, n) {
      return new e9(this._amount.floorPercent(t, n), this.unit);
    }
    scaledBy(t, n) {
      return new e9(this._amount.scaledBy(t, n), this.unit);
    }
    static min(e19, t) {
      return e19.requireSameUnit(t), e19.compareTo(t) <= 0 ? e19 : t;
    }
    static max(e19, t) {
      return e19.requireSameUnit(t), e19.compareTo(t) >= 0 ? e19 : t;
    }
    static sum(t, n) {
      let r = n, i = 0n, a = false;
      for (let e19 of t) {
        if (r === void 0) r = e19.unit;
        else if (e19.unit !== r) throw new ie(`unit mismatch: ${r} vs ${e19.unit}`);
        i += e19._amount.toBigInt(), a = true;
      }
      if (r === void 0) throw new ie("cannot infer unit from empty sum");
      return new e9(a ? k.from(i) : k.zero(), r);
    }
  };
  var A = Object.freeze({
    parse: fe,
    stringify: ge
  });
  var oe;
  function se(e19) {
    return typeof e19 == "object" && !!e19 && !Array.isArray(e19);
  }
  function ce() {
    let e19 = globalThis.BigInt;
    return typeof e19 == "function" ? e19 : void 0;
  }
  function le(e19) {
    if (!oe) {
      let t = e19(String(2 ** 53 - 1));
      oe = {
        max: t,
        min: -t
      };
    }
    return oe;
  }
  var ue = class {
    constructor(e19, t, n, r) {
      this.src = e19, this.strict = t, this.fallbackTo = n, this.bigIntCtor = r, this.i = 0;
    }
    parse() {
      let e19 = this.parseValue();
      if (this.skipWhitespace(), !this.isEnd()) throw this.syntaxError("Unexpected trailing input");
      return e19;
    }
    parseValue() {
      this.skipWhitespace();
      let e19 = this.peek();
      if (e19 === "{") return this.parseObject();
      if (e19 === "[") return this.parseArray();
      if (e19 === '"') return this.parseString();
      if (e19 === "-" || this.isDigit(e19)) return this.parseNumber();
      if (e19 === "t") return this.parseLiteral("true", true);
      if (e19 === "f") return this.parseLiteral("false", false);
      if (e19 === "n") return this.parseLiteral("null", null);
      throw this.syntaxError(`Unexpected token '${e19 || "EOF"}'`);
    }
    parseObject() {
      this.expect("{"), this.skipWhitespace();
      let e19 = {}, t = /* @__PURE__ */ new Set();
      if (this.peek() === "}") return this.expect("}"), e19;
      for (; !this.isEnd(); ) {
        let n = this.parseString();
        if (this.strict && t.has(n)) throw this.syntaxError(`Duplicate key "${n}"`);
        if (t.add(n), this.skipWhitespace(), this.expect(":"), Object.defineProperty(e19, n, {
          value: this.parseValue(),
          writable: true,
          enumerable: true,
          configurable: true
        }), this.skipWhitespace(), this.peek() === "}") return this.expect("}"), e19;
        this.expect(","), this.skipWhitespace();
      }
      throw this.syntaxError("Unterminated object");
    }
    parseArray() {
      this.expect("["), this.skipWhitespace();
      let e19 = [];
      if (this.peek() === "]") return this.expect("]"), e19;
      for (; !this.isEnd(); ) {
        if (e19.push(this.parseValue()), this.skipWhitespace(), this.peek() === "]") return this.expect("]"), e19;
        this.expect(","), this.skipWhitespace();
      }
      throw this.syntaxError("Unterminated array");
    }
    parseString() {
      this.expect('"');
      let e19 = "";
      for (; !this.isEnd(); ) {
        let t = this.next();
        if (t === '"') return e19;
        if (t === "\\") {
          let t2 = this.next();
          switch (t2) {
            case '"':
            case "\\":
            case "/":
              e19 += t2;
              break;
            case "b":
              e19 += "\b";
              break;
            case "f":
              e19 += "\f";
              break;
            case "n":
              e19 += "\n";
              break;
            case "r":
              e19 += "\r";
              break;
            case "t":
              e19 += "	";
              break;
            case "u": {
              let t3 = this.src.slice(this.i, this.i + 4);
              if (!/^[0-9a-fA-F]{4}$/.test(t3)) throw this.syntaxError("Invalid unicode escape");
              this.i += 4, e19 += String.fromCharCode(parseInt(t3, 16));
              break;
            }
            default:
              throw this.syntaxError(`Invalid escape '\\${t2}'`);
          }
          continue;
        }
        if (t < " ") throw this.syntaxError("Invalid control character in string");
        e19 += t;
      }
      throw this.syntaxError("Unterminated string");
    }
    parseNumber() {
      let e19 = this.i;
      this.peek() === "-" && (this.i += 1), this.peek() === "0" ? this.i += 1 : this.readDigits(), this.peek() === "." && (this.i += 1, this.readDigits());
      let t = this.peek();
      if (t === "e" || t === "E") {
        this.i += 1;
        let e20 = this.peek();
        (e20 === "+" || e20 === "-") && (this.i += 1), this.readDigits();
      }
      let n = this.src.slice(e19, this.i);
      if (!(n.indexOf(".") === -1 && n.indexOf("e") === -1 && n.indexOf("E") === -1)) {
        let e20 = Number(n);
        if (!Number.isFinite(e20)) throw this.syntaxError("Bad number");
        return e20;
      }
      if (!this.bigIntCtor) switch (this.fallbackTo) {
        case "number": {
          let e20 = Number(n);
          if (!Number.isFinite(e20)) throw this.syntaxError("Bad number");
          return e20;
        }
        case "string":
          return n;
        case "error":
          throw new _("BigInt is not available in this runtime");
      }
      let r = this.bigIntCtor(n), { max: i, min: a } = le(this.bigIntCtor);
      return r > i || r < a ? r : Number(n);
    }
    parseLiteral(e19, t) {
      if (this.src.slice(this.i, this.i + e19.length) !== e19) throw this.syntaxError(`Unexpected token near '${this.src.slice(this.i, this.i + 8)}'`);
      return this.i += e19.length, t;
    }
    readDigits() {
      let e19 = this.i;
      for (; this.isDigit(this.peek()); ) this.i += 1;
      if (this.i === e19) throw this.syntaxError("Bad number");
    }
    skipWhitespace() {
      for (; !this.isEnd(); ) {
        let e19 = this.peek();
        if (e19 === " " || e19 === "\n" || e19 === "\r" || e19 === "	") {
          this.i += 1;
          continue;
        }
        break;
      }
    }
    expect(e19) {
      if (this.next() !== e19) throw this.syntaxError(`Expected '${e19}'`);
    }
    peek() {
      return this.src.charAt(this.i);
    }
    next() {
      let e19 = this.src.charAt(this.i);
      return this.i += 1, e19;
    }
    isDigit(e19) {
      return e19 >= "0" && e19 <= "9";
    }
    isEnd() {
      return this.i >= this.src.length;
    }
    syntaxError(e19) {
      return /* @__PURE__ */ SyntaxError(`${e19} at position ${this.i}`);
    }
  };
  function de(e19, t, n) {
    let r = e19[t];
    if (Array.isArray(r)) for (let e20 = 0; e20 < r.length; e20 += 1) {
      let t2 = de(r, String(e20), n);
      t2 === void 0 ? Reflect.deleteProperty(r, e20) : r[e20] = t2;
    }
    else if (se(r)) for (let e20 of Object.keys(r)) {
      let t2 = de(r, e20, n);
      t2 === void 0 ? delete r[e20] : r[e20] = t2;
    }
    return n.call(e19, t, r);
  }
  function fe(e19, t, n) {
    let r = n?.strict === true, i = n?.fallbackTo ?? "number";
    if (i !== "number" && i !== "string" && i !== "error") throw new _(`Incorrect value for fallbackTo option, must be "number", "string", "error" or undefined but passed ${String(n?.fallbackTo)}`);
    let a = new ue(String(e19), r, i, ce()).parse();
    return typeof t == "function" ? de({ "": a }, "", t) : a;
  }
  function pe(e19) {
    let t = JSON.stringify(e19);
    if (typeof t != "string") throw new _("Failed to stringify string value");
    return t;
  }
  function me(e19) {
    return typeof e19 == "object" && !!e19 && "toJSON" in e19 && typeof e19.toJSON == "function";
  }
  function he(e19) {
    return e19 instanceof Number || e19 instanceof String || e19 instanceof Boolean ? e19.valueOf() : e19;
  }
  function ge(e19, t, n) {
    let r = "", i = "", a = /* @__PURE__ */ new WeakSet();
    if (typeof n == "number" ? i = " ".repeat(Math.min(10, Math.max(0, Math.floor(n)))) : typeof n == "string" && (i = n), t && typeof t != "function" && !Array.isArray(t)) throw new _("stringify: replacer must be a function or array");
    let o = Array.isArray(t) ? t.map((e20) => String(e20)) : void 0, s = (e20, n2) => {
      let c = e20[n2];
      switch (c instanceof k ? c = c.toBigInt() : me(c) && (c = c.toJSON(n2)), typeof t == "function" && (c = t.call(e20, n2, c)), c = he(c), typeof c) {
        case "string":
          return pe(c);
        case "number":
          return Number.isFinite(c) ? String(c) : "null";
        case "boolean":
          return c ? "true" : "false";
        case "bigint":
          return String(c);
        case "undefined":
          return;
        case "object": {
          if (c === null) return "null";
          if (a.has(c)) throw TypeError("Converting circular structure to JSON");
          a.add(c);
          let e21 = r;
          r += i;
          try {
            if (Array.isArray(c)) {
              let t3 = [], n4 = c;
              for (let e22 = 0; e22 < c.length; e22 += 1) {
                let r2 = s(n4, String(e22));
                t3.push(r2 ?? "null");
              }
              let i3 = t3.length === 0 ? "[]" : r ? `[
${r}${t3.join(`,
${r}`)}
${e21}]` : `[${t3.join(",")}]`;
              return r = e21, i3;
            }
            let t2 = c, n3 = o ?? Object.keys(t2), i2 = [];
            for (let e22 of n3) {
              let n4 = s(t2, e22);
              n4 !== void 0 && i2.push(`${pe(e22)}${r ? ": " : ":"}${n4}`);
            }
            let a2 = i2.length === 0 ? "{}" : r ? `{
${r}${i2.join(`,
${r}`)}
${e21}}` : `{${i2.join(",")}}`;
            return r = e21, a2;
          } finally {
            a.delete(c);
          }
        }
        default:
          return;
      }
    };
    return s({ "": e19 }, "");
  }
  function _e(e19) {
    return D.toBase64(e19).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function ve(e19) {
    return D.toBase64(e19).replace(/\+/g, "-").replace(/\//g, "_");
  }
  function ye(e19) {
    return D.fromBase64(e19);
  }
  function be(e19) {
    let t = D.toString(D.fromBase64(xe(e19)));
    return A.parse(t);
  }
  function xe(e19) {
    return e19.replace(/-/g, "+").replace(/_/g, "/").split("=")[0];
  }
  function Se(e19) {
    if (typeof e19 != "string" || e19.length === 0 || !/^[A-Za-z0-9\-_]+={0,2}$/.test(e19) && !/^[A-Za-z0-9+/]+={0,2}$/.test(e19)) return false;
    let t = e19.replace(/-/g, "+").replace(/_/g, "/"), n = (4 - t.length % 4) % 4;
    if (n > 2) return false;
    let r = t + "=".repeat(n);
    try {
      let e20 = D.fromBase64(r), n2 = D.toBase64(e20), i = n2.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), a = t.replace(/=+$/, "");
      return n2.replace(/=+$/, "") === a || i === a;
    } catch {
      return false;
    }
  }
  function Oe(e19) {
    return typeof e19 == "number" || typeof e19 == "bigint" || typeof e19 == "string";
  }
  function Ve(e19) {
    return He(new DataView(e19.buffer, e19.byteOffset, e19.byteLength), 0).value;
  }
  function He(e19, t) {
    if (t >= e19.byteLength) throw new _("Unexpected end of data");
    let n = e19.getUint8(t++), r = n >> 5, i = n & 31;
    switch (r) {
      case 0:
        return Ue(e19, t, i);
      case 1:
        return We(e19, t, i);
      case 2:
        return Ge(e19, t, i);
      case 3:
        return Ke(e19, t, i);
      case 4:
        return qe(e19, t, i);
      case 5:
        return Je(e19, t, i);
      case 7:
        return Xe(e19, t, i);
      default:
        throw new _(`Unsupported major type: ${r}`);
    }
  }
  function j(e19, t, n) {
    if (t + n > e19.byteLength) throw new _("Unexpected end of data");
  }
  function M(e19, t, n) {
    if (n < 24) return {
      value: n,
      offset: t
    };
    if (n === 24) return j(e19, t, 1), {
      value: e19.getUint8(t++),
      offset: t
    };
    if (n === 25) {
      j(e19, t, 2);
      let n2 = e19.getUint16(t, false);
      return t += 2, {
        value: n2,
        offset: t
      };
    }
    if (n === 26) {
      j(e19, t, 4);
      let n2 = e19.getUint32(t, false);
      return t += 4, {
        value: n2,
        offset: t
      };
    }
    if (n === 27) {
      j(e19, t, 8);
      let n2 = e19.getUint32(t, false), r = e19.getUint32(t + 4, false);
      t += 8;
      let i = n2 * 2 ** 32 + r;
      return i > 2 ** 53 - 1 ? {
        value: BigInt(n2) << 32n | BigInt(r),
        offset: t
      } : {
        value: i,
        offset: t
      };
    }
    throw new _(`Unsupported length: ${n}`);
  }
  function Ue(e19, t, n) {
    let { value: r, offset: i } = M(e19, t, n);
    return {
      value: r,
      offset: i
    };
  }
  function We(e19, t, n) {
    let { value: r, offset: i } = M(e19, t, n);
    if (typeof r == "bigint") return {
      value: -1n - r,
      offset: i
    };
    let a = -1 - r;
    return Number.isSafeInteger(a) ? {
      value: a,
      offset: i
    } : {
      value: -1n - BigInt(r),
      offset: i
    };
  }
  function Ge(e19, t, n) {
    let { value: r, offset: i } = M(e19, t, n), a = Number(r);
    if (i + a > e19.byteLength) throw new _("Byte string length exceeds data length");
    return {
      value: new Uint8Array(e19.buffer, e19.byteOffset + i, a),
      offset: i + a
    };
  }
  function Ke(e19, t, n) {
    let { value: r, offset: i } = M(e19, t, n), a = Number(r);
    if (i + a > e19.byteLength) throw new _("String length exceeds data length");
    let o = new Uint8Array(e19.buffer, e19.byteOffset + i, a);
    return {
      value: new TextDecoder().decode(o),
      offset: i + a
    };
  }
  function qe(e19, t, n) {
    let { value: r, offset: i } = M(e19, t, n), a = Number(r), o = [], s = i;
    for (let t2 = 0; t2 < a; t2++) {
      let t3 = He(e19, s);
      o.push(t3.value), s = t3.offset;
    }
    return {
      value: o,
      offset: s
    };
  }
  function Je(e19, t, n) {
    let { value: r, offset: i } = M(e19, t, n), a = Number(r), o = {}, s = i;
    for (let t2 = 0; t2 < a; t2++) {
      let t3 = He(e19, s);
      if (!Oe(t3.value)) throw new _("Invalid key type");
      let n2 = He(e19, t3.offset);
      o[String(t3.value)] = n2.value, s = n2.offset;
    }
    return {
      value: o,
      offset: s
    };
  }
  function Ye(e19) {
    let t = (e19 & 31744) >> 10, n = e19 & 1023, r = e19 & 32768 ? -1 : 1;
    return t === 0 ? r * 2 ** -14 * (n / 1024) : t === 31 ? n ? NaN : r * Infinity : r * 2 ** (t - 15) * (1 + n / 1024);
  }
  function Xe(e19, t, n) {
    if (n < 24) switch (n) {
      case 20:
        return {
          value: false,
          offset: t
        };
      case 21:
        return {
          value: true,
          offset: t
        };
      case 22:
        return {
          value: null,
          offset: t
        };
      case 23:
        return {
          value: void 0,
          offset: t
        };
      default:
        throw new _(`Unknown simple value: ${n}`);
    }
    if (n === 24) return j(e19, t, 1), {
      value: e19.getUint8(t++),
      offset: t
    };
    if (n === 25) {
      j(e19, t, 2);
      let n2 = Ye(e19.getUint16(t, false));
      return t += 2, {
        value: n2,
        offset: t
      };
    }
    if (n === 26) {
      j(e19, t, 4);
      let n2 = e19.getFloat32(t, false);
      return t += 4, {
        value: n2,
        offset: t
      };
    }
    if (n === 27) {
      j(e19, t, 8);
      let n2 = e19.getFloat64(t, false);
      return t += 8, {
        value: n2,
        offset: t
      };
    }
    throw new _(`Unknown simple or float value: ${n}`);
  }
  var Ze = utf8ToBytes("Secp256k1_HashToCurve_Cashu_");
  function Qe(t) {
    let n = sha256(D.concat(Ze, t)), r = new Uint32Array(1), i = 2 ** 16;
    for (let t2 = 0; t2 < i; t2++) {
      let t3 = new Uint8Array(r.buffer), i2 = sha256(D.concat(n, t3));
      try {
        return N(bytesToHex2(D.concat(new Uint8Array([2]), i2)));
      } catch {
        r[0]++;
      }
    }
    throw new _("No valid point found");
  }
  function $e(e19) {
    let t = e19.map((e20) => e20.toHex(false)).join("");
    return sha256(new TextEncoder().encode(t));
  }
  function N(e19) {
    return secp256k1.Point.fromHex(e19);
  }
  var tt = (e19) => {
    let t;
    return t = /^[a-fA-F0-9]+$/.test(e19) ? Ar(e19) % BigInt(2 ** 31 - 1) : D.toBigInt(ye(e19)) % BigInt(2 ** 31 - 1), t;
  };
  function nt() {
    return secp256k1.utils.randomSecretKey();
  }
  function at(e19, t) {
    let n = Qe(e19);
    if (t === void 0) t = secp256k1.Point.Fn.fromBytes(nt());
    else if (t === 0n) throw new _("Blinding factor r must be non-zero");
    let r = secp256k1.Point.BASE.multiply(t);
    return {
      B_: n.add(r),
      r: t,
      secret: e19
    };
  }
  function ot(e19, t, n) {
    return e19.subtract(n.multiply(t));
  }
  function st(e19, t, n, r) {
    let i = ot(e19.C_, t, r);
    return {
      id: e19.id,
      secret: n,
      C: i
    };
  }
  function P(t, n = false) {
    let r = sha256(new TextEncoder().encode(t));
    return n ? bytesToHex2(r) : r;
  }
  var ct = (t, r) => {
    let i = typeof t == "string" ? hexToBytes2(t) : t, a = typeof r == "string" ? hexToBytes2(r) : r;
    return bytesToHex2(schnorr.sign(i, a));
  };
  var lt = (e19, t) => ct(P(e19), t);
  var ut = (e19, t, r, i = false) => {
    try {
      let i2 = P(t), a = r.length === 66 ? r.slice(2) : r;
      return schnorr.verify(hexToBytes2(e19), i2, hexToBytes2(a));
    } catch (e20) {
      if (i) throw e20;
    }
    return false;
  };
  function dt(t, r) {
    let i = Array.isArray(r) ? r : [r];
    for (let r2 of i) if (bytesToHex2(secp256k1.getPublicKey(hexToBytes2(r2), true)).toLowerCase() === t.toLowerCase()) return r2;
    throw new _(`No private key matches quote pubkey ${t}`);
  }
  function F(e19) {
    let t;
    try {
      t = typeof e19 == "string" ? JSON.parse(e19) : e19;
    } catch (e20) {
      throw new _("Can't parse secret", { cause: e20 });
    }
    if (!Array.isArray(t) || t.length !== 2 || typeof t[0] != "string" || typeof t[1] != "object" || t[0].trim().length === 0 || t[1] === null) throw new _("Invalid NUT-10 secret");
    let [n, r] = t;
    if (typeof r.nonce != "string" || typeof r.data != "string") throw new _("Invalid NUT-10 secret nonce / data");
    if (r.tags) {
      if (!Array.isArray(r.tags)) throw new _("Invalid NUT-10 secret tags");
      if (r.tags.some((e20) => !Array.isArray(e20) || e20.length === 0 || e20.some((e21) => typeof e21 != "string" || !e21.length))) throw new _("Invalid NUT-10 tag(s)");
    }
    return [n, {
      nonce: r.nonce,
      data: r.data,
      tags: r.tags
    }];
  }
  function xt(e19, t) {
    let n = Array.isArray(e19) ? e19 : [e19], r = F(t), i = r[0];
    if (!n.includes(i)) throw new _(`Invalid secret kind: ${i} Allowed: ${n.join(", ")}`);
    return r;
  }
  function St(e19) {
    return F(e19)[0];
  }
  function Ct(e19) {
    return F(e19)[1];
  }
  function wt(e19) {
    let { data: t } = Ct(e19);
    return t;
  }
  function Tt(e19) {
    let { tags: t } = Ct(e19);
    return t ?? [];
  }
  function Dt(e19, t) {
    let n = Tt(e19).find((e20) => e20[0] === t);
    if (!(!n || n.length <= 1)) return n.slice(1);
  }
  function Ot(e19, t) {
    let n = Dt(e19, t);
    return n && n.length > 0 ? n[0] : void 0;
  }
  function kt(e19, t) {
    let n = Ot(e19, t);
    if (n === void 0) return;
    let r = Number.parseInt(n, 10);
    return Number.isFinite(r) ? r : void 0;
  }
  var At = utf8ToBytes("Cashu_P2BK_v1");
  function jt(e19, t) {
    if (!e19.length) return {
      blinded: [],
      Ehex: ""
    };
    t = t ?? secp256k1.utils.randomSecretKey();
    let n = secp256k1.Point.Fn.fromBytes(t), r = secp256k1.getPublicKey(t, true);
    return {
      blinded: e19.map((e20, t2) => {
        let r2 = N(e20), i = Pt(r2, n, t2), a = r2.add(secp256k1.Point.BASE.multiply(i));
        if (a.equals(secp256k1.Point.ZERO)) throw new _("Blinded key at infinity");
        return a.toHex(true);
      }),
      Ehex: bytesToHex(r)
    };
  }
  function Mt(e19, t, n) {
    let r = Array.isArray(t) ? t : [t], i = Array.isArray(n) ? n : [n], a = /* @__PURE__ */ new Set(), o = secp256k1.Point.fromHex(e19);
    for (let e20 of r) {
      let t2 = secp256k1.Point.Fn.fromBytes(hexToBytes(e20)), n2 = secp256k1.getPublicKey(hexToBytes(e20), true);
      i.forEach((r2, i2) => {
        let s = Nt(e20, Pt(o, t2, i2), hexToBytes(r2), n2);
        s && a.add(s);
      });
    }
    return Array.from(a);
  }
  function Nt(e19, t, n, r) {
    let i = secp256k1.Point.CURVE().n, a = typeof e19 == "string" ? Ar(e19) : e19, o = typeof t == "string" ? Ar(t) : t;
    if (a <= 0n || a >= i) throw new _("Invalid private key");
    if (o <= 0n || o >= i) throw new _("Invalid scalar r");
    if (r = r ?? secp256k1.Point.BASE.multiply(a).toBytes(true), r.length !== 33) throw new _("naturalPub must be 33 bytes");
    let s = (a + o) % i, c = (i - a + o) % i;
    if (!n) {
      if (s === 0n) throw new _("Derived secret key is zero");
      return jr(s);
    }
    if (n.length !== 33) throw new _("blindPubkey must be 33 bytes");
    let d = secp256k1.Point.fromHex(bytesToHex(n)), f = secp256k1.Point.BASE.multiply(o), p = d.subtract(f);
    if (p.equals(secp256k1.Point.ZERO)) return null;
    let m = p.toBytes(true).slice(1), h = r.slice(1);
    if (!D.equals(m, h)) return null;
    let g = (p.toBytes(true)[0] & 1) == (r[0] & 1) ? s : c;
    if (g === 0n) throw new _("Derived secret key is zero");
    return jr(g);
  }
  function Pt(e19, t, n) {
    let r = e19.multiply(t).toBytes(true).slice(1), i = new Uint8Array([n & 255]), o = D.toBigInt(sha256(D.concat(At, r, i)));
    if ((o === 0n || o >= secp256k1.Point.CURVE().n) && (o = D.toBigInt(sha256(D.concat(At, r, i, new Uint8Array([255])))), o === 0n || o >= secp256k1.Point.CURVE().n)) throw new _("P2BK: tweak derivation failed");
    return o;
  }
  var Ft = {
    SIG_INPUTS: "SIG_INPUTS",
    SIG_ALL: "SIG_ALL"
  };
  var It = new Set(Object.values(Ft));
  var Lt = /* @__PURE__ */ new Set([
    "locktime",
    "pubkeys",
    "n_sigs",
    "refund",
    "n_sigs_refund",
    "sigflag"
  ]);
  function I(e19) {
    let t = xt(["P2PK", "HTLC"], e19);
    en(Tt(t));
    let n = Ot(t, "sigflag");
    return n !== void 0 && tn(n), t;
  }
  function zt(e19) {
    let t = e19.toLowerCase();
    if (t.length === 66 && (t.startsWith("02") || t.startsWith("03"))) return t;
    if (t.length === 64) return `02${t}`;
    throw new _(`Invalid pubkey, expected 33 byte compressed or 32 byte x only, got length ${t.length}`);
  }
  function L(e19) {
    let t = /* @__PURE__ */ new Set(), n = [];
    for (let r of e19) {
      let e20 = zt(r), i = e20.slice(-64);
      t.has(i) || (t.add(i), n.push(e20));
    }
    return n;
  }
  function Bt(e19) {
    let t = L(Array.isArray(e19.pubkey) ? e19.pubkey : [e19.pubkey]), n = L(e19.refundKeys ?? []);
    if (t.length === 0) throw new _("P2PK requires at least one pubkey");
    let r = t.length + n.length;
    if (r > 10) throw new _(`Too many pubkeys, ${r} provided, maximum allowed is 10 in total`);
    e19.sigFlag !== void 0 && tn(e19.sigFlag);
    let i = e19.requiredSignatures ?? 1, a = e19.requiredRefundSignatures;
    return rn({
      mainKeyCount: t.length,
      refundKeyCount: n.length,
      nSigs: i,
      nSigsRefund: a,
      hasLocktime: e19.locktime !== void 0
    }), {
      pubkey: t.length === 1 ? t[0] : t,
      ...e19.locktime === void 0 ? {} : { locktime: e19.locktime },
      ...n.length > 0 ? { refundKeys: n } : {},
      ...i > 1 ? { requiredSignatures: i } : {},
      ...a !== void 0 && a > 1 ? { requiredRefundSignatures: a } : {},
      ...e19.additionalTags?.length ? { additionalTags: e19.additionalTags } : {},
      ...e19.blindKeys ? { blindKeys: true } : {},
      ...e19.sigFlag === void 0 ? {} : { sigFlag: e19.sigFlag },
      ...e19.hashlock ? { hashlock: e19.hashlock } : {}
    };
  }
  function Vt(e19) {
    let t = I(e19), n = cn(sn(t)), r = an(t), i = on(t);
    return n === "ACTIVE" || n === "PERMANENT" ? r : n === "EXPIRED" && i.length ? Array.from(/* @__PURE__ */ new Set([...r, ...i])) : [];
  }
  function Ht(e19) {
    return Ot(I(e19), "sigflag") ?? "SIG_INPUTS";
  }
  function Ut(e19) {
    return Wt(e19)?.signatures ?? [];
  }
  function Wt(e19) {
    if (!e19) return;
    let t;
    try {
      t = typeof e19 == "string" ? JSON.parse(e19) : e19;
    } catch (e20) {
      console.error("Failed to parse witness string:", e20);
      return;
    }
    let n = { signatures: t.signatures ?? [] };
    return typeof t.preimage == "string" && t.preimage.length > 0 && (n.preimage = t.preimage), n;
  }
  function Gt(t, n, r = S, i) {
    let a = (t2) => typeof t2 == "string" ? t2 : bytesToHex2(t2), o = Array.isArray(n) ? n.map(a) : a(n);
    return t.map((e19, t2) => {
      let n2 = Xt(o, e19), a2 = e19;
      for (let e20 of n2) try {
        a2 = Kt(a2, e20, i);
      } catch (e21) {
        let n3 = e21 instanceof Error ? e21.message : "Unknown error";
        r.warn(`Proof #${t2 + 1}: ${n3}`);
      }
      return a2;
    });
  }
  function Kt(t, r, i) {
    let a = I(t.secret);
    i = i ?? t.secret;
    let o = typeof r == "string" ? hexToBytes2(r) : r, s = bytesToHex2(schnorr.getPublicKey(o)), l = Vt(a);
    if (!l.length || !l.some((e19) => e19.includes(s))) throw new _(`Signature not required from [02|03]${s}`);
    if (Ut(t.witness).some((e19) => ut(e19, i, s))) throw new _(`Proof already signed by [02|03]${s}`);
    let u = lt(i, r), d = Wt(t.witness), f = {
      ...d && d.preimage !== void 0 ? { preimage: d.preimage } : {},
      signatures: [...d?.signatures ?? [], u]
    };
    return {
      ...t,
      witness: f
    };
  }
  function Xt(e19, t) {
    let n = Array.isArray(e19) ? e19 : [e19], r = t?.p2pk_e;
    if (!r) return Array.from(new Set(n));
    let i = I(t.secret);
    return Mt(r, n, [...an(i), ...on(i)]);
  }
  function Zt(e19) {
    if (e19.length === 0) throw new _("No proofs");
    let t = I(e19[0].secret);
    if (Ht(t) !== "SIG_ALL") throw new _("First proof is not SIG_ALL");
    let n = t[1].data, r = JSON.stringify(t[1].tags ?? []);
    for (let i = 1; i < e19.length; i++) {
      let a = I(e19[i].secret);
      if (a[0] !== t[0]) throw new _(`Proof #${i + 1} is not ${t[0]}`);
      if (Ht(a) !== "SIG_ALL") throw new _(`Proof #${i + 1} is not SIG_ALL`);
      if (a[1].data !== n) throw new _("SIG_ALL inputs must share identical Secret.data");
      if (JSON.stringify(a[1].tags ?? []) !== r) throw new _("SIG_ALL inputs must share identical Secret.tags");
    }
  }
  function Qt(e19, t, n) {
    let r = [];
    for (let t2 of e19) r.push(t2.secret, t2.C);
    for (let e20 of t) r.push(String(e20.blindedMessage.amount), e20.blindedMessage.B_);
    return n && r.push(n), r.join("");
  }
  function $t(e19) {
    return e19.some((e20) => {
      try {
        return Ht(e20.secret) === "SIG_ALL";
      } catch {
        return false;
      }
    });
  }
  function en(e19) {
    let t = /* @__PURE__ */ new Set();
    for (let n of e19) {
      let e20 = n[0];
      if (Lt.has(e20)) {
        if (t.has(e20)) throw new _(`Duplicate P2PK tag "${e20}"`);
        t.add(e20);
      }
    }
  }
  function tn(e19) {
    if (!It.has(e19)) throw new _(`Invalid sigflag "${e19}": must be "SIG_INPUTS" or "SIG_ALL"`);
  }
  function nn(e19, t) {
    if (!Number.isInteger(e19) || e19 < 1) throw new _(`${t} must be a positive integer, got ${e19}`);
    return e19;
  }
  function rn(e19) {
    let { mainKeyCount: t, refundKeyCount: n, nSigs: r, nSigsRefund: i, hasLocktime: a } = e19;
    if (r !== void 0 && (nn(r, "requiredSignatures (n_sigs)"), r > t)) throw new _(`requiredSignatures (n_sigs) (${r}) exceeds available pubkeys (${t})`);
    if (i !== void 0) {
      if (nn(i, "requiredRefundSignatures (n_sigs_refund)"), n === 0) throw new _("requiredRefundSignatures (n_sigs_refund) requires refund keys");
      if (i > n) throw new _(`requiredRefundSignatures (n_sigs_refund) (${i}) exceeds available refund keys (${n})`);
    }
    if (n > 0 && !a) throw new _("refund keys require a locktime");
  }
  function an(e19) {
    let t = St(e19) === "P2PK" ? wt(e19) : "", n = Dt(e19, "pubkeys") ?? [], r = (t ? [t, ...n] : n).map((e20) => zt(e20));
    if (L(r).length !== r.length) throw new _("Duplicate main pubkeys are not allowed");
    return r;
  }
  function on(e19) {
    let t = (Dt(e19, "refund") ?? []).map((e20) => zt(e20));
    if (L(t).length !== t.length) throw new _("Duplicate refund pubkeys are not allowed");
    return t;
  }
  function sn(e19) {
    let t = kt(e19, "locktime");
    return t === void 0 || !Number.isFinite(t) || t <= 0 ? Infinity : t;
  }
  function cn(e19, t = Math.floor(Date.now() / 1e3)) {
    return Number.isFinite(e19) ? t < e19 ? "ACTIVE" : "EXPIRED" : "PERMANENT";
  }
  function dn(e19, t, n) {
    let r = [];
    for (let t2 of e19) r.push(t2.secret);
    for (let e20 of t) r.push(e20.blindedMessage.B_);
    return n && r.push(n), r.join("");
  }
  var fn = utf8ToBytes("Cashu_DLEQ_R_v1");
  var pn = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
  var hn = (e19, t, n, r) => {
    let i = secp256k1.Point.Fn.fromBytes(e19.s), a = secp256k1.Point.Fn.fromBytes(e19.e), o = secp256k1.Point.BASE.multiply(i), s = r.multiply(a), c = t.multiply(i), u = n.multiply(a), d = $e([
      o.subtract(s),
      c.subtract(u),
      r,
      n
    ]);
    return D.equals(d, e19.e);
  };
  var gn = (e19, t, n, r) => {
    if (t.r === void 0) throw new _("verifyDLEQProof_reblind: Undefined blinding factor");
    let i = Qe(e19), a = n.add(r.multiply(t.r)), o = secp256k1.Point.BASE.multiply(t.r);
    return hn(t, i.add(o), a, r);
  };
  var vn = "m/129372'/0'";
  var yn = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
  var R = /* @__PURE__ */ (function(e19) {
    return e19[e19.SECRET = 0] = "SECRET", e19[e19.BLINDING_FACTOR = 1] = "BLINDING_FACTOR", e19;
  })(R || {});
  var bn = /* @__PURE__ */ (function(e19) {
    return e19[e19.DEPRECATED_BIP32 = 0] = "DEPRECATED_BIP32", e19[e19.HMAC_SHA256 = 1] = "HMAC_SHA256", e19;
  })(bn || {});
  function Cn(e19, t, n) {
    return wn(e19, t)(n);
  }
  function wn(e19, t) {
    switch (Tn(t)) {
      case bn.DEPRECATED_BIP32: {
        let n = HDKey.fromMasterSeed(e19);
        return (e20) => En(n, t, e20);
      }
      case bn.HMAC_SHA256:
        return (n) => Dn(e19, t, n);
    }
  }
  function Tn(e19) {
    let t = /^[a-fA-F0-9]+$/.test(e19);
    if (!t && Se(e19) || t && e19.startsWith("00")) return bn.DEPRECATED_BIP32;
    if (t && e19.startsWith("01")) return bn.HMAC_SHA256;
    throw new _(`Unrecognized keyset ID version ${e19.slice(0, 2)}`);
  }
  function En(e19, t, n) {
    let r = `${vn}/${tt(t)}'/${n}'`, i = e19.derive(r), a = i.deriveChild(0).privateKey, o = i.deriveChild(1).privateKey;
    if (a === null || o === null) throw new _("Could not derive private key");
    return {
      secret: a,
      blindingFactor: o
    };
  }
  function Dn(e19, t, n) {
    return {
      secret: On(e19, t, n, R.SECRET),
      blindingFactor: On(e19, t, n, R.BLINDING_FACTOR)
    };
  }
  function On(e19, t, n, i) {
    let o = D.concat(D.fromString("Cashu_KDF_HMAC_SHA256"), D.fromHex(t), D.writeBigUint64BE(BigInt(n)));
    switch (i) {
      case R.SECRET:
        o = D.concat(o, D.fromHex("00"));
        break;
      case R.BLINDING_FACTOR:
        o = D.concat(o, D.fromHex("01"));
    }
    let s = hmac(sha256, e19, o);
    if (i === R.BLINDING_FACTOR) {
      let e20 = D.toBigInt(s), t2 = e20 >= yn ? e20 - yn : e20;
      if (t2 === 0n) throw new _("Derived invalid blinding scalar r == 0");
      return numberToBytesBE(t2, 32);
    }
    return s;
  }
  function In(e19, t) {
    let n = e19;
    for (let e20 of t) n += e20.B_;
    return sha256(new TextEncoder().encode(n));
  }
  function Ln(e19, t, n) {
    let r = In(t, n), i = hexToBytes(e19);
    return bytesToHex(schnorr.sign(r, i));
  }
  function H(e19, t, n, r) {
    let i = kr(e19, "splitAmount.value", true), a = n?.map((e20) => kr(e20, "splitAmount.split", true));
    if (a) {
      let e20 = k.sum(a);
      if (i.isZero() && e20.isZero()) return a;
      let n2 = a.filter((e21) => !e21.isZero()), r2 = k.sum(n2);
      if (r2.greaterThan(i)) throw new _(`Split is greater than total amount: ${r2.toString()} > ${i.toString()}`);
      if (n2.some((e21) => !Or(e21, t))) throw new _("Provided amount preferences do not match the amounts of the mint keyset.");
      if (r2.equals(i)) return n2;
      a = n2, i = i.subtract(r2);
    } else a = [];
    let o = Dr(t, "desc");
    if (o.length === 0) throw new _("Cannot split amount, keyset is inactive or contains no keys");
    for (let e20 of o) {
      if (e20.isZero()) continue;
      let t2 = i.divideBy(e20).toNumber();
      if (a.push(...Array(t2).fill(e20)), i = i.subtract(e20.multiplyBy(t2)), i.isZero()) break;
    }
    if (!i.isZero()) throw new _(`Unable to split remaining amount: ${i.toString()}`);
    return r && (a = a.sort((e20, t2) => r === "desc" ? t2.compareTo(e20) : e20.compareTo(t2))), a;
  }
  function Dr(e19, t) {
    let n = Object.keys(e19).map((e20) => k.from(e20));
    return n.sort((e20, n2) => t === "desc" ? n2.compareTo(e20) : e20.compareTo(n2)), n;
  }
  function Or(e19, t) {
    return kr(e19, "hasCorrespondingKey.amount", true).toString() in t;
  }
  function kr(e19, t, n = false) {
    let r = k.from(e19);
    if (!n && r.isZero()) throw new _(`Amount must be positive: ${r.toString()}, op: ${t}`);
    return r;
  }
  function Ar(e19) {
    return e19 ? BigInt(`0x${e19}`) : 0n;
  }
  function jr(e19) {
    return e19.toString(16).padStart(64, "0");
  }
  function U(e19) {
    return /^[a-f0-9]+$/i.test(e19);
  }
  function Rr(t) {
    let n = [];
    t.t.forEach((t2) => t2.p.forEach((r2) => {
      n.push({
        secret: r2.s,
        C: bytesToHex2(r2.c),
        amount: k.from(r2.a),
        id: bytesToHex2(t2.i),
        ...r2.d && { dleq: {
          r: bytesToHex2(r2.d.r),
          s: bytesToHex2(r2.d.s),
          e: bytesToHex2(r2.d.e)
        } },
        ...r2.pe && { p2pk_e: bytesToHex2(r2.pe) },
        ...r2.w && { witness: r2.w }
      });
    }));
    let r = {
      mint: t.m,
      proofs: n,
      unit: t.u || "sat"
    };
    return t.d && (r.memo = t.d), r;
  }
  function zr(e19, t) {
    let n = Vr(ti(e19));
    return n.proofs = Xr(n.proofs, t), n;
  }
  function Vr(e19) {
    let t = e19.slice(0, 1), n = e19.slice(1);
    if (t === "A") {
      let e20 = be(n);
      if (e20.token.length > 1) throw new _("Multi entry token are not supported");
      let t2 = e20.token[0], r = t2.proofs.map((e21) => ({
        ...e21,
        amount: k.from(e21.amount)
      })), i = {
        mint: t2.mint,
        proofs: r,
        unit: e20.unit || "sat"
      };
      return e20.memo && (i.memo = e20.memo), i;
    } else if (t === "B") return Rr(Ve(ye(n)));
    throw new _("Token version is not supported");
  }
  function Hr(e19, t) {
    let r = t?.unit ?? "sat", i = t?.expiry, o = t?.versionByte ?? 1, s = t?.input_fee_ppk;
    if (t?.isDeprecatedBase64 ?? false) {
      let t2 = Object.entries(e19).sort(([e20], [t3]) => k.from(e20).compareTo(t3)).map(([, e20]) => e20).reduce((e20, t3) => e20 + t3, ""), n = sha256(D.fromString(t2));
      return D.toBase64(n).slice(0, 12);
    }
    switch (o) {
      case 0: {
        let t2 = sha256(Ur(...Object.entries(e19).sort(([e20], [t3]) => k.from(e20).compareTo(t3)).map(([, e20]) => hexToBytes2(e20))));
        return "00" + D.toHex(t2).slice(0, 14);
      }
      case 1: {
        if (!r) throw new _("Cannot compute keyset ID version 01: unit is required.");
        let t2 = Object.entries(e19).sort(([e20], [t3]) => k.from(e20).compareTo(t3)).map(([e20, t3]) => `${e20}:${t3}`).join(",");
        t2 += `|unit:${r}`, s && (t2 += `|input_fee_ppk:${s}`), i && (t2 += `|final_expiry:${i}`);
        let n = sha256(D.fromString(t2));
        return "01" + D.toHex(n);
      }
      default:
        throw new _(`Unrecognized keyset ID version: ${o}`);
    }
  }
  function Ur(...e19) {
    let t = e19.reduce((e20, t2) => e20 + t2.length, 0), n = new Uint8Array(t), r = 0;
    for (let t2 of e19) n.set(t2, r), r += t2.length;
    return n;
  }
  function W(e19) {
    return typeof e19 == "object" && !!e19;
  }
  function G(e19, ...t) {
    for (let n of t) e19[n] === void 0 && (e19[n] = null);
  }
  function K(...e19) {
    return e19.map((e20) => e20.replace(/(^\/+|\/+$)/g, "")).join("/");
  }
  function Gr(e19) {
    let t;
    try {
      t = new URL(e19);
    } catch (t2) {
      throw new _(`Invalid mint URL: ${e19}`, { cause: t2 });
    }
    if (t.protocol !== "http:" && t.protocol !== "https:") throw new _(`Invalid mint URL scheme: ${t.protocol}`);
    if (t.username || t.password) throw new _("Mint URL must not contain credentials");
    if (t.search || t.href.includes("?")) throw new _("Mint URL must not contain query parameters");
    if (t.hash || t.href.includes("#")) throw new _("Mint URL must not contain a fragment");
    if (/%[0-9a-f]{2}/i.test(t.pathname)) throw new _("Mint URL path must not contain percent-encoded characters");
    return t.href.replace(/\/+$/, "");
  }
  function q(e19) {
    return k.sum(e19.map((e20) => e20.amount));
  }
  function J(e19) {
    return e19.map((e20) => ({
      ...e20,
      amount: k.from(e20.amount)
    }));
  }
  function Xr(e19, t) {
    let r = [...new Set(t.map((e20) => e20.toLowerCase()))], i = [];
    for (let t2 of e19) {
      let e20;
      try {
        e20 = hexToBytes2(t2.id);
      } catch {
        i.push(t2);
        continue;
      }
      if (e20[0] === 0) i.push(t2);
      else if (e20[0] === 1) {
        if (!r.length) throw new _("A short keyset ID v2 was encountered, but got no keysets to map it to.");
        let e21 = t2.id.toLowerCase(), n = r.filter((t3) => e21 === t3.slice(0, e21.length));
        if (n.length > 1) throw new _(`Short keyset ID ${t2.id} is ambiguous.`);
        if (n.length === 0) throw new _(`Couldn't map short keyset ID ${t2.id} to any known keysets of the current Mint`);
        t2.id = n[0], i.push(t2);
      } else throw new _(`Unknown keyset ID version: ${e20[0]}`);
    }
    return i;
  }
  function Zr(e19, t, r) {
    let i = r?.require ?? true;
    if (e19?.dleq == null) return !i;
    if (!Or(e19.amount, t.keys)) throw new _(`Undefined key for amount ${e19.amount.toString()} in keyset ${t.id}`);
    let a = t.keys[e19.amount.toString()];
    try {
      let t2 = {
        e: hexToBytes2(e19.dleq.e),
        s: hexToBytes2(e19.dleq.s),
        r: Ar(e19.dleq.r ?? "00")
      };
      return gn(new TextEncoder().encode(e19.secret), t2, N(e19.C), N(a));
    } catch {
      return false;
    }
  }
  function Qr(e19, t) {
    return Zr(e19, t, { require: false });
  }
  function ti(e19) {
    for (let t of [
      "web+cashu://",
      "cashu://",
      "cashu:"
    ]) if (e19.startsWith(t)) {
      e19 = e19.slice(t.length);
      break;
    }
    return e19.startsWith("cashu") && (e19 = e19.slice(5)), e19;
  }
  function ni(e19) {
    return /^ln[a-z]{2,}[1-9][0-9]*(?:[mun]|0p)?1/i.test(e19);
  }
  function Y(e19, t, n) {
    if (e19 == null) {
      if (arguments.length >= 3) return n;
      throw new _(`Invalid ${t}: missing value`);
    }
    try {
      return k.from(e19).toNumber();
    } catch (e20) {
      throw new _(`Invalid ${t}: ${e20 instanceof Error ? e20.message : String(e20)}`, { cause: e20 });
    }
  }
  function ri(e19) {
    return {
      ...e19,
      input_fee_ppk: Y(e19.input_fee_ppk, "keyset.input_fee_ppk", void 0),
      final_expiry: Y(e19.final_expiry, "keyset.final_expiry", void 0)
    };
  }
  function ii(e19) {
    return {
      ...e19,
      input_fee_ppk: Y(e19.input_fee_ppk, "keys.input_fee_ppk", void 0),
      final_expiry: Y(e19.final_expiry, "keys.final_expiry", void 0)
    };
  }
  var ai = class e10 {
    static fromMintInfo(t, n) {
      let r = t?.nuts?.["21"];
      if (!r?.openid_discovery) throw new _("OIDCAuth: mint does not advertise NUT-21 openid_discovery");
      let i = n?.clientId ?? r.client_id ?? "cashu-client";
      return new e10(r.openid_discovery, {
        ...n,
        clientId: i
      });
    }
    constructor(e19, t) {
      this.tokenListeners = [], this.discoveryUrl = e19, this.logger = t?.logger ?? S, this.clientId = t?.clientId ?? "cashu-client", this.scope = t?.scope ?? "openid", this.onTokens = t?.onTokens;
    }
    setClient(e19) {
      this.clientId = e19;
    }
    setScope(e19) {
      this.scope = e19 ?? "openid";
    }
    addTokenListener(e19) {
      this.tokenListeners.push(e19);
    }
    async loadConfig() {
      if (this.config) return this.config;
      let e19 = await fetch(this.discoveryUrl, {
        method: "GET",
        headers: { Accept: "application/json" }
      }), t = await e19.text(), n, r;
      try {
        n = t ? JSON.parse(t) : void 0;
      } catch (e20) {
        r = e20, this.logger.warn("OIDCAuth: bad discovery JSON", { err: e20 });
      }
      if (!e19.ok || !n) throw new _("OIDCAuth: invalid discovery document", { cause: r });
      let i = n;
      if (typeof i.token_endpoint != "string" || i.token_endpoint.length === 0) throw new _("OIDCAuth: invalid discovery document, missing token_endpoint");
      return this.config = i, i;
    }
    generatePKCE() {
      let e19 = _e(randomBytes2(48));
      return {
        verifier: e19,
        challenge: _e(sha256(D.fromString(e19)))
      };
    }
    async buildAuthCodeUrl(e19) {
      let t = await this.loadConfig(), n = e19.scope ?? this.scope, r = new URLSearchParams({
        response_type: "code",
        client_id: this.clientId,
        redirect_uri: e19.redirectUri,
        scope: n,
        code_challenge_method: e19.codeChallengeMethod ?? "S256",
        code_challenge: e19.codeChallenge
      });
      if (e19.state && r.set("state", e19.state), !t.authorization_endpoint) throw new _("OIDCAuth: discovery lacks authorization_endpoint");
      return `${t.authorization_endpoint}?${r.toString()}`;
    }
    async exchangeAuthCode(e19) {
      let t = await this.loadConfig(), n = this.toForm({
        grant_type: "authorization_code",
        code: e19.code,
        redirect_uri: e19.redirectUri,
        client_id: this.clientId,
        code_verifier: e19.codeVerifier
      }), r = await this.postFormStrict(t.token_endpoint, n);
      return this.handleTokens(r), r;
    }
    async deviceStart() {
      let e19 = (await this.loadConfig()).device_authorization_endpoint;
      if (!e19) throw new _("OIDCAuth: provider lacks device_authorization_endpoint");
      let t = this.toForm({
        client_id: this.clientId,
        scope: this.scope
      });
      return this.postFormStrict(e19, t);
    }
    async devicePoll(e19, t = 5) {
      let n = await this.loadConfig(), r = Math.max(1, t);
      for (; ; ) {
        await this.sleep(r * 1e3);
        let t2 = this.toForm({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: e19,
          client_id: this.clientId
        }), i = await this.postFormLoose(n.token_endpoint, t2);
        if (i.access_token) return this.handleTokens(i), i;
        let a = (i.error ?? "").toString();
        if (a !== "authorization_pending") {
          if (a === "slow_down") {
            r = Math.max(r + 5, r * 2);
            continue;
          }
          throw new _(`OIDCAuth: ${i.error_description || a || "device authorization failed"}`);
        }
      }
    }
    async startDeviceAuth(e19 = 5) {
      let t = await this.deviceStart(), n = Math.max(t.interval ?? 1, e19), r = false, i = async () => {
        let e20 = await this.loadConfig(), i2 = Math.max(1, n);
        for (; ; ) {
          if (r) throw new _("OIDCAuth: device polling cancelled");
          await this.sleep(i2 * 1e3);
          let n2 = this.toForm({
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            device_code: t.device_code,
            client_id: this.clientId
          }), a2 = await this.postFormLoose(e20.token_endpoint, n2);
          if (a2.access_token) return this.handleTokens(a2), a2;
          let o = (a2.error ?? "").toString();
          if (o !== "authorization_pending") {
            if (o === "slow_down") {
              i2 = Math.max(i2 + 5, i2 * 2);
              continue;
            }
            throw new _(`OIDCAuth: ${a2.error_description || o || "device authorization failed"}`);
          }
        }
      }, a = () => {
        r = true;
      };
      return {
        ...t,
        poll: i,
        cancel: a
      };
    }
    async refresh(e19) {
      let t = await this.loadConfig(), n = this.toForm({
        grant_type: "refresh_token",
        refresh_token: e19,
        client_id: this.clientId
      }), r = await this.postFormStrict(t.token_endpoint, n);
      return this.handleTokens(r), r;
    }
    async passwordGrant(e19, t) {
      let n = await this.loadConfig(), r = this.toForm({
        grant_type: "password",
        client_id: this.clientId,
        username: e19,
        password: t,
        scope: this.scope
      }), i = await this.postFormStrict(n.token_endpoint, r);
      return this.handleTokens(i), i;
    }
    handleTokens(e19) {
      if (!e19.access_token) throw new _(`OIDCAuth: ${e19.error_description || e19.error || "token response missing access_token"}`);
      queueMicrotask(() => T(this.onTokens, e19, this.logger, { where: "OIDCAuth.handleTokens" }));
      for (let t of this.tokenListeners) queueMicrotask(() => T(t, e19, this.logger, { where: "OIDCAuth.handleTokens.listener" }));
    }
    toForm(e19) {
      let t = (e20) => encodeURIComponent(e20).replace(/%20/g, "+");
      return Object.entries(e19).map(([e20, n]) => `${t(e20)}=${t(n)}`).join("&");
    }
    async postFormStrict(e19, t) {
      try {
        this.logger.debug("OIDCAuth Request", { formBody: t });
        let n = await fetch(e19, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: t
        }), r = await n.text(), i, a;
        try {
          i = r ? JSON.parse(r) : void 0;
        } catch (e20) {
          a = e20, this.logger.warn("OIDCAuth: bad JSON (strict)", { err: e20 });
        }
        if (!n.ok) {
          let e20 = i ?? {};
          throw new _(`OIDCAuth: ${e20.error_description || e20.error || `HTTP ${n.status}`}`, { cause: a });
        }
        return this.logger.debug("OIDCAuth Response", { json: i }), i ?? {};
      } catch (e20) {
        throw this.logger.error("OIDCAuth: postFormStrict failed", { err: e20 }), e20;
      }
    }
    async postFormLoose(e19, t) {
      try {
        this.logger.debug("OIDCAuth Request", { formBody: t });
        let n = await (await fetch(e19, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json"
          },
          body: t
        })).text(), r;
        try {
          r = n ? JSON.parse(n) : void 0;
        } catch (e20) {
          this.logger.warn("OIDCAuth: bad JSON (loose)", { err: e20 });
        }
        return this.logger.debug("OIDCAuth Response", { json: r }), r ?? {};
      } catch (e20) {
        return this.logger.error("OIDCAuth: postFormLoose network error", { err: e20 }), {
          error: "network_error",
          error_description: String(e20)
        };
      }
    }
    sleep(e19) {
      return new Promise((t) => setTimeout(t, e19));
    }
  };
  var X = class e11 {
    constructor(t, n) {
      let r = n ?? S;
      this._mintInfo = e11.normalizeInfo(t, r);
      let i = this.toEndpoints(this._mintInfo?.nuts?.[22]?.protected_endpoints);
      this._protected22 = this.buildIndex(i);
      let a = this.toEndpoints(this._mintInfo?.nuts?.[21]?.protected_endpoints);
      this._protected21 = this.buildIndex(a);
    }
    static normalizeInfo(t, n = S) {
      return {
        ...t,
        nuts: {
          ...t.nuts,
          ...t.nuts[4] ? { 4: {
            ...t.nuts[4],
            methods: e11.normalizeSwapMethods(t.nuts[4].methods)
          } } : {},
          ...t.nuts[5] ? { 5: {
            ...t.nuts[5],
            methods: e11.normalizeSwapMethods(t.nuts[5].methods)
          } } : {},
          ...t.nuts[19] ? { 19: e11.normalizeNut19(t.nuts[19]) } : {},
          ...t.nuts[22] ? { 22: e11.normalizeNut22(t.nuts[22], n) } : {},
          ...t.nuts[29] ? { 29: e11.normalizeNut29(t.nuts[29], n) } : {}
        }
      };
    }
    static normalizeSwapMethods(e19) {
      return e19.map((e20) => {
        let t = { ...e20 };
        return G(t, "min_amount", "max_amount"), t;
      });
    }
    static normalizeNut19(e19) {
      return e19 && {
        ...e19,
        ttl: Y(e19.ttl, "nuts.19.ttl", null)
      };
    }
    static normalizeNut22(e19, t) {
      if (!e19) return e19;
      let n = 100;
      try {
        n = Y(e19.bat_max_mint, "nuts.22.bat_max_mint", 100);
      } catch {
        t.warn("MintInfo: nuts.22.bat_max_mint is malformed, defaulting to internal cap", { value: e19.bat_max_mint });
      }
      return n > 100 && (t.warn("MintInfo: nuts.22.bat_max_mint exceeds internal cap and was clamped", {
        advertised: n,
        clampedTo: 100
      }), n = 100), {
        ...e19,
        bat_max_mint: n
      };
    }
    static normalizeNut29(e19, t) {
      if (!e19) return e19;
      let n = 100;
      try {
        n = Y(e19.max_batch_size, "nuts.29.max_batch_size", 100);
      } catch {
        t.warn("MintInfo: nuts.29.max_batch_size is malformed, defaulting to internal cap", { value: e19.max_batch_size });
      }
      return n > 100 && (t.warn("MintInfo: nuts.29.max_batch_size exceeds internal cap and was clamped", {
        advertised: n,
        clampedTo: 100
      }), n = 100), {
        methods: e19.methods,
        max_batch_size: n
      };
    }
    isSupported(e19) {
      switch (e19) {
        case 4:
        case 5:
          return this.checkMintMelt(e19);
        case 7:
        case 8:
        case 9:
        case 10:
        case 11:
        case 12:
        case 14:
        case 20:
          return this.checkGenericNut(e19);
        case 17:
          return this.checkNut17();
        case 15:
          return this.checkNut15();
        case 19:
          return this.checkNut19();
        case 29:
          return this.checkNut29();
        default:
          throw new _("nut is not supported by cashu-ts");
      }
    }
    requiresBlindAuthToken(e19, t) {
      return this.matchesProtected(this._protected22, e19, t);
    }
    requiresClearAuthToken(e19, t) {
      return this.matchesProtected(this._protected21, e19, t);
    }
    matchesProtected(e19, t, n) {
      if (!e19) return false;
      let r = e19.exact[t], i = e19.prefix[t];
      if (!r || !i) return false;
      if (e19.exact[t].has(n)) return true;
      for (let r2 of e19.prefix[t]) if (n.startsWith(r2)) return true;
      return false;
    }
    checkGenericNut(e19) {
      return this._mintInfo.nuts[e19]?.supported ? { supported: true } : { supported: false };
    }
    checkMintMelt(e19) {
      let t = this._mintInfo.nuts[e19];
      return t && t.methods.length > 0 && !t.disabled ? {
        disabled: false,
        params: t.methods
      } : {
        disabled: true,
        params: t?.methods ?? []
      };
    }
    checkNut17() {
      return this._mintInfo.nuts[17] && this._mintInfo.nuts[17].supported.length > 0 ? {
        supported: true,
        params: this._mintInfo.nuts[17].supported
      } : { supported: false };
    }
    checkNut15() {
      return this._mintInfo.nuts[15] && this._mintInfo.nuts[15].methods.length > 0 ? {
        supported: true,
        params: this._mintInfo.nuts[15].methods
      } : { supported: false };
    }
    checkNut19() {
      let e19 = this._mintInfo.nuts?.[19];
      if (e19 && (e19?.cached_endpoints?.length || 0) > 0) {
        let t = Y(e19.ttl, "nuts.19.ttl", null);
        return {
          supported: true,
          params: {
            ttl: t === null ? Infinity : Math.max(t, 0) * 1e3,
            cached_endpoints: e19.cached_endpoints
          }
        };
      }
      return { supported: false };
    }
    checkNut29() {
      let e19 = this._mintInfo.nuts?.[29];
      return e19 ? {
        supported: true,
        params: e19
      } : { supported: false };
    }
    toEndpoints(e19) {
      if (!Array.isArray(e19)) return [];
      let t = [];
      for (let n of e19) if (n && typeof n == "object") {
        let e20 = n, r = e20.method, i = e20.path;
        if (typeof r == "string" && typeof i == "string") {
          let e21 = r.toUpperCase();
          (e21 === "GET" || e21 === "POST") && t.push({
            method: e21,
            path: i
          });
        }
      }
      return t;
    }
    buildIndex(e19) {
      if (!e19?.length) return;
      let t = {
        GET: /* @__PURE__ */ new Set(),
        POST: /* @__PURE__ */ new Set()
      }, n = {
        GET: [],
        POST: []
      };
      for (let r of e19) {
        let e20 = r.path;
        if (e20.startsWith("^") && (e20 = e20.slice(1)), e20.endsWith("$") && (e20 = e20.slice(0, -1)), e20.endsWith(".*")) {
          n[r.method].push(e20.slice(0, -2));
          continue;
        }
        if (e20.endsWith("*")) {
          n[r.method].push(e20.slice(0, -1));
          continue;
        }
        t[r.method].add(e20);
      }
      return n.GET.sort((e20, t2) => t2.length - e20.length), n.POST.sort((e20, t2) => t2.length - e20.length), {
        exact: t,
        prefix: n
      };
    }
    get cache() {
      return this._mintInfo;
    }
    get contact() {
      return this._mintInfo.contact;
    }
    get description() {
      return this._mintInfo.description;
    }
    get description_long() {
      return this._mintInfo.description_long;
    }
    get name() {
      return this._mintInfo.name;
    }
    get pubkey() {
      return this._mintInfo.pubkey;
    }
    get nuts() {
      return this._mintInfo.nuts;
    }
    get version() {
      return this._mintInfo.version;
    }
    get motd() {
      return this._mintInfo.motd;
    }
    supportsNut04Description(e19, t) {
      return this._mintInfo.nuts[4]?.methods.some((n) => n.method === e19 && (t ? n.unit === t : true) && (n.options?.description === true || n.description === true));
    }
    supportsMintMeltMethod(e19, t, n) {
      let { disabled: r, params: i } = this.isSupported(e19 === "mint" ? 4 : 5);
      return r ? false : i.some((e20) => e20.method === t && e20.unit === n);
    }
    supportsAmountless(e19 = "bolt11", t = "sat") {
      let n = this._mintInfo?.nuts?.[5]?.methods ?? [];
      return Array.isArray(n) ? n.some((n2) => n2.method === e19 && n2.unit === t && n2.options?.amountless === true) : false;
    }
  };
  var oi = {
    UNPAID: "UNPAID",
    PAID: "PAID",
    ISSUED: "ISSUED"
  };
  var si = {
    UNPAID: "UNPAID",
    PENDING: "PENDING",
    PAID: "PAID"
  };
  var ci = {
    UNSPENT: "UNSPENT",
    PENDING: "PENDING",
    SPENT: "SPENT"
  };
  function li(e19) {
    return e19.window !== void 0 && e19.window.document !== void 0 ? true : e19.WorkerGlobalScope !== void 0 && e19.self !== void 0 && e19.self instanceof e19.WorkerGlobalScope;
  }
  var ui = li(globalThis);
  function di(e19, t, n = ui) {
    return {
      Accept: "application/json, text/plain, */*",
      ...e19 ? { "Content-Type": "application/json" } : void 0,
      ...n ? void 0 : { "User-Agent": "Mozilla/5.0" },
      ...t
    };
  }
  function fi(e19, t) {
    return e19 instanceof Error ? e19.message : t;
  }
  function pi(e19) {
    if (e19 === null) return;
    let t = e19.trim();
    if (t !== "") {
      if (/^\d+$/.test(t)) return Math.max(Number(t) * 1e3, 0);
      if (/[a-zA-Z]/.test(t)) {
        let e20 = new Date(t).getTime();
        if (!Number.isNaN(e20)) return Math.max(e20 - Date.now(), 0);
      }
    }
  }
  var mi = {};
  var Z = S;
  function gi(e19) {
    Z = e19;
  }
  var _i = 9;
  var vi = 1e3;
  var yi = 100;
  var bi = class e12 extends y {
    constructor(t) {
      super(t), this.name = "CallerAbortError", Object.setPrototypeOf(this, e12.prototype);
    }
  };
  function xi(e19) {
    return e19 instanceof bi ? false : e19 instanceof y ? true : e19 instanceof v && e19.status >= 500;
  }
  function Si(e19, t) {
    return t ? new Promise((n, r) => {
      if (t.aborted) {
        r(new bi("Request aborted by caller"));
        return;
      }
      let i = () => {
        clearTimeout(a), t.removeEventListener("abort", i), r(new bi("Request aborted by caller"));
      };
      t.addEventListener("abort", i, { once: true });
      let a = setTimeout(() => {
        t.removeEventListener("abort", i), n();
      }, e19);
    }) : new Promise((t2) => setTimeout(t2, e19));
  }
  function Ci(e19) {
    try {
      return new URL(e19).pathname;
    } catch {
      return e19.startsWith("/") ? e19.split(/[?#]/, 1)[0] : void 0;
    }
  }
  function wi(e19, t) {
    return e19 === t ? true : e19.endsWith(t);
  }
  async function Ti(e19) {
    let { ttl: t, cached_endpoints: n, endpoint: r } = e19, i = Ci(r), a = e19.method?.toUpperCase() ?? "GET";
    if (!(i !== void 0 && n?.some((e20) => wi(i, e20.path) && e20.method === a) && t)) return await Ei(e19);
    let o = 0, s = Date.now(), c = async () => {
      try {
        return await Ei(e19);
      } catch (n2) {
        if (xi(n2)) {
          let r2 = Date.now() - s;
          if (o < _i && (!t || r2 < t)) {
            let i2 = Math.min(2 ** o * yi, vi), a2 = Math.random() * i2;
            if (r2 + a2 > t) throw Z.error(`Network Error: request abandoned after ${o} retries`, {
              e: n2,
              retries: o
            }), n2;
            return o++, Z.info(`Network Error: attempting retry ${o} in ${a2}ms`, {
              e: n2,
              retries: o,
              delay: a2
            }), await Si(a2, e19.signal), c();
          }
        }
        throw Z.error("Request failed and could not be retried", { e: n2 }), n2;
      }
    };
    return c();
  }
  async function Ei(e19) {
    let { endpoint: t, requestBody: n, headers: r, requestTimeout: i, onResponseMeta: a, cached_endpoints: o, ttl: s, logger: c, ...l } = e19, u = n ? A.stringify(n) : void 0, d = di(u, r), f = e19.signal ?? void 0;
    if (f?.aborted) throw new bi("Request aborted by caller");
    let p = i === void 0 ? void 0 : new AbortController(), m = f, h, g;
    if (p) if (h = setTimeout(() => p.abort(), i), !f) m = p.signal;
    else {
      let e20 = new AbortController(), t2 = () => e20.abort();
      f.addEventListener("abort", t2, { once: true }), p.signal.addEventListener("abort", t2, { once: true }), g = () => {
        f.removeEventListener("abort", t2), p.signal.removeEventListener("abort", t2);
      }, m = e20.signal;
    }
    let S2;
    try {
      S2 = await fetch(t, {
        body: u,
        headers: d,
        cache: "no-store",
        credentials: "omit",
        referrer: "",
        referrerPolicy: "no-referrer",
        ...l,
        signal: m
      });
    } catch (e20) {
      let t2 = !!p?.signal.aborted, n2 = !!f?.aborted;
      throw t2 ? new y(`Request timed out after ${i}ms`, { cause: e20 }) : n2 ? new bi(fi(e20, "Request aborted by caller")) : e20 instanceof Error && (e20.name === "AbortError" || e20.name === "TimeoutError") ? new y(e20.message, { cause: e20 }) : new y(fi(e20, "Network request failed"), { cause: e20 });
    } finally {
      clearTimeout(h), g?.();
    }
    let C2 = pi(S2.headers.get("Retry-After"));
    if (a && S2.headers && T(a, {
      endpoint: t,
      status: S2.status,
      retryAfterMs: C2,
      rateLimit: S2.headers.get("RateLimit") ?? void 0,
      rateLimitPolicy: S2.headers.get("RateLimit-Policy") ?? void 0,
      headers: S2.headers
    }, Z, {
      op: "request.onResponseMeta",
      status: S2.status,
      endpoint: t
    }), !S2.ok) {
      let e20, t2;
      try {
        e20 = Di(await S2.text());
      } catch (n3) {
        t2 = n3, e20 = { error: "bad response" };
      }
      if (S2.status === 429) throw new b("429 Too Many Requests", C2);
      if (S2.status === 400 && "code" in e20 && typeof e20.code == "number" && "detail" in e20 && typeof e20.detail == "string") throw new x(e20.code, e20.detail);
      let n2 = "HTTP request failed";
      throw "error" in e20 && typeof e20.error == "string" ? n2 = e20.error : "detail" in e20 && typeof e20.detail == "string" && (n2 = e20.detail), new v(n2, S2.status, { cause: t2 });
    }
    try {
      let e20 = await S2.text();
      if (!e20) throw new _("Empty response body");
      return A.parse(e20);
    } catch (e20) {
      throw Z.error("Failed to parse HTTP response", { err: e20 }), new v("bad response", S2.status, { cause: e20 });
    }
  }
  function Di(e19) {
    if (!e19) return { detail: "bad response" };
    let t;
    try {
      t = A.parse(e19);
    } catch {
      return { detail: e19 };
    }
    return typeof t == "object" && t && ("detail" in t || "code" in t || "error" in t) ? t : { detail: t };
  }
  async function Oi(e19) {
    let t = e19.onResponseMeta, n = mi.onResponseMeta, r = {
      ...e19,
      ...mi
    };
    return t && (r.onResponseMeta = t), t && n && t !== n && (r.onResponseMeta = (r2) => {
      T(t, r2, Z, {
        op: "request.onResponseMeta",
        scope: "per-request",
        endpoint: e19.endpoint
      }), T(n, r2, Z, {
        op: "request.onResponseMeta",
        scope: "global",
        endpoint: e19.endpoint
      });
    }), await Ti(r);
  }
  var ki;
  typeof WebSocket < "u" && (ki = WebSocket);
  function ji() {
    if (ki === void 0) throw new _("WebSocket implementation not initialized");
    return ki;
  }
  var Mi = class {
    constructor(e19) {
      this.next = null, this.value = e19;
    }
  };
  var Ni = class {
    constructor() {
      this._first = null, this._last = null, this.size = 0;
    }
    enqueue(e19) {
      let t = new Mi(e19);
      return this._last ? this._last.next = t : this._first = t, this._last = t, this.size++, true;
    }
    dequeue() {
      if (!this._first) return null;
      let e19 = this._first;
      return this._first = e19.next, this._first || (this._last = null), this.size--, e19.value;
    }
  };
  var Pi = class {
    constructor(e19, t) {
      this.subListeners = {}, this.rpcListeners = {}, this.rpcId = 0, this.onCloseCallbacks = [], this._WS = ji(), this.url = new URL(e19), this.messageQueue = new Ni(), this._logger = t ?? S;
    }
    setLogger(e19) {
      this._logger = e19;
    }
    connect(e19 = 1e4) {
      return this.connectionPromise || (this.connectionPromise = new Promise((t, n) => {
        let r = false, i = false, a = null, o = (e20) => {
          i || (i = true, a && clearTimeout(a), e20());
        }, s = () => {
          if (this.ws) {
            try {
              this.ws.onopen = null, this.ws.onerror = null, this.ws.onmessage = null, this.ws.onclose = null;
            } catch {
            }
            try {
              this.ws.close();
            } catch {
            }
            this.ws = void 0, this.stopMessageHandling();
          }
        }, c = (e20) => {
          this.connectionPromise = void 0, s();
          let t2 = e20 instanceof Error ? e20 : new _(String(e20), { cause: e20 });
          this.failPendingRpc(t2), o(() => n(t2));
        };
        try {
          this.ws = new this._WS(this.url.toString());
        } catch (e20) {
          c(e20);
          return;
        }
        a = setTimeout(() => {
          c(new _(`WebSocket connect timeout after ${e19}ms`));
        }, e19), this.ws.onopen = () => {
          r = true, o(t);
        }, this.ws.onerror = (e20) => {
          if (!r) {
            c(new _("Failed to open WebSocket"));
            return;
          }
          this._logger.error("WebSocket error after open", { ev: e20 });
        }, this.ws.onmessage = (e20) => {
          this.messageQueue.enqueue(e20.data), this.handlingInterval || (this.handlingInterval = setInterval(this.handleNextMessage.bind(this), 0));
        }, this.ws.onclose = (e20) => {
          if (this.connectionPromise = void 0, !r) {
            let t3 = e20?.reason ? `, ${e20.reason}` : "";
            c(new _(`WebSocket closed before open (code ${e20?.code ?? 0}${t3})`));
            return;
          }
          this.stopMessageHandling();
          let t2 = e20?.reason ? `, ${e20.reason}` : "", n2 = e20?.code ?? 0;
          !(typeof e20.wasClean != "boolean" || e20.wasClean) || n2 !== 1e3 && n2 !== 1001 ? this.failPendingRpc(new _(`WebSocket closed (code ${n2}${t2})`)) : this.rpcListeners = {}, this.onCloseCallbacks.forEach((t3) => t3(e20));
        };
      })), this.connectionPromise;
    }
    sendRequest(e19, t) {
      if (this.ws?.readyState !== this._WS.OPEN) {
        if (e19 === "unsubscribe") return;
        throw this._logger.error("Attempted sendRequest, but socket was not open"), new _("Socket not open");
      }
      let n = this.rpcId;
      this.rpcId++, this.sendRpcMessage(e19, t, n);
    }
    addSubListener(e19, t) {
      (this.subListeners[e19] = this.subListeners[e19] || []).push(t);
    }
    stopMessageHandling() {
      for (this.handlingInterval && (clearInterval(this.handlingInterval), this.handlingInterval = void 0); this.messageQueue.size > 0; ) this.messageQueue.dequeue();
    }
    failPendingRpc(e19) {
      let t = this.rpcListeners;
      this.rpcListeners = {};
      for (let n of Object.keys(t)) try {
        t[n].errorCallback(e19);
      } catch {
      }
    }
    sendRpcMessage(e19, t, n) {
      if (this.ws?.readyState !== this._WS.OPEN) throw new _("Socket not open");
      let r = JSON.stringify({
        jsonrpc: "2.0",
        method: e19,
        params: t,
        id: n
      });
      try {
        this.ws.send(r);
      } catch (e20) {
        this._logger.error("WebSocket send failed", { e: e20 }), this.connectionPromise = void 0;
        try {
          this.ws.close();
        } catch {
        }
        this.ws = void 0, this.stopMessageHandling();
        let t2 = e20 instanceof Error ? e20 : new _(String(e20), { cause: e20 });
        throw this.failPendingRpc(t2), t2;
      }
    }
    addRpcListener(e19, t, n) {
      this.rpcListeners[n] = {
        callback: e19,
        errorCallback: t
      };
    }
    removeRpcListener(e19) {
      delete this.rpcListeners[e19];
    }
    removeListener(e19, t) {
      if (this.subListeners[e19]) {
        if (this.subListeners[e19].length === 1) {
          delete this.subListeners[e19];
          return;
        }
        this.subListeners[e19] = this.subListeners[e19].filter((e20) => e20 !== t);
      }
    }
    async ensureConnection(e19) {
      this.ws?.readyState !== this._WS.OPEN && await this.connect(e19);
    }
    handleNextMessage() {
      if (this.messageQueue.size === 0) {
        this.handlingInterval && (clearInterval(this.handlingInterval), this.handlingInterval = void 0);
        return;
      }
      let e19 = this.messageQueue.dequeue();
      try {
        let t = JSON.parse(e19);
        if ("result" in t && t.id != null) this.rpcListeners[t.id] && (this.rpcListeners[t.id].callback(), this.removeRpcListener(t.id));
        else if ("error" in t && t.id != null) this.rpcListeners[t.id] && (this.rpcListeners[t.id].errorCallback(new _(t.error.message)), this.removeRpcListener(t.id));
        else if ("method" in t && !("id" in t)) {
          let e20 = t.params?.subId;
          if (!e20) return;
          if (this.subListeners[e20]?.length > 0) {
            let n = t;
            this.subListeners[e20].forEach((e21) => {
              try {
                e21(n.params?.payload);
              } catch (e22) {
                this._logger.error("Subscription handler threw", { e: e22 });
              }
            });
          }
        }
      } catch (e20) {
        this._logger.error("Error doing handleNextMessage", { e: e20 });
      }
    }
    createSubscription(e19, t, n) {
      if (this.ws?.readyState !== this._WS.OPEN) throw this._logger.error("Attempted createSubscription, but socket was not open"), new _("Socket is not open");
      let r = (Math.random() + 1).toString(36).substring(7), i = this.rpcId;
      this.addRpcListener(() => {
        this.addSubListener(r, t);
      }, n, i);
      try {
        this.sendRequest("subscribe", {
          ...e19,
          subId: r
        });
      } catch (e20) {
        throw this.removeRpcListener(i), e20;
      }
      return r;
    }
    cancelSubscription(e19, t, n) {
      if (this.removeListener(e19, t), this.ws?.readyState !== this._WS.OPEN) {
        this._logger.info("Socket not open, removed listener locally {subId}", { subId: e19 });
        return;
      }
      let r = this.rpcId;
      this.rpcId++, this.addRpcListener(() => {
        this._logger.info("Unsubscribed {subId}", { subId: e19 });
      }, n || ((e20) => this._logger.error("Unsubscribe failed", { e: e20 })), r);
      try {
        this.sendRpcMessage("unsubscribe", { subId: e19 }, r);
      } catch (e20) {
        throw this.removeRpcListener(r), e20;
      }
    }
    get activeSubscriptions() {
      return Object.keys(this.subListeners);
    }
    close() {
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
        }
        this.ws = void 0;
      }
      this.connectionPromise = void 0, this.stopMessageHandling();
    }
    onClose(e19) {
      this.onCloseCallbacks.push(e19);
    }
  };
  var Fi = class {
    constructor(e19, t) {
      this._lastResponseMetadata = void 0, this._captureResponseMetadata = (e20) => {
        this._lastResponseMetadata = e20;
      }, this._mintUrl = Gr(e19), this._request = t?.customRequest ?? Oi, this._authProvider = t?.authProvider, this._logger = t?.logger ?? S, gi(this._logger);
    }
    get mintUrl() {
      return this._mintUrl;
    }
    get lastResponseMetadata() {
      return this._lastResponseMetadata;
    }
    async oidcAuth(e19) {
      let t = (await this.getLazyMintInfo()).nuts[21];
      if (!t?.openid_discovery) throw new _("Mint: no NUT-21 openid_discovery");
      return new ai(t.openid_discovery, {
        ...e19,
        clientId: e19?.clientId ?? t.client_id ?? "cashu-client"
      });
    }
    async getInfo(e19) {
      let t = await (e19 ?? this._request)({
        endpoint: K(this._mintUrl, "/v1/info"),
        onResponseMeta: this._captureResponseMetadata
      });
      return X.normalizeInfo(t);
    }
    async getLazyMintInfo(e19) {
      if (this._mintInfo) return this._mintInfo;
      let t = await this.getInfo(e19);
      return this._mintInfo = new X(t, this._logger), this._mintInfo;
    }
    setMintInfo(e19) {
      this._mintInfo = e19 instanceof X ? e19 : new X(e19, this._logger);
    }
    async swap(e19, t) {
      let n = await this.requestWithAuth("POST", "/v1/swap", { requestBody: e19 }, t);
      if (!W(n) || !Array.isArray(n?.signatures)) throw this._logger.error("Invalid response from mint...", {
        data: n,
        op: "swap"
      }), new _("Invalid response from mint");
      return n.signatures = this.normalizeSignatureAmounts(n.signatures), n;
    }
    async createMintQuote(e19, t, n) {
      w(!this.isValidMethodString(e19), `Invalid mint quote method: ${e19}`, this._logger);
      let r = await this.requestWithAuth("POST", `/v1/mint/quote/${e19}`, { requestBody: t }, n?.customRequest);
      return this.normalizeMintQuoteResponse(e19, r, n?.normalize);
    }
    async createMintQuoteBolt11(e19, t) {
      return this.createMintQuote("bolt11", {
        ...e19,
        amount: k.from(e19.amount).toBigInt()
      }, { customRequest: t });
    }
    async createMintQuoteBolt12(e19, t) {
      let n = { ...e19 };
      return e19.amount !== void 0 && (n.amount = k.from(e19.amount).toBigInt()), this.createMintQuote("bolt12", n, { customRequest: t });
    }
    async createMintQuoteOnchain(e19, t) {
      return this.createMintQuote("onchain", e19, { customRequest: t });
    }
    async checkMintQuote(e19, t, n) {
      w(!this.isValidMethodString(e19), `Invalid mint quote method: ${e19}`, this._logger);
      let r = await this.requestWithAuth("GET", `/v1/mint/quote/${e19}/${t}`, {}, n?.customRequest);
      return this.normalizeMintQuoteResponse(e19, r, n?.normalize);
    }
    async checkMintQuoteBolt11(e19, t) {
      return this.checkMintQuote("bolt11", e19, { customRequest: t });
    }
    async checkMintQuoteBolt12(e19, t) {
      return this.checkMintQuote("bolt12", e19, { customRequest: t });
    }
    async checkMintQuoteOnchain(e19, t) {
      return this.checkMintQuote("onchain", e19, { customRequest: t });
    }
    async mintBolt11(e19, t) {
      return this.mint("bolt11", e19, { customRequest: t });
    }
    async mintBolt12(e19, t) {
      return this.mint("bolt12", e19, { customRequest: t });
    }
    async mintOnchain(e19, t) {
      return this.mint("onchain", e19, { customRequest: t });
    }
    async mint(e19, t, n) {
      w(!this.isValidMethodString(e19), `Invalid mint method: ${e19}`, this._logger);
      let r = await this.requestWithAuth("POST", `/v1/mint/${e19}`, { requestBody: t }, n?.customRequest);
      if (!W(r) || !Array.isArray(r?.signatures)) throw this._logger.error("Invalid response from mint...", {
        data: r,
        op: `mint.${e19}`
      }), new _("Invalid response from mint");
      return r.signatures = this.normalizeSignatureAmounts(r.signatures), n?.normalize ? n.normalize(r) : r;
    }
    async mintBatchBolt11(e19, t) {
      return this.mintBatch("bolt11", e19, { customRequest: t });
    }
    async mintBatchBolt12(e19, t) {
      return this.mintBatch("bolt12", e19, { customRequest: t });
    }
    async mintBatch(e19, t, n) {
      w(!this.isValidMethodString(e19), `Invalid mint method: ${e19}`, this._logger);
      let r = {
        ...t,
        quote_amounts: t.quote_amounts.map((e20) => k.from(e20).toBigInt())
      }, i = await this.requestWithAuth("POST", `/v1/mint/${e19}/batch`, { requestBody: r }, n?.customRequest);
      if (!W(i) || !Array.isArray(i?.signatures)) throw this._logger.error("Invalid response from mint...", {
        data: i,
        op: `mintBatch.${e19}`
      }), new _("Invalid response from mint");
      return i.signatures = this.normalizeSignatureAmounts(i.signatures), n?.normalize ? n.normalize(i) : i;
    }
    async createMeltQuote(e19, t, n) {
      w(!this.isValidMethodString(e19), `Invalid melt quote method: ${e19}`, this._logger);
      let r = await this.requestWithAuth("POST", `/v1/melt/quote/${e19}`, { requestBody: t }, n?.customRequest);
      return this.normalizeMeltQuoteResponse(e19, r, n?.normalize);
    }
    async createMeltQuoteBolt11(e19, t) {
      return this.createMeltQuote("bolt11", this.normalizeMeltQuoteRequestOptions(e19), { customRequest: t });
    }
    async createMeltQuoteBolt12(e19, t) {
      return this.createMeltQuote("bolt12", this.normalizeMeltQuoteRequestOptions(e19), { customRequest: t });
    }
    async createMeltQuoteOnchain(e19, t) {
      return this.createMeltQuote("onchain", {
        ...e19,
        amount: k.from(e19.amount).toBigInt()
      }, { customRequest: t });
    }
    async checkMeltQuote(e19, t, n) {
      w(!this.isValidMethodString(e19), `Invalid melt quote method: ${e19}`, this._logger);
      let r = await this.requestWithAuth("GET", `/v1/melt/quote/${e19}/${t}`, {}, n?.customRequest);
      return this.normalizeMeltQuoteResponse(e19, r, n?.normalize);
    }
    async checkMeltQuoteBolt11(e19, t) {
      return this.checkMeltQuote("bolt11", e19, { customRequest: t });
    }
    async checkMeltQuoteBolt12(e19, t) {
      return this.checkMeltQuote("bolt12", e19, { customRequest: t });
    }
    async checkMeltQuoteOnchain(e19, t) {
      return this.checkMeltQuote("onchain", e19, { customRequest: t });
    }
    async melt(e19, t, n) {
      w(!this.isValidMethodString(e19), `Invalid melt method: ${e19}`, this._logger);
      let r = await this.requestWithAuth("POST", `/v1/melt/${e19}`, { requestBody: t }, n?.customRequest);
      return this.normalizeMeltQuoteResponse(e19, r, n?.normalize);
    }
    async meltBolt11(e19, t) {
      return this.melt("bolt11", e19, t);
    }
    async meltBolt12(e19, t) {
      return this.melt("bolt12", e19, t);
    }
    async meltOnchain(e19, t) {
      return this.melt("onchain", e19, t);
    }
    async check(e19, t) {
      let n = await this.requestWithAuth("POST", "/v1/checkstate", { requestBody: e19 }, t);
      if (!W(n) || !Array.isArray(n?.states)) throw this._logger.error("Invalid response from mint...", {
        data: n,
        op: "check"
      }), new _("Invalid response from mint");
      for (let e20 of n.states) G(e20, "witness");
      return n;
    }
    async getKeys(e19, t, n) {
      let r = t || this._mintUrl;
      e19 && (e19 = e19.replace(/\//g, "_").replace(/\+/g, "-"));
      let i = await (n ?? this._request)({
        endpoint: e19 ? K(r, "/v1/keys", e19) : K(r, "/v1/keys"),
        onResponseMeta: this._captureResponseMetadata
      });
      if (!W(i) || !Array.isArray(i.keysets)) throw this._logger.error("Invalid response from mint...", {
        data: i,
        op: "getKeys"
      }), new _("Invalid response from mint");
      return {
        ...i,
        keysets: i.keysets.map((e20) => ii(e20))
      };
    }
    async getKeySets(e19) {
      let t = await (e19 ?? this._request)({
        endpoint: K(this._mintUrl, "/v1/keysets"),
        onResponseMeta: this._captureResponseMetadata
      });
      if (!W(t) || !Array.isArray(t.keysets)) throw this._logger.error("Invalid response from mint...", {
        data: t,
        op: "getKeySets"
      }), new _("Invalid response from mint");
      return {
        ...t,
        keysets: t.keysets.map((e20) => ri(e20))
      };
    }
    async restore(e19, t) {
      let n = await (t ?? this._request)({
        endpoint: K(this._mintUrl, "/v1/restore"),
        method: "POST",
        requestBody: e19,
        onResponseMeta: this._captureResponseMetadata
      });
      if (!W(n) || !Array.isArray(n?.outputs) || !Array.isArray(n?.signatures)) throw this._logger.error("Invalid response from mint...", {
        data: n,
        op: "restore"
      }), new _("Invalid response from mint");
      return n.outputs = this.normalizeMessageAmounts(n.outputs), n.signatures = this.normalizeSignatureAmounts(n.signatures), n;
    }
    async connectWebSocket() {
      try {
        let e19 = new URL(this._mintUrl), t = "v1/ws";
        e19.pathname.endsWith("/") ? e19.pathname += t : e19.pathname += "/" + t, e19.protocol = e19.protocol === "https:" ? "wss:" : "ws:";
        let n = e19.toString();
        this.ws || (this.ws = new Pi(n, this._logger)), await this.ws.ensureConnection();
      } catch (e19) {
        this._logger.error("Failed to connect to WebSocket...", { e: e19 });
        try {
          this.ws?.close();
        } catch {
        }
        throw this.ws = void 0, new _("Failed to connect to WebSocket...", { cause: e19 });
      }
    }
    disconnectWebSocket() {
      this.ws && this.ws.close();
    }
    get webSocketConnection() {
      return this.ws;
    }
    async handleClearAuth(e19, t, n) {
      if (this._authProvider && (n ?? await this.getLazyMintInfo()).requiresClearAuthToken(e19, t)) return this._authProvider.ensureCAT ? this._authProvider.ensureCAT() : this._authProvider.getCAT();
    }
    async handleBlindAuth(e19, t, n) {
      if (this._authProvider && (n ?? await this.getLazyMintInfo()).requiresBlindAuthToken(e19, t)) return await this._authProvider.getBlindAuthToken({
        method: e19,
        path: t
      });
    }
    async requestWithAuth(e19, t, n = {}, r) {
      let i = r ?? this._request, a = this._mintInfo;
      this._authProvider && (a = await this.getLazyMintInfo(r));
      let o = await this.handleBlindAuth(e19, t, a), s = await this.handleClearAuth(e19, t, a), c = {
        ...n.headers ?? {},
        ...o ? { "Blind-auth": o } : {},
        ...s ? { "Clear-auth": s } : {}
      }, l = a?.isSupported(19);
      return i({
        ...n,
        endpoint: K(this._mintUrl, t),
        method: e19,
        headers: c,
        ...l?.supported && l.params ? l.params : {},
        onResponseMeta: this._captureResponseMetadata
      });
    }
    normalizeMeltQuoteRequestOptions(e19) {
      if (!e19.options) return { ...e19 };
      let t = { ...e19.options };
      return e19.options.amountless && (t.amountless = { amount_msat: k.from(e19.options.amountless.amount_msat).toBigInt() }), "mpp" in e19.options && e19.options.mpp && (t.mpp = { amount: k.from(e19.options.mpp.amount).toBigInt() }), {
        ...e19,
        options: t
      };
    }
    isValidMethodString(e19) {
      return !!(typeof e19 == "string" && /^[a-z0-9_-]+$/.test(e19));
    }
    normalizeSignatureAmounts(e19) {
      return e19.map((e20) => ({
        ...e20,
        amount: k.from(e20.amount)
      }));
    }
    normalizeMessageAmounts(e19) {
      return e19.map((e20) => ({
        ...e20,
        amount: k.from(e20.amount)
      }));
    }
    normalizeMintQuoteResponse(e19, t, n) {
      let r = { ...t };
      return e19 === "bolt11" ? this.normalizeMintQuoteBolt11Fields(r) : e19 === "bolt12" ? this.normalizeMintQuoteBolt12Fields(r) : e19 === "onchain" && this.normalizeMintQuoteOnchainFields(r), n ? n(r) : r;
    }
    normalizeMintQuoteBolt11Fields(e19) {
      e19.amount = k.from(e19.amount), e19.expiry = Y(e19.expiry, "mintQuoteBolt11.expiry", null);
    }
    normalizeMintQuoteBolt12Fields(e19) {
      G(e19, "amount"), e19.amount = e19.amount === null ? null : k.from(e19.amount), e19.expiry = Y(e19.expiry, "mintQuoteBolt12.expiry", null), e19.amount_paid = k.from(e19.amount_paid), e19.amount_issued = k.from(e19.amount_issued);
    }
    normalizeMintQuoteOnchainFields(e19) {
      e19.expiry = Y(e19.expiry, "mintQuoteOnchain.expiry", null), e19.amount_paid = k.from(e19.amount_paid), e19.amount_issued = k.from(e19.amount_issued);
    }
    normalizeMeltQuoteResponse(e19, t, n) {
      let r = `${e19} melt quote`, i = { ...t };
      return this.normalizeMeltBaseFields(i, r), e19 === "bolt11" || e19 === "bolt12" ? this.normalizeMeltBoltFields(i, r) : e19 === "onchain" && this.normalizeMeltOnchainFields(i), n ? n(i) : i;
    }
    normalizeMeltBaseFields(e19, t) {
      if (e19.amount = k.from(e19.amount), e19.expiry = Y(e19.expiry, "meltQuote.expiry", void 0), e19.change && (e19.change = this.normalizeSignatureAmounts(e19.change)), !W(e19) || typeof e19.quote != "string" || !(e19.amount instanceof k) || typeof e19.unit != "string" || typeof e19.state != "string" || typeof e19.expiry != "number" || !Object.values(si).includes(e19.state)) throw this._logger.error("Invalid response from mint...", {
        data: e19,
        op: t
      }), new _("Invalid response from mint");
    }
    normalizeMeltBoltFields(e19, t) {
      if (e19.fee_reserve = k.from(e19.fee_reserve), typeof e19.request != "string" || !(e19.fee_reserve instanceof k)) throw this._logger.error("Invalid response from mint...", {
        data: e19,
        op: t
      }), new _("Invalid response from mint");
      G(e19, "payment_preimage");
    }
    normalizeMeltOnchainFields(e19) {
      if (!Array.isArray(e19.fee_options) || e19.fee_options.length === 0 || (e19.fee_options = e19.fee_options.map((t) => {
        let n = t;
        if (!Number.isSafeInteger(n.fee_index)) throw this._logger.error("Invalid response from mint...", {
          data: e19,
          op: "onchain melt quote"
        }), Error("Invalid response from mint");
        return {
          ...n,
          fee_index: n.fee_index,
          fee_reserve: k.from(n.fee_reserve),
          estimated_blocks: n.estimated_blocks
        };
      }), G(e19, "selected_fee_index", "outpoint"), typeof e19.request != "string" || e19.selected_fee_index !== null && !Number.isSafeInteger(e19.selected_fee_index) || e19.outpoint !== null && typeof e19.outpoint != "string")) throw this._logger.error("Invalid response from mint...", {
        data: e19,
        op: "onchain melt quote"
      }), Error("Invalid response from mint");
    }
  };
  var Ii = class e13 {
    constructor(e19, t, n, r, i) {
      this._keys = {}, this._id = e19, this._unit = t, this._active = n, this._input_fee_ppk = r, this._final_expiry = i;
    }
    get id() {
      return this._id;
    }
    get unit() {
      return this._unit;
    }
    get isActive() {
      return this._active;
    }
    get fee() {
      return this._input_fee_ppk ?? 0;
    }
    get expiry() {
      return this._final_expiry;
    }
    get hasKeys() {
      return Object.keys(this._keys).length > 0;
    }
    get hasHexId() {
      return U(this._id);
    }
    get keys() {
      return this._keys;
    }
    set keys(e19) {
      this._keys = e19;
    }
    toMintKeyset() {
      return {
        id: this._id,
        unit: this._unit,
        active: this._active,
        input_fee_ppk: this._input_fee_ppk,
        final_expiry: this._final_expiry
      };
    }
    toMintKeys() {
      return this.hasKeys ? {
        id: this._id,
        unit: this._unit,
        active: this._active,
        input_fee_ppk: this._input_fee_ppk,
        final_expiry: this._final_expiry,
        keys: this._keys
      } : null;
    }
    verify() {
      return this.hasKeys ? e13.verifyKeysetId(this.toMintKeys()) : false;
    }
    static verifyKeysetId(e19) {
      try {
        if (!e19.keys || Object.keys(e19.keys).length === 0) return false;
        let t = Se(e19.id) && !U(e19.id), r = U(e19.id) ? hexToBytes2(e19.id)[0] : 0;
        return Hr(e19.keys, {
          input_fee_ppk: e19.input_fee_ppk,
          expiry: e19.final_expiry,
          unit: e19.unit,
          versionByte: r,
          isDeprecatedBase64: t
        }) === e19.id;
      } catch {
        return false;
      }
    }
    static fromMintApi(t, n) {
      let r = ri(t), i = n ? ii(n) : void 0, a = new e13(r.id, r.unit, r.active, r.input_fee_ppk, r.final_expiry);
      if (i) {
        if (i.id !== r.id) throw new _(`Mismatched keyset ids: meta=${r.id}, keys=${i.id}`);
        if (i.unit !== r.unit) throw new _(`Mismatched keyset units: meta=${r.unit}, keys=${i.unit}`);
        if (i.final_expiry !== void 0 && r.final_expiry !== void 0 && i.final_expiry !== r.final_expiry) throw new _(`Mismatched keyset expiry for id=${r.id}`);
        a.keys = i.keys;
      }
      return a;
    }
  };
  var Li = class e14 {
    assertInitialized() {
      if (Object.keys(this.keysets).length === 0) throw new _("KeyChain not initialized");
    }
    constructor(e19, t) {
      this.keysets = {}, this.pendingKeyFetches = /* @__PURE__ */ new Map(), this.mint = typeof e19 == "string" ? new Fi(e19) : e19, this.unit = t;
    }
    static fromCache(t, n, r) {
      let i = new e14(t, n);
      return i.loadFromCache(r), i;
    }
    static mintToCacheDTO(e19, t, n) {
      let r = new Map(n.map((e20) => [e20.id, e20]));
      return {
        keysets: t.map((e20) => {
          let t2 = r.get(e20.id), n2 = { ...e20 };
          return t2 && (n2.keys = t2.keys), n2;
        }),
        mintUrl: e19,
        savedAt: Date.now()
      };
    }
    static cacheToMintDTO(e19) {
      return {
        keysets: e19.keysets.map((e20) => ({
          id: e20.id,
          unit: e20.unit,
          active: e20.active,
          input_fee_ppk: e20.input_fee_ppk,
          final_expiry: e20.final_expiry
        })),
        keys: e19.keysets.filter((e20) => !!e20.keys).map((e20) => ({
          id: e20.id,
          unit: e20.unit,
          active: e20.active,
          input_fee_ppk: e20.input_fee_ppk,
          final_expiry: e20.final_expiry,
          keys: e20.keys
        }))
      };
    }
    async init(e19) {
      if (Object.keys(this.keysets).length > 0 && !e19) return;
      let [t, n] = await Promise.all([this.mint.getKeySets(), this.mint.getKeys()]);
      this.buildKeychain(t.keysets, n.keysets);
    }
    loadFromCache(t) {
      let { keysets: n, keys: r } = e14.cacheToMintDTO(t);
      this.buildKeychain(n, r);
    }
    buildKeychain(e19, t) {
      this.keysets = {};
      let n = new Map(t.map((e20) => [e20.id, e20]));
      for (let t2 of e19) {
        let e20 = n.get(t2.id), r = e20 ? Ii.fromMintApi(t2, e20) : Ii.fromMintApi(t2);
        r.verify() || (r.keys = {}), this.keysets[r.id] = r;
      }
    }
    getKeyset(e19) {
      let t = e19 ? this.keysets[e19] : this.getCheapestKeyset();
      if (!t) throw new _(`Keyset '${e19}' not found`);
      return t;
    }
    getCheapestKeyset() {
      if (Object.keys(this.keysets).length === 0) throw new _("KeyChain not initialized");
      let e19 = Object.values(this.keysets).filter((e20) => e20.unit === this.unit && e20.isActive && e20.hasHexId && e20.hasKeys);
      if (e19.length === 0) throw new _(`No active keyset found for unit: ${this.unit}`);
      return e19.sort((e20, t) => e20.fee - t.fee)[0];
    }
    async ensureKeysetKeys(e19) {
      let t = this.keysets[e19];
      if (!t) throw new _(`Keyset '${e19}' not found`);
      if (t.hasKeys) return t;
      let n = this.pendingKeyFetches.get(e19);
      if (n) return await n;
      let r = (async () => {
        let n2 = (await this.mint.getKeys(e19)).keysets.find((t2) => t2.id === e19);
        if (!n2 || !n2.keys || Object.keys(n2.keys).length === 0) throw new _(`Mint returned no keys for keyset '${e19}'`);
        let r2 = t.toMintKeyset(), i = Ii.fromMintApi(r2, n2);
        if (!i.verify()) throw new _(`Keyset verification failed for ID ${e19}`);
        return this.keysets[e19] = i, i;
      })();
      this.pendingKeyFetches.set(e19, r);
      try {
        return await r;
      } finally {
        this.pendingKeyFetches.delete(e19);
      }
    }
    getKeysets() {
      this.assertInitialized();
      let e19 = Object.values(this.keysets).filter((e20) => e20.unit === this.unit);
      if (e19.length === 0) throw new _(`No keysets found for unit: ${this.unit}`);
      return e19;
    }
    getAllKeys() {
      return this.assertInitialized(), Object.values(this.keysets).map((e19) => e19.toMintKeys()).filter((e19) => e19 !== null);
    }
    getAllKeysetIds() {
      return this.assertInitialized(), Object.keys(this.keysets);
    }
    get cache() {
      let t = Object.values(this.keysets), n = t.map((e19) => e19.toMintKeyset()), r = t.map((e19) => e19.toMintKeys()).filter((e19) => e19 !== null);
      return e14.mintToCacheDTO(this.mint.mintUrl, n, r);
    }
  };
  var Ri = class {
    constructor(e19, t, n) {
      this.amountValue = k.from(e19), this.B_ = t, this.id = n;
    }
    get amount() {
      return this.amountValue;
    }
    getSerializedBlindedMessage() {
      return {
        amount: this.amountValue,
        B_: this.B_.toHex(true),
        id: this.id
      };
    }
  };
  var zi = 1024;
  var Bi = /* @__PURE__ */ new Set([
    "locktime",
    "pubkeys",
    "n_sigs",
    "refund",
    "n_sigs_refund",
    "sigflag"
  ]);
  function Vi(e19) {
    if (!e19 || typeof e19 != "string") throw new _("tag key must be a non empty string");
    if (Bi.has(e19)) throw new _(`additionalTags must not use reserved key "${e19}"`);
  }
  var Q = class e15 {
    constructor(e19, t, n, r) {
      this.secret = n, this.blindingFactor = t, this.blindedMessage = e19, this.ephemeralE = r;
    }
    toProof(e19, t) {
      if (e19 == null) throw new _("Mint response is missing a signature for one of the outputs. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.");
      let n;
      e19.dleq && (n = {
        s: hexToBytes(e19.dleq.s),
        e: hexToBytes(e19.dleq.e),
        r: this.blindingFactor
      });
      let r = e19.amount.toString(), i = N(t.keys[r]);
      if (n) {
        let t2 = N(this.blindedMessage.B_), r2 = N(e19.C_);
        if (!hn(n, t2, r2, i)) throw new _("DLEQ verification failed on mint response");
      }
      let a = st({
        id: e19.id,
        C_: N(e19.C_)
      }, this.blindingFactor, this.secret, i), o = {
        id: e19.id,
        amount: e19.amount,
        C: a.C.toHex(true),
        secret: new TextDecoder().decode(a.secret),
        ...n && { dleq: {
          s: bytesToHex(n.s),
          e: bytesToHex(n.e),
          r: jr(n.r ?? BigInt(0))
        } }
      };
      return this.ephemeralE && (o.p2pk_e = this.ephemeralE), o;
    }
    static createP2PKData(e19, t, n, r) {
      return H(t, n.keys, r).map((t2) => this.createSingleP2PKData(e19, t2, n.id));
    }
    static createSingleP2PKData(t, n, r) {
      let i = k.from(n), a = Bt(t), o = Array.isArray(a.pubkey) ? a.pubkey : [a.pubkey], s = a.refundKeys ?? [], c = a.requiredSignatures ?? 1, l = a.requiredRefundSignatures ?? 1, d = a.hashlock, f = typeof d == "string" && d.length > 0, m = f ? d : o[0], h = f ? o : o.slice(1), g = s, v2;
      if (t.blindKeys) {
        let { blinded: e19, Ehex: t2 } = jt([...o, ...s]);
        f ? h = e19.slice(0, o.length) : (m = e19[0], h = e19.slice(1, o.length)), g = e19.slice(o.length), v2 = t2;
      }
      let y2 = [], b2 = a.locktime ?? NaN;
      if (Number.isSafeInteger(b2) && b2 >= 0 && y2.push(["locktime", String(b2)]), h.length > 0 && (y2.push(["pubkeys", ...h]), c > 1 && y2.push(["n_sigs", String(c)])), g.length > 0 && (y2.push(["refund", ...g]), l > 1 && y2.push(["n_sigs_refund", String(l)])), a.sigFlag == "SIG_ALL" && y2.push(["sigflag", "SIG_ALL"]), a.additionalTags?.length) {
        let e19 = a.additionalTags.map(([e20, ...t2]) => (Vi(e20), [e20, ...t2.map(String)]));
        y2.push(...e19);
      }
      let x2 = [f ? "HTLC" : "P2PK", {
        nonce: bytesToHex(randomBytes(32)),
        data: m,
        tags: y2
      }], S2 = JSON.stringify(x2), C2 = [...S2].length;
      if (C2 > 1024) throw new _(`Secret too long (${C2} characters), maximum is ${zi}`);
      let w2 = new TextEncoder().encode(S2), { r: ee2, B_: T2 } = at(w2);
      return new e15(new Ri(i, T2, r).getSerializedBlindedMessage(), ee2, w2, v2);
    }
    static createRandomData(e19, t, n) {
      return H(e19, t.keys, n).map((e20) => this.createSingleRandomData(e20, t.id));
    }
    static createSingleRandomData(t, n) {
      let r = k.from(t), i = bytesToHex(randomBytes(32)), a = new TextEncoder().encode(i), { r: o, B_: s } = at(a);
      return new e15(new Ri(r, s, n).getSerializedBlindedMessage(), o, a);
    }
    static createDeterministicData(e19, t, n, r, i) {
      let a = H(e19, r.keys, i), o = wn(t, r.id);
      return a.map((e20, t2) => Hi(e20, r.id, o(n + t2)));
    }
    static createSingleDeterministicData(e19, t, n, r) {
      return Hi(e19, r, Cn(t, r, n));
    }
    static sumOutputAmounts(e19) {
      return k.sum(e19.map((e20) => e20.blindedMessage.amount));
    }
    static serialize(e19) {
      return {
        blindedMessage: {
          amount: e19.blindedMessage.amount.toString(),
          B_: e19.blindedMessage.B_,
          id: e19.blindedMessage.id
        },
        blindingFactor: e19.blindingFactor.toString(),
        secret: bytesToHex(e19.secret),
        ...e19.ephemeralE && { ephemeralE: e19.ephemeralE }
      };
    }
    static deserialize(t) {
      try {
        if (!/^(0|[1-9]\d*)$/.test(t.blindingFactor)) throw Error("blindingFactor must be a canonical decimal integer");
        return new e15({
          amount: k.from(t.blindedMessage.amount),
          B_: t.blindedMessage.B_,
          id: t.blindedMessage.id
        }, BigInt(t.blindingFactor), hexToBytes(t.secret), t.ephemeralE);
      } catch (e19) {
        throw new _(`Invalid SerializedOutputData: ${e19 instanceof Error ? e19.message : String(e19)}`, { cause: e19 });
      }
    }
  };
  function Hi(e19, t, n) {
    let r = k.from(e19), i = bytesToHex(n.secret), a = new TextEncoder().encode(i), { r: o, B_: s } = at(a, D.toBigInt(n.blindingFactor));
    return new Q(new Ri(r, s, t).getSerializedBlindedMessage(), o, a);
  }
  function Gi(e19, t, n, r = false, i = false, a = S) {
    let o = J(e19), s = k.from(t), c = s.toNumber(), l = ne(), u = null, d = Infinity, f = 0, p = 0, m = (e20) => {
      try {
        return n.getKeyset(e20.id).fee;
      } catch (t2) {
        let r2 = `Could not get fee. No keyset found for keyset id: ${e20.id}`;
        throw a.error(r2, {
          error: t2,
          keychain: n.getKeysets()
        }), new _(r2, { cause: t2 });
      }
    }, h = (e20, t2) => e20 - (r ? Math.ceil(t2 / 1e3) : 0), g = (e20) => {
      let t2 = [...e20];
      for (let e21 = t2.length - 1; e21 > 0; e21--) {
        let n2 = Math.floor(Math.random() * (e21 + 1));
        [t2[e21], t2[n2]] = [t2[n2], t2[e21]];
      }
      return t2;
    }, v2 = (e20, t2, n2) => {
      let r2 = 0, i2 = e20.length - 1, a2 = null;
      for (; r2 <= i2; ) {
        let o2 = Math.floor((r2 + i2) / 2), s2 = e20[o2].exFee;
        (n2 ? s2 <= t2 : s2 >= t2) ? (a2 = o2, n2 ? r2 = o2 + 1 : i2 = o2 - 1) : n2 ? i2 = o2 - 1 : r2 = o2 + 1;
      }
      return n2 ? a2 : r2 < e20.length ? r2 : null;
    }, y2 = (e20, t2) => {
      let n2 = t2.exFee, r2 = 0, i2 = e20.length;
      for (; r2 < i2; ) {
        let t3 = Math.floor((r2 + i2) / 2);
        e20[t3].exFee < n2 ? r2 = t3 + 1 : i2 = t3;
      }
      e20.splice(r2, 0, t2);
    }, b2 = (e20, t2) => h(e20, t2) < c ? Infinity : e20 + t2 / 1e3 - c, x2 = 0, T2 = 0, te = o.map((e20) => {
      e20.amount.greaterThan(2 ** 53 - 1) && C("selectProofsRGLI does not support proof amounts > Number.MAX_SAFE_INTEGER. Provide a custom SelectProofs implementation for msat-scale wallets.", a);
      let t2 = m(e20), n2 = e20.amount.toNumber(), i2 = r ? n2 - t2 / 1e3 : n2, o2 = {
        proof: e20,
        amountNum: n2,
        exFee: i2,
        ppkfee: t2
      };
      return (!r || i2 > 0) && (x2 += n2, T2 += t2), o2;
    }), E = r ? te.filter((e20) => e20.exFee > 0) : te;
    if (E.sort((e20, t2) => e20.exFee - t2.exFee), E.length > 0) {
      let e20;
      if (i) {
        let t2 = v2(E, c, true);
        e20 = t2 === null ? 0 : t2 + 1;
      } else {
        let t2 = v2(E, c, false);
        if (t2 !== null) {
          let n2 = E[t2].exFee, r2 = v2(E, n2, true);
          ee(r2, "Unexpected null rightIndex in binary search", a), e20 = r2 + 1;
        } else e20 = E.length;
      }
      for (let t2 = e20; t2 < E.length; t2++) x2 -= E[t2].amountNum, T2 -= E[t2].ppkfee;
      E = E.slice(0, e20);
    }
    let re2 = h(x2, T2);
    if (s.isZero() || c > re2) return {
      keep: o,
      send: []
    };
    let D2 = Math.min(Math.ceil(c * 1), c + 0, re2);
    for (let e20 = 0; e20 < 60; e20++) {
      let t2 = [], n2 = 0, r2 = 0;
      for (let e21 of g(E)) {
        let a2 = n2 + e21.amountNum, o3 = r2 + e21.ppkfee, s3 = h(a2, o3);
        if (i && s3 > c || (t2.push(e21), n2 = a2, r2 = o3, s3 >= c)) break;
      }
      let o2 = new Set(t2), s2 = E.filter((e21) => !o2.has(e21)), m2 = g(Array.from({ length: t2.length }, (e21, t3) => t3)).slice(0, 5e3);
      for (let e21 of m2) {
        let a2 = h(n2, r2);
        if (a2 === c || !i && a2 >= c && a2 <= D2) break;
        let o3 = t2[e21], l2 = n2 - o3.amountNum, u2 = r2 - o3.ppkfee, d2 = c - h(l2, u2), f2 = v2(s2, d2, i);
        if (f2 !== null) {
          let a3 = s2[f2];
          (!i || a3.exFee > o3.exFee) && (d2 >= 0 || a3.exFee <= o3.exFee) && (t2[e21] = a3, n2 = l2 + a3.amountNum, r2 = u2 + a3.ppkfee, s2.splice(f2, 1), y2(s2, o3));
        }
      }
      let _2 = b2(n2, r2);
      if (_2 < d) {
        a.debug(`selectProofsToSend: best solution found in trial #${e20} - amount: ${n2}, delta: ${_2}`), u = [...t2].sort((e21, t3) => t3.exFee - e21.exFee), d = _2, f = n2, p = r2;
        let i2 = [...u];
        for (; i2.length > 1 && d > 0; ) {
          let e21 = i2.pop(), t3 = n2 - e21.amountNum, a2 = r2 - e21.ppkfee, o3 = b2(t3, a2);
          if (o3 == Infinity) break;
          o3 < d && (u = [...i2], d = o3, f = t3, p = a2, n2 = t3, r2 = a2);
        }
      }
      if (u && d < Infinity) {
        let e21 = h(f, p);
        if (e21 === c || !i && e21 >= c && e21 <= D2) break;
      }
      if (l.elapsed() > 1e3) {
        w(i, "Proof selection took too long. Try again with a smaller proof set.", a), a.warn("Proof selection took too long. Returning best selection so far.");
        break;
      }
    }
    if (u && d < Infinity) {
      let e20 = u.map((e21) => e21.proof), t2 = new Set(e20), n2 = o.filter((e21) => !t2.has(e21));
      return a.info(`Proof selection took ${l.elapsed()}ms`), {
        keep: n2,
        send: e20
      };
    }
    return {
      keep: o,
      send: []
    };
  }
  var Ki = class e16 {
    createP2PKData(e19, t, n, r) {
      return H(t, n.keys, r).map((t2) => this.createSingleP2PKData(e19, t2, n.id));
    }
    createSingleP2PKData(e19, t, n) {
      return Q.createSingleP2PKData(e19, t, n);
    }
    createRandomData(e19, t, n) {
      return H(e19, t.keys, n).map((e20) => this.createSingleRandomData(e20, t.id));
    }
    createSingleRandomData(e19, t) {
      return Q.createSingleRandomData(e19, t);
    }
    createDeterministicData(t, n, r, i, a) {
      return this.createSingleDeterministicData === e16.prototype.createSingleDeterministicData ? Q.createDeterministicData(t, n, r, i, a) : H(t, i.keys, a).map((e19, t2) => this.createSingleDeterministicData(e19, n, r + t2, i.id));
    }
    createSingleDeterministicData(e19, t, n, r) {
      return Q.createSingleDeterministicData(e19, t, n, r);
    }
  };
  function qi(e19) {
    let t = Object.keys(e19).map((e20) => k.from(e20));
    return t.sort((e20, t2) => e20.compareTo(t2)), t;
  }
  function Ji(e19, t, n, r) {
    let i = k.from(t), a = [], o = k.zero(), s = e19.map((e20) => e20.amount);
    for (let e20 of qi(n)) {
      let t2 = s.filter((t3) => e20.equals(t3)).length, n2 = Math.max(r - t2, 0);
      for (let t3 = 0; t3 < n2; ++t3) {
        let t4 = o.add(e20);
        if (t4.greaterThan(i)) break;
        a.push(e20), o = t4;
      }
    }
    let c = i.subtract(o);
    if (!c.isZero()) for (let e20 of H(c, n)) a.push(e20), o = o.add(e20);
    return a.sort((e20, t2) => e20.compareTo(t2));
  }
  function Yi(e19) {
    switch (e19.type) {
      case "custom":
        return JSON.stringify({
          type: "custom",
          outputs: e19.data.length,
          amounts: e19.data.map((e20) => e20.blindedMessage.amount.toString())
        });
      case "factory":
        return JSON.stringify({
          type: "factory",
          denominations: (e19.denominations ?? []).map((e20) => k.from(e20).toString())
        });
      case "deterministic":
        return JSON.stringify({
          type: "deterministic",
          counter: e19.counter,
          denominations: (e19.denominations ?? []).map((e20) => k.from(e20).toString())
        });
      case "p2pk":
        return JSON.stringify({
          type: "p2pk",
          options: e19.options,
          denominations: (e19.denominations ?? []).map((e20) => k.from(e20).toString())
        });
      case "random":
        return JSON.stringify({
          type: "random",
          denominations: (e19.denominations ?? []).map((e20) => k.from(e20).toString())
        });
      default:
        return "Unknown";
    }
  }
  var Xi = class {
    constructor(e19) {
      if (this.next = /* @__PURE__ */ new Map(), this.locks = /* @__PURE__ */ new Map(), e19) for (let [t, n] of Object.entries(e19)) this.next.set(t, n);
    }
    async withLock(e19, t) {
      let n = this.locks.get(e19) ?? Promise.resolve(), r, i = new Promise((e20) => r = e20), a = n.then(() => i);
      this.locks.set(e19, a);
      try {
        return await n, await t();
      } finally {
        r(), this.locks.get(e19) === a && this.locks.delete(e19);
      }
    }
    async reserve(e19, t) {
      if (t < 0) throw new _("reserve called with negative count");
      return this.withLock(e19, () => {
        let n = this.next.get(e19) ?? 0;
        return t === 0 ? {
          start: n,
          count: 0
        } : (this.next.set(e19, n + t), {
          start: n,
          count: t
        });
      });
    }
    async advanceToAtLeast(e19, t) {
      await this.withLock(e19, () => {
        t > (this.next.get(e19) ?? 0) && this.next.set(e19, t);
      });
    }
    async setNext(e19, t) {
      await this.withLock(e19, () => {
        if (t < 0) throw new _("setNext: negative next not allowed");
        this.next.set(e19, t);
      });
    }
    snapshot() {
      return Promise.resolve(Object.fromEntries(this.next.entries()));
    }
  };
  var Qi = class {
    constructor(e19) {
      this.src = e19;
    }
    async peekNext(e19) {
      return (await this.src.reserve(e19, 0)).start;
    }
    async advanceToAtLeast(e19, t) {
      await this.src.advanceToAtLeast(e19, t);
    }
    async setNext(e19, t) {
      if (typeof this.src.setNext == "function") {
        await this.src.setNext(e19, t);
        return;
      }
      throw new _("CounterSource does not support setNext()");
    }
    async snapshot() {
      if (typeof this.src.snapshot == "function") return await this.src.snapshot();
      throw new _("CounterSource does not support snapshot()");
    }
  };
  function $i(e19) {
    let t = /* @__PURE__ */ new WeakSet();
    try {
      return JSON.stringify(e19, (e20, n) => {
        if (typeof n == "object" && n) {
          if (t.has(n)) return "[Circular]";
          t.add(n);
        }
        return n;
      });
    } catch {
      return Object.prototype.toString.call(e19);
    }
  }
  function ea(e19) {
    return e19 instanceof Error ? e19 : new _(typeof e19 == "string" ? e19 : $i(e19), { cause: e19 });
  }
  function ta() {
    let e19 = /* @__PURE__ */ Error("Aborted");
    return Object.defineProperty(e19, "name", { value: "AbortError" }), e19;
  }
  function $(e19) {
    e19 && Promise.resolve(e19).then((e20) => {
      try {
        e20();
      } catch {
      }
    }).catch(() => {
    });
  }
  var na = class {
    constructor(e19) {
      this.wallet = e19, this.countersReservedHandlers = /* @__PURE__ */ new Set();
    }
    withAbort(e19, t) {
      if (!e19) return t;
      if (e19.aborted) return t(), () => {
      };
      let n = () => t();
      return e19.addEventListener("abort", n, { once: true }), () => {
        e19.removeEventListener("abort", n), t();
      };
    }
    waitUntilPaid(e19, t, n, r = "Timeout waiting for paid") {
      return new Promise((i, a) => {
        let o = null, s = null, c = false, l = (e20) => {
          c || (c = true, $(o), s && (clearTimeout(s), s = null), n?.signal && n.signal.removeEventListener("abort", u), e20 && a(ea(e20)));
        }, u = () => l(ta());
        if (n?.signal) {
          if (n.signal.aborted) return u();
          n.signal.addEventListener("abort", u, { once: true });
        }
        n?.timeoutMs && n.timeoutMs > 0 && (s = setTimeout(() => l(new _(r)), n.timeoutMs)), o = e19(t, (e20) => {
          l(), i(e20);
        }, (e20) => l(e20), { signal: n?.signal }), o.catch((e20) => l(e20));
      });
    }
    countersReserved(e19, t) {
      return this.countersReservedHandlers.add(e19), this.withAbort(t?.signal, () => this.countersReservedHandlers.delete(e19));
    }
    _emitCountersReserved(e19) {
      for (let t of this.countersReservedHandlers) T(t, e19, this.wallet.logger, { event: "countersReserved" });
    }
    async mintQuoteUpdates(e19, t, n, r) {
      await this.wallet.mint.connectWebSocket();
      let i = this.wallet.mint.webSocketConnection;
      if (!i) throw new _("Failed to establish WebSocket connection.");
      let a = Array.from(new Set(e19)), o = i.createSubscription({
        kind: "bolt11_mint_quote",
        filters: a
      }, t, n);
      return this.withAbort(r?.signal, () => i.cancelSubscription(o, t));
    }
    async mintQuotePaid(e19, t, n, r) {
      return this.mintQuoteUpdates([e19], (e20) => {
        e20.state === oi.PAID && t(e20);
      }, n, r);
    }
    async meltQuoteUpdates(e19, t, n, r) {
      await this.wallet.mint.connectWebSocket();
      let i = this.wallet.mint.webSocketConnection;
      if (!i) throw new _("Failed to establish WebSocket connection.");
      let a = Array.from(new Set(e19)), o = i.createSubscription({
        kind: "bolt11_melt_quote",
        filters: a
      }, t, n);
      return this.withAbort(r?.signal, () => i.cancelSubscription(o, t));
    }
    async meltQuotePaid(e19, t, n, r) {
      return this.meltQuoteUpdates([e19], (e20) => {
        e20.state === si.PAID && t(e20);
      }, n, r);
    }
    async proofStateUpdates(e19, t, n, r) {
      await this.wallet.mint.connectWebSocket();
      let i = this.wallet.mint.webSocketConnection;
      if (!i) throw new _("Failed to establish WebSocket connection.");
      let a = new TextEncoder(), o = /* @__PURE__ */ Object.create(null);
      for (let t2 of e19) {
        let e20 = Qe(a.encode(t2.secret)).toHex(true);
        if (o[e20]) throw new _("Duplicate proof secret in proofStateUpdates input");
        o[e20] = t2;
      }
      let s = Object.keys(o), c = (e20) => {
        let n2 = o[e20.Y];
        n2 && t({
          ...e20,
          proof: n2
        });
      }, l = i.createSubscription({
        kind: "proof_state",
        filters: s
      }, c, n);
      return this.withAbort(r?.signal, () => i.cancelSubscription(l, c));
    }
    onceMintPaid(e19, t) {
      return this.waitUntilPaid(this.mintQuotePaid.bind(this), e19, t, "Timeout waiting for mint paid");
    }
    onceAnyMintPaid(e19, t) {
      return new Promise((n, r) => {
        let i = Array.from(new Set(e19)), a = /* @__PURE__ */ new Map(), o = null, s = null, c = false, l = false, u = (e20) => {
          if (!l) {
            l = true;
            for (let e21 of a.values()) $(e21);
            a.clear(), o && (clearTimeout(o), o = null), t?.signal && t.signal.removeEventListener("abort", d), e20 && r(ea(e20));
          }
        }, d = () => u(ta());
        if (t?.signal) {
          if (t.signal.aborted) return d();
          t.signal.addEventListener("abort", d, { once: true });
        }
        if (t?.timeoutMs && t.timeoutMs > 0 && (o = setTimeout(() => u(new _("Timeout waiting for any mint paid")), t.timeoutMs)), i.length === 0) return u(new _("No quote ids provided"));
        for (let e20 of i) {
          let r2 = this.mintQuotePaid(e20, (t2) => {
            u(), n({
              id: e20,
              quote: t2
            });
          }, (n2) => {
            if (t?.failOnError) {
              u(n2);
              return;
            }
            s = n2;
            let r3 = a.get(e20);
            r3 && ($(r3), a.delete(e20)), c && a.size === 0 && u(s ?? new _("No subscriptions remaining"));
          });
          a.set(e20, r2), r2.catch((n2) => {
            if (t?.failOnError) {
              u(n2);
              return;
            }
            s = n2;
            let r3 = a.get(e20);
            r3 && ($(r3), a.delete(e20)), c && a.size === 0 && u(s ?? new _("No subscriptions remaining"));
          });
        }
        c = true;
      });
    }
    onceMeltPaid(e19, t) {
      return this.waitUntilPaid(this.meltQuotePaid.bind(this), e19, t, "Timeout waiting for melt paid");
    }
    proofStatesStream(e19, t) {
      return async function* () {
        let n = [], r = false, i = null, a = t?.maxBuffer && t.maxBuffer > 0 ? t.maxBuffer : Infinity, o = t?.drop ?? "oldest", s = () => {
          let e20 = i;
          i = null, e20 && e20();
        }, c = (e20) => {
          if (n.length >= a) if (o === "oldest") {
            let r2 = n.shift();
            if (r2 !== void 0) try {
              t?.onDrop?.(r2);
            } catch {
            }
            n.push(e20);
          } else {
            try {
              t?.onDrop?.(e20);
            } catch {
            }
            return;
          }
          else n.push(e20);
          s();
        }, l = null, u = this.proofStateUpdates(e19, c, () => {
          r = true, s();
        }, { signal: t?.signal });
        u.catch((e20) => {
          l = ea(e20), r = true, s();
        });
        let d = () => {
          r = true, s();
        };
        try {
          for (t?.signal && (t.signal.aborted ? d() : t.signal.addEventListener("abort", d, { once: true })); !r || n.length; ) {
            for (; n.length; ) yield n.shift();
            if (r) break;
            await new Promise((e20) => i = e20);
          }
          if (l) throw l;
        } finally {
          $(u), t?.signal && t.signal.removeEventListener("abort", d);
        }
      }.call(this);
    }
    group() {
      let e19 = [], t = false, n = (() => {
        if (!t) for (t = true; e19.length; ) $(e19.pop());
      });
      return n.add = (n2) => t ? ($(n2), n2) : (e19.push(n2), n2), Object.defineProperty(n, "cancelled", {
        get: () => t,
        enumerable: true
      }), n;
    }
  };
  var ra = class {
    constructor(e19) {
      this.wallet = e19;
    }
    send(e19, t) {
      return new ia(this.wallet, e19, t);
    }
    receive(e19) {
      return new aa(this.wallet, e19);
    }
    mintBolt11(e19, t) {
      return new oa(this.wallet, "bolt11", e19, t);
    }
    mintBolt12(e19, t) {
      return new oa(this.wallet, "bolt12", e19, t);
    }
    mintOnchain(e19, t) {
      return new oa(this.wallet, "onchain", e19, t);
    }
    meltBolt11(e19, t) {
      return new sa(this.wallet, "bolt11", e19, t);
    }
    meltBolt12(e19, t) {
      return new sa(this.wallet, "bolt12", e19, t);
    }
    meltOnchain(e19, t) {
      return new ca(this.wallet, e19, t);
    }
  };
  var ia = class {
    constructor(e19, t, n) {
      this.wallet = e19, this.proofs = n, this.config = {}, this.amount = k.from(t);
    }
    asRandom(e19) {
      return this.sendOT = {
        type: "random",
        denominations: e19
      }, this;
    }
    asDeterministic(e19 = 0, t) {
      return this.sendOT = {
        type: "deterministic",
        counter: e19,
        denominations: t
      }, this;
    }
    asP2PK(e19, t) {
      return this.sendOT = {
        type: "p2pk",
        options: e19,
        denominations: t
      }, this;
    }
    asFactory(e19, t) {
      return this.sendOT = {
        type: "factory",
        factory: e19,
        denominations: t
      }, this;
    }
    asCustom(e19) {
      return this.sendOT = {
        type: "custom",
        data: e19
      }, this;
    }
    keepAsRandom(e19) {
      return this.keepOT = {
        type: "random",
        denominations: e19
      }, this;
    }
    keepAsDeterministic(e19 = 0, t) {
      return this.keepOT = {
        type: "deterministic",
        counter: e19,
        denominations: t
      }, this;
    }
    keepAsP2PK(e19, t) {
      return this.keepOT = {
        type: "p2pk",
        options: e19,
        denominations: t
      }, this;
    }
    keepAsFactory(e19, t) {
      return this.keepOT = {
        type: "factory",
        factory: e19,
        denominations: t
      }, this;
    }
    keepAsCustom(e19) {
      return this.keepOT = {
        type: "custom",
        data: e19
      }, this;
    }
    includeFees(e19 = true) {
      return this.config.includeFees = e19, this;
    }
    keyset(e19) {
      return this.config.keysetId = e19, this;
    }
    privkey(e19) {
      return this.config.privkey = e19, this;
    }
    proofsWeHave(e19) {
      return this.config.proofsWeHave = e19, this;
    }
    onCountersReserved(e19) {
      return this.config.onCountersReserved = e19, this;
    }
    offlineExactOnly(e19 = false) {
      return this.offlineExact = { requireDleq: e19 }, this;
    }
    offlineCloseMatch(e19 = false) {
      return this.offlineClose = { requireDleq: e19 }, this;
    }
    async prepare() {
      let e19 = {
        send: this.sendOT ?? this.wallet.defaultOutputType(),
        ...this.keepOT ? { keep: this.keepOT } : {}
      };
      return this.wallet.prepareSwapToSend(this.amount, this.proofs, this.config, e19);
    }
    async run() {
      if ((this.offlineExact || this.offlineClose) && (this.sendOT || this.keepOT)) throw new _("Offline selection cannot be combined with custom output types. Remove send/keep output configuration, or use an online swap.");
      if (this.offlineExact) return this.config.privkey && (this.proofs = this.wallet.signP2PKProofs(this.proofs, this.config.privkey)), this.wallet.sendOffline(this.amount, this.proofs, {
        includeFees: this.config.includeFees,
        exactMatch: true,
        requireDleq: this.offlineExact.requireDleq
      });
      if (this.offlineClose) return this.config.privkey && (this.proofs = this.wallet.signP2PKProofs(this.proofs, this.config.privkey)), this.wallet.sendOffline(this.amount, this.proofs, {
        includeFees: this.config.includeFees,
        exactMatch: false,
        requireDleq: this.offlineClose.requireDleq
      });
      let e19 = {
        send: this.sendOT ?? this.wallet.defaultOutputType(),
        ...this.keepOT ? { keep: this.keepOT } : {}
      };
      return this.wallet.send(this.amount, this.proofs, this.config, e19);
    }
  };
  var aa = class {
    constructor(e19, t) {
      this.wallet = e19, this.token = t, this.config = {};
    }
    asRandom(e19) {
      return this.outputType = {
        type: "random",
        denominations: e19
      }, this;
    }
    asDeterministic(e19 = 0, t) {
      return this.outputType = {
        type: "deterministic",
        counter: e19,
        denominations: t
      }, this;
    }
    asP2PK(e19, t) {
      return this.outputType = {
        type: "p2pk",
        options: e19,
        denominations: t
      }, this;
    }
    asFactory(e19, t) {
      return this.outputType = {
        type: "factory",
        factory: e19,
        denominations: t
      }, this;
    }
    asCustom(e19) {
      return this.outputType = {
        type: "custom",
        data: e19
      }, this;
    }
    keyset(e19) {
      return this.config.keysetId = e19, this;
    }
    requireDleq(e19 = true) {
      return this.config.requireDleq = e19, this;
    }
    privkey(e19) {
      return this.config.privkey = e19, this;
    }
    proofsWeHave(e19) {
      return this.config.proofsWeHave = e19, this;
    }
    onCountersReserved(e19) {
      return this.config.onCountersReserved = e19, this;
    }
    async prepare() {
      return this.wallet.prepareSwapToReceive(this.token, this.config, this.outputType);
    }
    async run() {
      return this.wallet.receive(this.token, this.config, this.outputType);
    }
  };
  var oa = class {
    constructor(e19, t, n, r) {
      this.wallet = e19, this.method = t, this.quote = r, this.config = {}, this.amount = k.from(n), this._hasPrivkey;
    }
    asRandom(e19) {
      return this.outputType = {
        type: "random",
        denominations: e19
      }, this;
    }
    asDeterministic(e19 = 0, t) {
      return this.outputType = {
        type: "deterministic",
        counter: e19,
        denominations: t
      }, this;
    }
    asP2PK(e19, t) {
      return this.outputType = {
        type: "p2pk",
        options: e19,
        denominations: t
      }, this;
    }
    asFactory(e19, t) {
      return this.outputType = {
        type: "factory",
        factory: e19,
        denominations: t
      }, this;
    }
    asCustom(e19) {
      return this.outputType = {
        type: "custom",
        data: e19
      }, this;
    }
    keyset(e19) {
      return this.config.keysetId = e19, this;
    }
    privkey(e19) {
      return this.config.privkey = e19, this;
    }
    proofsWeHave(e19) {
      return this.config.proofsWeHave = e19, this;
    }
    onCountersReserved(e19) {
      return this.config.onCountersReserved = e19, this;
    }
    async prepare() {
      if (this.method === "bolt11") {
        let e20 = this.quote, t = typeof e20 == "string" ? await this.wallet.checkMintQuoteBolt11(e20) : e20;
        if (this.wallet.validateMintQuote(t), t.pubkey && !this.config.privkey) throw new _("privkey is required for locked BOLT11 mint quotes");
        return this.wallet.prepareMint(this.method, this.amount, t, this.config, this.outputType);
      }
      if (this.method === "bolt12") {
        let e20 = this.quote;
        if (this.wallet.validateMintQuote(e20), !this.config.privkey) throw Error("privkey is required for BOLT12 mint quotes");
        return this.wallet.prepareMint(this.method, this.amount, e20, this.config, this.outputType);
      }
      let e19 = this.quote;
      if (this.wallet.validateMintQuote(e19), !this.config.privkey) throw new _("privkey is required for onchain mint quotes");
      return this.wallet.prepareMint(this.method, this.amount, e19, this.config, this.outputType);
    }
    async run() {
      let e19 = await this.prepare();
      return this.wallet.completeMint(e19);
    }
  };
  var sa = class {
    constructor(e19, t, n, r) {
      this.wallet = e19, this.method = t, this.quote = n, this.proofs = r, this.config = {};
    }
    asRandom(e19) {
      return this.outputType = {
        type: "random",
        denominations: e19
      }, this;
    }
    asDeterministic(e19 = 0, t) {
      return this.outputType = {
        type: "deterministic",
        counter: e19,
        denominations: t
      }, this;
    }
    asP2PK(e19, t) {
      return this.outputType = {
        type: "p2pk",
        options: e19,
        denominations: t
      }, this;
    }
    asFactory(e19, t) {
      return this.outputType = {
        type: "factory",
        factory: e19,
        denominations: t
      }, this;
    }
    asCustom(e19) {
      return this.outputType = {
        type: "custom",
        data: e19
      }, this;
    }
    keyset(e19) {
      return this.config.keysetId = e19, this;
    }
    privkey(e19) {
      return this.config.privkey = e19, this;
    }
    onCountersReserved(e19) {
      return this.config.onCountersReserved = e19, this;
    }
    async prepare() {
      return await this.wallet.prepareMelt(this.method, this.quote, this.proofs, this.config, this.outputType);
    }
    async run() {
      let e19 = await this.wallet.prepareMelt(this.method, this.quote, this.proofs, this.config, this.outputType);
      return this.wallet.completeMelt(e19, this.config.privkey);
    }
  };
  var ca = class {
    constructor(e19, t, n) {
      this.wallet = e19, this.quote = t, this.proofs = n, this.config = {};
    }
    keyset(e19) {
      return this.config.keysetId = e19, this;
    }
    privkey(e19) {
      return this.config.privkey = e19, this;
    }
    feeIndex(e19) {
      return this.selectedFeeIndex = e19, this;
    }
    async run() {
      if (this.selectedFeeIndex === void 0 && this.quote.fee_options.length === 1 && (this.selectedFeeIndex = this.quote.fee_options[0].fee_index), this.selectedFeeIndex === void 0) throw Error("feeIndex is required when an onchain melt quote has multiple fee options");
      return this.wallet.meltProofsOnchain(this.quote, this.proofs, this.selectedFeeIndex, this.config);
    }
  };
  var la = "__PENDING__";
  var ua = class e17 {
    constructor(e19, t) {
      this._seed = void 0, this._unit = "sat", this._mintInfo = void 0, this._denominationTarget = 3, this._secretsPolicy = "auto", this._boundKeysetId = la, this._requireSigDleq = false, this.ops = new ra(this), this.on = new na(this), this._logger = t?.logger ?? S, this._selectProofs = t?.selectProofs ?? Gi, this._outputDataCreator = t?.outputDataCreator ?? new Ki(), this.mint = typeof e19 == "string" ? new Fi(e19, {
        authProvider: t?.authProvider,
        logger: this._logger
      }) : e19, this._unit = t?.unit ?? this._unit, this._boundKeysetId = t?.keysetId ?? this._boundKeysetId, t?.bip39seed && (this.failIf(!(t.bip39seed instanceof Uint8Array), "bip39seed must be a valid Uint8Array", { bip39seed: t.bip39seed }), this._seed = t.bip39seed), this._secretsPolicy = t?.secretsPolicy ?? this._secretsPolicy, t?.counterSource ? this._counterSource = t.counterSource : this._counterSource = new Xi(t?.counterInit), this.counters = new Qi(this._counterSource), this._keyChain = new Li(this.mint, this._unit), this._denominationTarget = t?.denominationTarget ?? this._denominationTarget, this._requireSigDleq = t?.requireSigDleq ?? this._requireSigDleq;
    }
    fail(e19, t) {
      return C(e19, this._logger, t);
    }
    failIf(e19, t, n) {
      return w(e19, t, this._logger, n);
    }
    failIfNullish(e19, t, n) {
      return ee(e19, t, this._logger, n);
    }
    requireSupport(e19, t) {
      this.failIf(!this.getMintInfo().supportsMintMeltMethod(e19, t, this._unit), `Mint does not support ${t} ${e19} for unit '${this._unit}'`);
    }
    safeCallback(e19, t, n) {
      T(e19, t, this._logger, n);
    }
    parseAmount(e19, t, n = false) {
      try {
        let r = k.from(e19);
        return n || this.failIf(r.isZero(), `Amount must be positive: ${r.toString()}`, {
          op: t,
          amount: e19
        }), r;
      } catch (n2) {
        let r = n2 instanceof Error ? n2.message : String(n2);
        throw this._logger.error(r, {
          op: t,
          amount: e19
        }), new _(r, { cause: n2 });
      }
    }
    async loadMint(e19) {
      let t = [];
      (!this._mintInfo || e19) && t.push(this.mint.getInfo().then((e20) => (this._mintInfo = new X(e20, this._logger), this.mint.setMintInfo(this._mintInfo), null))), t.push(this._keyChain.init(e19)), await Promise.all(t), this.finishInit();
    }
    loadMintFromCache(e19, t) {
      this._mintInfo = new X(e19, this._logger), this.mint.setMintInfo(this._mintInfo), this._keyChain.loadFromCache(t), this.finishInit();
    }
    finishInit() {
      if (this._logger.debug("KeyChain", { keychain: this._keyChain.cache }), this._boundKeysetId === la) try {
        this._boundKeysetId = this._keyChain.getCheapestKeyset().id;
      } catch (e19) {
        this._logger.warn("No active keyset available, wallet remains unbound", {
          unit: this._unit,
          err: e19.message
        });
      }
      else {
        let e19 = this._keyChain.getKeyset(this._boundKeysetId);
        this.failIf(e19.unit !== this._unit, "Keyset unit does not match wallet unit", {
          keyset: e19.id,
          unit: e19.unit,
          walletUnit: this._unit
        });
      }
      this.getMintInfo();
    }
    get keyChain() {
      return this._keyChain;
    }
    get unit() {
      return this._unit;
    }
    getMintInfo() {
      return this.failIfNullish(this._mintInfo, "Mint info not initialized; call loadMint or loadMintFromCache first"), this._mintInfo;
    }
    get keysetId() {
      return this.failIf(this._boundKeysetId === la, "Wallet has no bound keyset. The mint may have no active keysets, or wallet was not initialized via loadMint or loadMintFromCache"), this._boundKeysetId;
    }
    getKeyset(e19) {
      let t = this._keyChain.getKeyset(e19 ?? this.keysetId);
      return this.failIf(t.unit !== this._unit, "Keyset unit does not match wallet unit", {
        keyset: t.id,
        unit: t.unit,
        walletUnit: this._unit
      }), this.failIf(!t.hasKeys, "Keyset has no keys loaded", { keyset: t.id }), t;
    }
    get logger() {
      return this._logger;
    }
    async reserveFor(e19, t) {
      return t <= 0 ? {
        start: 0,
        count: 0
      } : this._counterSource.reserve(e19, t);
    }
    countersNeeded(e19) {
      return e19.type !== "deterministic" || e19.counter !== 0 ? 0 : (e19.denominations ?? []).length;
    }
    async addCountersToOutputTypes(e19, ...t) {
      let n = t.filter((e20) => e20.type === "deterministic" && e20.counter > 0 && (e20.denominations?.length ?? 0) > 0);
      if (n.length > 1) {
        let t2 = n.map((e20) => ({
          start: e20.counter,
          end: e20.counter + e20.denominations.length
        })).sort((e20, t3) => e20.start - t3.start);
        for (let n2 = 1; n2 < t2.length; n2++) this.failIf(t2[n2].start < t2[n2 - 1].end, "Manual counter ranges overlap", {
          keysetId: e19,
          prev: t2[n2 - 1],
          cur: t2[n2]
        });
      }
      if (n.length > 0) {
        let t2 = Math.max(...n.map((e20) => e20.counter + e20.denominations.length));
        await this._counterSource.advanceToAtLeast(e19, t2), this._logger.debug("Counter source advanced to respect manual deterministic counters", {
          keysetId: e19,
          maxManualEnd: t2
        });
      }
      let r = t.reduce((e20, t2) => e20 + this.countersNeeded(t2), 0);
      if (r === 0) return { outputTypes: t };
      let i = await this.reserveFor(e19, r), a = i.start, o = t.map((e20) => {
        if (e20.type === "deterministic" && e20.counter === 0) {
          let t2 = e20.denominations?.length ?? 0;
          if (t2 > 0) {
            let n2 = {
              ...e20,
              counter: a
            };
            return a += t2, n2;
          }
        }
        return e20;
      }), s = {
        keysetId: e19,
        start: i.start,
        count: i.count,
        next: i.start + i.count
      };
      return this.on._emitCountersReserved(s), {
        outputTypes: o,
        used: s
      };
    }
    bindKeyset(e19) {
      let t = this._keyChain.getKeyset(e19);
      this.failIf(t.unit !== this._unit, "Keyset unit does not match wallet unit", {
        keyset: t.id,
        unit: t.unit,
        walletUnit: this._unit
      }), this.failIf(!t.hasKeys, "Keyset has no keys loaded", { keyset: t.id }), this._boundKeysetId = t.id, this._logger.debug("Wallet bound to keyset", {
        keysetId: t.id,
        unit: t.unit,
        feePPK: t.fee
      });
    }
    withKeyset(t, n) {
      let r = new e17(this.mint, {
        keysetId: t,
        bip39seed: this._seed,
        secretsPolicy: this._secretsPolicy,
        outputDataCreator: this._outputDataCreator,
        requireSigDleq: this._requireSigDleq,
        logger: this._logger,
        counterSource: n?.counterSource ?? this._counterSource
      });
      return r.loadMintFromCache(this.getMintInfo().cache, this._keyChain.cache), r;
    }
    defaultOutputType() {
      return this._secretsPolicy === "random" ? { type: "random" } : this._secretsPolicy === "deterministic" ? (this.failIfNullish(this._seed, "Deterministic policy requires a seed"), {
        type: "deterministic",
        counter: 0
      }) : this._seed ? {
        type: "deterministic",
        counter: 0
      } : { type: "random" };
    }
    configureOutputs(e19, t, n, r = false, i = []) {
      let a = this.parseAmount(e19, "configureOutputs", true), o = i.map((e20) => ({ amount: k.from(e20.amount) }));
      if (n.type === "custom") {
        this.failIf(r, "The custom OutputType does not support automatic fee inclusion");
        let e20 = this.parseAmount(Q.sumOutputAmounts(n.data), "configureOutputs.customTotal", true);
        return this.failIf(!e20.equals(a), `Custom output data total (${e20.toString()}) does not match amount (${a.toString()})`), n;
      }
      let s = n.denominations ?? [];
      if (s.length === 0 && o.length > 0 && (s = Ji(o, a, t.keys, this._denominationTarget)), s = H(a, t.keys, s), r) {
        let e20 = this.getFeesForKeyset(s.length, t.id), n2 = H(e20, t.keys);
        for (; this.getFeesForKeyset(s.length + n2.length, t.id).greaterThan(e20); ) e20 = e20.add(1), n2 = H(e20, t.keys);
        a = a.add(e20), s = [...s, ...n2];
      }
      return {
        ...n,
        denominations: s
      };
    }
    preparedTotal(e19) {
      if (e19.type === "custom") return Q.sumOutputAmounts(e19.data);
      let t = e19.denominations ?? [];
      return k.sum(t);
    }
    createOutputData(e19, t, n) {
      let r = this.parseAmount(e19, "createOutputData", true);
      if (n.type != "custom" && n.denominations && n.denominations.length > 0) {
        let e20 = k.sum(n.denominations);
        this.failIf(!e20.equals(r), "Denominations do not sum to the expected amount", {
          splitSum: e20.toString(),
          expected: r.toString()
        });
      }
      let i;
      switch (n.type) {
        case "random":
          i = this._outputDataCreator.createRandomData(r, t, n.denominations);
          break;
        case "deterministic":
          this.failIfNullish(this._seed, "Deterministic outputs require a seed configured in the wallet"), i = this._outputDataCreator.createDeterministicData(r, this._seed, n.counter, t, n.denominations);
          break;
        case "p2pk":
          i = this._outputDataCreator.createP2PKData(n.options, r, t, n.denominations);
          break;
        case "factory":
          i = H(r, t.keys, n.denominations).map((e20) => n.factory(e20, t));
          break;
        case "custom": {
          i = n.data;
          let e20 = this.parseAmount(Q.sumOutputAmounts(i), "createOutputData.customTotal", true);
          this.failIf(!e20.equals(r), `Custom output data total (${e20.toString()}) does not match amount (${r.toString()})`);
          break;
        }
        default:
          this.fail("Invalid OutputType");
      }
      return i;
    }
    createSwapTransaction(e19, t, n = []) {
      e19 = this._prepareInputsForMint(e19);
      let r = [...t, ...n], i = r.map((e20, t2) => t2);
      $t(e19) || i.sort((e20, t2) => r[e20].blindedMessage.amount.compareTo(r[t2].blindedMessage.amount));
      let a = [...Array.from({ length: t.length }, () => true), ...Array.from({ length: n.length }, () => false)], o = i.map((e20) => r[e20]), s = i.map((e20) => a[e20]), c = o.map((e20) => e20.blindedMessage);
      return this._logger.debug("createSwapTransaction:", {
        indices: i,
        sortedKeepVector: s
      }), {
        payload: {
          inputs: e19,
          outputs: c
        },
        outputData: o,
        keepVector: s,
        sortedIndices: i
      };
    }
    async receive(e19, t, n) {
      let r = await this.prepareSwapToReceive(e19, t, n), { keep: i } = await this.completeSwap(r, t?.privkey);
      return i;
    }
    async prepareSwapToReceive(e19, t, n) {
      let { keysetId: r, requireDleq: i, proofsWeHave: a, onCountersReserved: o } = t || {};
      n = n ?? this.defaultOutputType();
      let s;
      if (Array.isArray(e19)) s = J(e19);
      else {
        let t2 = typeof e19 == "string" ? this.decodeToken(e19) : e19, n2 = Gr(t2.mint);
        this.failIf(n2 !== this.mint.mintUrl, "Token belongs to a different mint", {
          token: n2,
          wallet: this.mint.mintUrl
        }), this.failIf(t2.unit !== this._unit, "Token is not in wallet unit", {
          token: t2.unit,
          wallet: this._unit
        }), s = J(t2.proofs);
      }
      let c = this._keyChain.getKeysets().map((e20) => e20.id), l = s.find((e20) => !e20.id || !c.includes(e20.id));
      this.failIf(!!l, `Proof has unrecognised keyset. '${l?.id}' is not a ${this._unit} keyset from this mint`, {
        id: l?.id,
        knownIds: c
      });
      let u = this.parseAmount(q(s), "prepareSwapToReceive", true);
      this.failIf(u.isZero(), "Token contains no proofs", { proofs: s });
      for (let e20 of s) {
        let t2 = this._keyChain.getKeyset(e20.id);
        i ? this.failIf(!Zr(e20, t2), "Token contains proofs with invalid or missing DLEQ") : this.failIf(!Qr(e20, t2), "Token contains a proof with an invalid DLEQ");
      }
      let d = this.getKeyset(r), f = this.getFeesForProofs(s), p = u.subtract(f), m = this.configureOutputs(p, d, n, false, a), h = await this.addCountersToOutputTypes(d.id, m);
      [m] = h.outputTypes, h.used && this.safeCallback(o, h.used, { op: "receive" }), this._logger.debug("receive counter", {
        counter: h.used,
        receiveOT: Yi(m)
      });
      let g = this.createOutputData(this.preparedTotal(m), d, m);
      return {
        amount: p,
        fees: f,
        keysetId: d.id,
        inputs: s,
        keepOutputs: g
      };
    }
    sendOffline(e19, t, n) {
      let r = this.parseAmount(e19, "sendOffline"), i = J(t), { requireDleq: a = false, includeFees: o = false, exactMatch: s = true } = n || {};
      a && (i = i.filter((e20) => e20.dleq != null)), this.failIf(q(i).lessThan(r), "Not enough funds available to send");
      let { keep: c, send: l } = this.selectProofsToSend(i, r, o, s);
      return {
        keep: c,
        send: this._prepareInputsForMint(l, a, true)
      };
    }
    async send(e19, t, n, r) {
      let i = this.parseAmount(e19, "send"), { keysetId: a, includeFees: o = false } = n || {};
      r = r ?? {
        send: this.defaultOutputType(),
        keep: this.defaultOutputType()
      };
      try {
        let e20 = this.defaultOutputType().type === "deterministic", n2 = (e21) => !e21 || e21.type === "random" && (!e21.denominations || e21.denominations.length === 0);
        if (a || e20 || !n2(r.send) || r.keep && !n2(r.keep)) {
          let t2 = [];
          throw a && t2.push("keysetId override"), e20 && t2.push("wallet default is deterministic"), n2(r.send) || t2.push("non-default send output type"), r.keep && !n2(r.keep) && t2.push("non-default keep output type"), new _(`Options require a swap: ${t2.join(", ")}`);
        }
        let { keep: s2, send: c } = this.sendOffline(i, t, {
          includeFees: o,
          exactMatch: true,
          requireDleq: false
        }), l = o ? this.getFeesForProofs(c) : k.zero();
        if (q(c).equals(i.add(l))) return this._logger.info("Successful exactMatch offline selection!"), {
          keep: s2,
          send: c
        };
      } catch (e20) {
        let t2 = e20 instanceof Error ? e20.message : "Unknown error";
        this._logger.debug("ExactMatch offline selection failed.", { e: t2 });
      }
      let s = await this.prepareSwapToSend(i, t, n, r);
      return await this.completeSwap(s, n?.privkey);
    }
    async prepareSwapToSend(e19, t, n, r) {
      let i = this.parseAmount(e19, "prepareSwapToSend"), a = J(t), { keysetId: o, includeFees: s = false, onCountersReserved: c } = n || {};
      r = r ?? {
        send: this.defaultOutputType(),
        keep: this.defaultOutputType()
      };
      let l = this.getKeyset(o), u = this.configureOutputs(i, l, r.send ?? this.defaultOutputType(), s), d = this.preparedTotal(u), { keep: f, send: p } = this.selectProofsToSend(a, d, true);
      if (p.length === 0) throw new _("Not enough funds available to send");
      let m = q(p), h = this.getFeesForProofs(p), g = d.add(h);
      m.lessThan(g) && this.failIf(true, "Not enough funds available for swap", {
        selectedSum: m.toString(),
        required: g.toString()
      });
      let v2 = m.subtract(g), y2 = this.configureOutputs(v2, l, r.keep ?? this.defaultOutputType(), false, n?.proofsWeHave), b2 = this.preparedTotal(y2), x2 = await this.addCountersToOutputTypes(l.id, u, y2);
      [u, y2] = x2.outputTypes, x2.used && this.safeCallback(c, x2.used, { op: "send" }), this._logger.debug("send counters", {
        counter: x2.used,
        sendOT: Yi(u),
        keepOT: Yi(y2)
      });
      let S2 = this.createOutputData(d, l, u), C2 = this.createOutputData(b2, l, y2);
      return {
        amount: i,
        fees: h,
        keysetId: l.id,
        inputs: p,
        sendOutputs: S2,
        keepOutputs: C2,
        unselectedProofs: f
      };
    }
    async completeSwap(e19, t) {
      let n = e19?.keepOutputs ? e19.keepOutputs : [], r = e19.sendOutputs ? e19.sendOutputs : [], i = e19.unselectedProofs ? e19.unselectedProofs : [];
      t && (e19.inputs = this.signP2PKProofs(e19.inputs, t, [...n, ...r]));
      let a = this.createSwapTransaction(e19.inputs, n, r), { signatures: o } = await this.mint.swap(a.payload);
      this.failIf(o.length !== a.outputData.length, `Mint returned ${o.length} signatures, expected ${a.outputData.length}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.validateReturnedSignatures(o, a.outputData);
      let s = this.getKeyset(e19.keysetId), c = a.outputData.map((e20, t2) => e20.toProof(o[t2], s)), l = Array(c.length), u = Array(a.keepVector.length);
      a.sortedIndices.forEach((e20, t2) => {
        u[e20] = a.keepVector[t2], l[e20] = c[t2];
      });
      let d = [], f = [];
      return l.forEach((e20, t2) => {
        u[t2] ? d.push(e20) : f.push(e20);
      }), this._logger.debug("SEND COMPLETED", {
        unselectedProofs: i.map((e20) => e20.amount.toString()),
        keepProofs: d.map((e20) => e20.amount.toString()),
        sendProofs: f.map((e20) => e20.amount.toString())
      }), {
        keep: [...d, ...i],
        send: f
      };
    }
    selectProofsToSend(e19, t, n = false, r = false) {
      let i = this.parseAmount(t, "selectProofsToSend"), { keep: a, send: o } = this._selectProofs(e19, i, this._keyChain, n, r);
      return {
        keep: a,
        send: o
      };
    }
    signP2PKProofs(e19, t, n, r) {
      let i = J(e19);
      if (!$t(i)) return Gt(i, t, this._logger);
      this.failIfNullish(n, "OutputData is required for SIG_ALL proof signing."), Zt(i);
      let [a, ...o] = i, s = a, c = [dn(i, n, r), Qt(i, n, r)];
      for (let e20 of c) s = Gt([s], t, this._logger, e20)[0];
      return [s, ...o];
    }
    getFeesForProofs(e19) {
      let t = k.sum(e19.map((e20) => this.getProofFeePPK(e20))).toBigInt();
      return k.from((t + 999n) / 1000n);
    }
    getProofFeePPK(e19) {
      try {
        return this._keyChain.getKeyset(e19.id).fee;
      } catch (t) {
        let n = `Could not get fee. No keyset found for keyset id: ${e19.id}`;
        throw this._logger.error(n, {
          e: t,
          keychain: this._keyChain.getKeysets()
        }), new _(n, { cause: t });
      }
    }
    getFeesForKeyset(e19, t) {
      try {
        let n = this._keyChain.getKeyset(t).fee;
        return k.from(Math.floor(Math.max((e19 * n + 999) / 1e3, 0)));
      } catch (e20) {
        let n = `No keyset found with ID ${t}`;
        throw this._logger.error(n, { e: e20 }), new _(n, { cause: e20 });
      }
    }
    maxSpendableAfterFees(e19, t = 0) {
      let n = q(e19), r = this.getFeesForProofs(e19).add(t);
      return r.greaterThanOrEqual(n) ? k.zero() : n.subtract(r);
    }
    _prepareInputsForMint(e19, t = false, n = false) {
      return e19.map((e20) => {
        let r = this._normalizeWitness(e20), { dleq: i, p2pk_e: a, ...o } = e20, s = {
          ...o,
          witness: r
        };
        return n && a && (s = {
          ...s,
          p2pk_e: a
        }), t && i && (s = {
          ...s,
          dleq: i
        }), s;
      });
    }
    _normalizeWitness(e19) {
      if (e19.witness) {
        try {
          F(e19.secret);
        } catch {
          return;
        }
        return typeof e19.witness == "string" ? e19.witness : JSON.stringify(e19.witness);
      }
    }
    decodeToken(e19) {
      return zr(e19, this._keyChain.getAllKeysetIds());
    }
    async batchRestore(e19 = 300, t = 300, n = 0, r) {
      let i = Math.ceil(e19 / t), a = [], o, s = 0;
      for (; s < i; ) {
        let e20 = await this.restore(n, t, { keysetId: r });
        e20.proofs.length > 0 ? (s = 0, a.push(...e20.proofs), o = e20.lastCounterWithSignature) : s++, n += t;
      }
      return {
        proofs: a,
        lastCounterWithSignature: o
      };
    }
    async restore(e19, t, n) {
      this.failIfNullish(this._seed, "Cashu Wallet must be initialized with a seed to use restore");
      let { keysetId: r } = n || {};
      await this._keyChain.ensureKeysetKeys(r ?? this.keysetId);
      let i = this.getKeyset(r), a = Array(t).fill(0), o = this._outputDataCreator.createDeterministicData(0, this._seed, e19, i, a), { outputs: s, signatures: c } = await this.mint.restore({ outputs: o.map((e20) => e20.blindedMessage) }), l = {};
      s.forEach((e20, t2) => l[e20.B_] = c[t2]);
      let u = [], d;
      for (let t2 = 0; t2 < o.length; t2++) {
        let n2 = l[o[t2].blindedMessage.B_];
        n2 && (d = e19 + t2, o[t2].blindedMessage.amount = n2.amount, u.push(o[t2].toProof(n2, i)));
      }
      return {
        proofs: u,
        lastCounterWithSignature: d
      };
    }
    async createMintQuote(e19, t, n) {
      let r = {
        ...t,
        unit: this._unit
      }, i = await this.mint.createMintQuote(e19, r, { normalize: n?.normalize });
      return {
        ...i,
        unit: i.unit || this._unit
      };
    }
    async createMintQuoteBolt11(e19, t) {
      this.requireSupport("mint", "bolt11");
      let n = this.parseAmount(e19, "createMintQuoteBolt11");
      t && (this.getMintInfo().supportsNut04Description("bolt11", this._unit) || this.fail("Mint does not support description for bolt11"));
      let r = {
        unit: this._unit,
        amount: n,
        description: t
      }, i = await this.mint.createMintQuoteBolt11(r);
      return {
        ...i,
        unit: i.unit || this._unit
      };
    }
    async createLockedMintQuote(e19, t, n) {
      this.requireSupport("mint", "bolt11");
      let r = this.parseAmount(e19, "createLockedMintQuote"), { supported: i } = this.getMintInfo().isSupported(20);
      this.failIf(!i, "Mint does not support NUT-20");
      let a = {
        unit: this._unit,
        amount: r,
        description: n,
        pubkey: t
      }, o = await this.mint.createMintQuoteBolt11(a);
      this.failIf(typeof o.pubkey != "string", "Mint returned unlocked mint quote");
      let s = o.pubkey;
      return {
        ...o,
        pubkey: s,
        unit: o.unit || this._unit
      };
    }
    async createMintQuoteBolt12(e19, t) {
      this.requireSupport("mint", "bolt12");
      let n = this.getMintInfo();
      t?.description && !n.supportsNut04Description("bolt12", this._unit) && this.fail("Mint does not support description for bolt12");
      let r = t?.amount === void 0 ? void 0 : this.parseAmount(t.amount, "createMintQuoteBolt12"), i = {
        pubkey: e19,
        unit: this._unit,
        amount: r,
        description: t?.description
      };
      return this.mint.createMintQuoteBolt12(i);
    }
    async createMintQuoteOnchain(e19) {
      this.requireSupport("mint", "onchain");
      let t = await this.mint.createMintQuoteOnchain({
        unit: this._unit,
        pubkey: e19
      });
      return {
        ...t,
        unit: t.unit || this._unit
      };
    }
    async checkMintQuote(e19, t, n) {
      let r = typeof t == "string" ? t : t.quote;
      return this.mint.checkMintQuote(e19, r, { normalize: n?.normalize });
    }
    async checkMintQuoteBolt11(e19) {
      let t = typeof e19 == "string" ? e19 : e19.quote;
      return this.mint.checkMintQuoteBolt11(t);
    }
    async checkMintQuoteBolt12(e19) {
      return this.mint.checkMintQuoteBolt12(e19);
    }
    async checkMintQuoteOnchain(e19) {
      return this.mint.checkMintQuoteOnchain(e19);
    }
    validateReturnedSignatures(e19, t, n) {
      let r = this._requireSigDleq && (this._mintInfo?.isSupported(12).supported ?? false), i = n?.checkAmounts ?? true;
      for (let n2 = 0; n2 < e19.length; n2++) this.failIf(e19[n2] == null, `Mint response is missing a signature at index ${n2}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.failIf(e19[n2].id !== t[n2].blindedMessage.id, `Mint signature keyset id at index ${n2} does not match output: expected ${t[n2].blindedMessage.id}, got ${e19[n2].id}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.failIf(i && !e19[n2].amount.equals(t[n2].blindedMessage.amount), `Mint returned signature with wrong amount at index ${n2}: expected ${t[n2].blindedMessage.amount.toString()}, got ${e19[n2].amount.toString()}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.failIf(r && !e19[n2].dleq, `Mint supports NUT-12, but returned a signature without DLEQ proof at index ${n2}. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`);
    }
    validateMintQuoteAvailableAmount(e19, t, n) {
      if (e19 !== "bolt12" && e19 !== "onchain" || !("amount_paid" in t) || !("amount_issued" in t)) return;
      let r = k.from(t.amount_paid), i = k.from(t.amount_issued), a = r.subtract(i);
      this.failIf(n.greaterThan(a), `Mint quote ${t.quote} has only ${a.toString()} available to mint; requested ${n.toString()}`, {
        method: e19,
        amount_paid: r.toString(),
        amount_issued: i.toString(),
        requestedAmount: n.toString()
      });
    }
    validateMintQuote(e19) {
      this.failIf("unit" in e19 && typeof e19.unit == "string" && e19.unit !== this.unit, `Quote unit '${e19.unit}' does not match wallet unit '${this.unit}'`), this.failIf("expiry" in e19 && typeof e19.expiry == "number" && e19.expiry > 0 && e19.expiry < Math.floor(Date.now() / 1e3), `Mint quote ${e19.quote} has expired`);
    }
    validateMeltQuote(e19) {
      this.failIf("unit" in e19 && typeof e19.unit == "string" && e19.unit !== this.unit, `Quote unit '${e19.unit}' does not match wallet unit '${this.unit}'`);
    }
    async mintProofs(e19, t, n, r, i) {
      let a = await this.prepareMint(e19, t, n, r, i);
      return this.completeMint(a);
    }
    async mintProofsBolt11(e19, t, n, r) {
      if (this.requireSupport("mint", "bolt11"), typeof t == "string") {
        let i2 = { quote: t }, a = await this.prepareMint("bolt11", e19, i2, n, r);
        return this.completeMint(a);
      }
      this.validateMintQuote(t);
      let i = await this.prepareMint("bolt11", e19, t, n, r);
      return this.completeMint(i);
    }
    async mintProofsBolt12(e19, t, n, r, i) {
      this.requireSupport("mint", "bolt12");
      let a = await this.prepareMint("bolt12", e19, t, {
        ...r,
        privkey: n
      }, i);
      return this.completeMint(a);
    }
    async mintProofsOnchain(e19, t, n, r, i) {
      this.requireSupport("mint", "onchain");
      let a = await this.prepareMint("onchain", e19, t, {
        ...r,
        privkey: n
      }, i);
      return this.completeMint(a);
    }
    async prepareMint(e19, t, n, r, i) {
      this.failIf(typeof n == "string", "prepareMint: expected a quote object, not a string ID. Use mintBolt11() which accepts string quote IDs."), this.validateMintQuote(n);
      let a = this.parseAmount(t, `prepareMint: ${e19}`);
      this.validateMintQuoteAvailableAmount(e19, n, a), i = i ?? this.defaultOutputType();
      let { privkey: o, keysetId: s, proofsWeHave: c, onCountersReserved: l } = r ?? {}, u = this.getKeyset(s), d = this.configureOutputs(a, u, i, false, c), f = this.preparedTotal(d), p = await this.addCountersToOutputTypes(u.id, d);
      [d] = p.outputTypes, p.used && this.safeCallback(l, p.used, { op: "mintProofs" }), this._logger.debug("mint counter", {
        counter: p.used,
        mintOT: Yi(d)
      });
      let m = this.createOutputData(f, u, d), h = m.map((e20) => e20.blindedMessage), g = {
        outputs: h,
        quote: n.quote
      };
      if ("pubkey" in n && n.pubkey && this.failIf(!o, "Can not sign locked quote without private key"), o) {
        let e20 = "pubkey" in n ? n.pubkey : void 0;
        this.failIf(!e20 && Array.isArray(o), `prepareMint: multiple privkeys supplied for quote '${n.quote}' without pubkey`);
        let t2 = e20 ? dt(e20, o) : Array.isArray(o) ? o[0] : o;
        this.failIf(!t2, "prepareMint: privkey is empty or correct privkey not provided"), g.signature = Ln(t2, n.quote, h);
      }
      return {
        method: e19,
        payload: g,
        outputData: m,
        keysetId: u.id,
        quote: n
      };
    }
    async completeMint(e19) {
      let { payload: t, outputData: n, keysetId: r, method: i } = e19, { signatures: a } = await this.mint.mint(i, t);
      this.failIf(a.length !== n.length, `Mint returned ${a.length} signatures, expected ${n.length}. The mint quote may already be marked issued; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.validateReturnedSignatures(a, n);
      let o = this.getKeyset(r);
      return this._logger.debug("MINT COMPLETED", { amounts: n.map((e20) => e20.blindedMessage.amount.toString()) }), n.map((e20, t2) => e20.toProof(a[t2], o));
    }
    async prepareBatchMint(e19, t, n, r) {
      this.failIf(t.length === 0, "prepareBatchMint: no entries provided");
      let i = this._mintInfo?.isSupported(29), a = i?.supported ? i.params : void 0, o = a?.max_batch_size ?? 100;
      if (t.length > o) {
        let e20 = a?.max_batch_size == null ? "cashu-ts internal cap" : "mint's advertised limit";
        this.failIf(true, `prepareBatchMint: batch size ${t.length} exceeds ${e20} of ${o}`);
      }
      a?.methods?.length && (a.methods.includes(e19) || this._logger.warn(`prepareBatchMint: method '${e19}' is not in mint's advertised NUT-29 methods`));
      let { privkey: s, keysetId: c, proofsWeHave: l, onCountersReserved: u } = n ?? {};
      for (let e20 of t) this.failIf(typeof e20.quote == "string", "prepareBatchMint: expected a quote object, not a string ID"), this.validateMintQuote(e20.quote);
      t.some((e20) => "pubkey" in e20.quote && e20.quote.pubkey) && this.failIf(!s, "Can not sign locked quotes without private key");
      let d = this.getKeyset(c), f = t.map((t2) => this.parseAmount(t2.amount, `prepareBatchMint: ${e19}`)), p = k.sum(f);
      r = r ?? this.defaultOutputType();
      let m = this.configureOutputs(p, d, r, false, l), h = await this.addCountersToOutputTypes(d.id, m);
      [m] = h.outputTypes, h.used && this.safeCallback(u, h.used, { op: "mintProofs" });
      let g = this.createOutputData(p, d, m), _2 = g.map((e20) => e20.blindedMessage), v2 = [], y2 = false;
      for (let e20 of t) {
        let t2 = "pubkey" in e20.quote ? e20.quote.pubkey : void 0;
        if (t2 && s) {
          let n2 = dt(t2, s);
          v2.push(Ln(n2, e20.quote.quote, _2)), y2 = true;
        } else s && !t2 && this._logger.warn(`prepareBatchMint: privkey supplied but quote '${e20.quote.quote}' has no pubkey \u2014 treating as unlocked`), v2.push(null);
      }
      return {
        method: e19,
        payload: {
          quotes: t.map((e20) => e20.quote.quote),
          quote_amounts: f,
          outputs: _2,
          ...y2 ? { signatures: v2 } : {}
        },
        outputData: g,
        keysetId: d.id,
        quotes: t.map((e20) => e20.quote)
      };
    }
    async completeBatchMint(e19) {
      let { method: t, payload: n, outputData: r, keysetId: i } = e19, { signatures: a } = await this.mint.mintBatch(t, n);
      this.failIf(a.length !== r.length, `Mint returned ${a.length} signatures, expected ${r.length}. The mint quote may already be marked issued; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.validateReturnedSignatures(a, r);
      let o = this.getKeyset(i);
      return this._logger.debug("BATCH MINT COMPLETED", {
        quotes: n.quotes.length,
        amounts: r.map((e20) => e20.blindedMessage.amount.toString())
      }), r.map((e20, t2) => e20.toProof(a[t2], o));
    }
    async createMeltQuote(e19, t, n) {
      let r = {
        ...t,
        unit: this._unit
      }, i = await this.mint.createMeltQuote(e19, r, { normalize: n?.normalize });
      return {
        ...i,
        unit: i.unit || this._unit
      };
    }
    async createMeltQuoteBolt11(e19, t) {
      this.requireSupport("melt", "bolt11");
      let n = t === void 0 ? void 0 : this.parseAmount(t, "createMeltQuoteBolt11");
      t !== void 0 && this.failIf(ni(e19), "amountMsat supplied but invoice already contains an amount. Leave amountMsat undefined for non-zero invoices.");
      let r = this._mintInfo?.supportsAmountless?.("bolt11", this._unit) ?? false, i = {
        unit: this._unit,
        request: e19,
        ...r && n !== void 0 ? { options: { amountless: { amount_msat: n } } } : {}
      }, a = await this.mint.createMeltQuoteBolt11(i);
      return {
        ...a,
        unit: a.unit || this._unit,
        request: a.request || e19
      };
    }
    async createMeltQuoteBolt12(e19, t) {
      this.requireSupport("melt", "bolt12");
      let n = t === void 0 ? void 0 : this.parseAmount(t, "createMeltQuoteBolt12");
      return this.mint.createMeltQuoteBolt12({
        unit: this._unit,
        request: e19,
        options: n ? { amountless: { amount_msat: n } } : void 0
      });
    }
    async createMeltQuoteOnchain(e19, t) {
      this.requireSupport("melt", "onchain");
      let n = this.parseAmount(t, "createMeltQuoteOnchain"), r = await this.mint.createMeltQuoteOnchain({
        unit: this._unit,
        request: e19,
        amount: n
      });
      return {
        ...r,
        unit: r.unit || this._unit
      };
    }
    async createMultiPathMeltQuote(e19, t) {
      let n = this.parseAmount(t, "createMultiPathMeltQuote"), { supported: r, params: i } = this.getMintInfo().isSupported(15);
      this.failIf(!r, "Mint does not support NUT-15"), this.failIf(!i?.some((e20) => e20.method === "bolt11" && e20.unit === this._unit), `Mint does not support MPP for bolt11 and ${this._unit}`);
      let a = {
        unit: this._unit,
        request: e19,
        options: { mpp: { amount: n } }
      };
      return {
        ...await this.mint.createMeltQuoteBolt11(a),
        request: e19,
        unit: this._unit
      };
    }
    async checkMeltQuote(e19, t, n) {
      let r = typeof t == "string" ? t : t.quote;
      return this.mint.checkMeltQuote(e19, r, { normalize: n?.normalize });
    }
    async checkMeltQuoteBolt11(e19) {
      let t = typeof e19 == "string" ? e19 : e19.quote;
      return this.mint.checkMeltQuoteBolt11(t);
    }
    async checkMeltQuoteBolt12(e19) {
      return this.mint.checkMeltQuoteBolt12(e19);
    }
    async checkMeltQuoteOnchain(e19) {
      return this.mint.checkMeltQuoteOnchain(e19);
    }
    async meltProofs(e19, t, n, r, i) {
      let a = await this.prepareMelt(e19, t, n, r, i);
      return this.completeMelt(a, r?.privkey);
    }
    async meltProofsBolt11(e19, t, n, r) {
      this.requireSupport("melt", "bolt11");
      let i = await this.prepareMelt("bolt11", e19, t, n, r);
      return this.completeMelt(i, n?.privkey);
    }
    async meltProofsBolt12(e19, t, n, r) {
      this.requireSupport("melt", "bolt12");
      let i = await this.prepareMelt("bolt12", e19, t, n, r);
      return this.completeMelt(i, n?.privkey);
    }
    async meltProofsOnchain(e19, t, n, r) {
      this.requireSupport("melt", "onchain"), this.validateMeltQuote(e19);
      let i = e19.fee_options.find((e20) => e20.fee_index === n);
      this.failIfNullish(i, "feeIndex must match an onchain melt quote fee option", {
        feeIndex: n,
        feeOptions: e19.fee_options.map((e20) => e20.fee_index)
      });
      let a = J(t), o = this.getFeesForProofs(a), s = q(a), c = e19.amount.add(i.fee_reserve).add(o);
      this.failIf(s.lessThan(c), "Not enough proofs to cover amount + fee", {
        sendAmount: s.toString(),
        totalRequired: c.toString(),
        amount: e19.amount.toString(),
        fee_reserve: i.fee_reserve.toString(),
        inputFee: o.toString()
      });
      let l = await this.prepareMelt("onchain", e19, a, r);
      return await this.completeMelt(l, r?.privkey, { extraPayload: { fee_index: n } });
    }
    async prepareMelt(e19, t, n, r, i) {
      this.validateMeltQuote(t), i = i ?? this.defaultOutputType();
      let { keysetId: a, onCountersReserved: o, nut08Change: s = true } = r || {}, c = this.getKeyset(a), l = J(n), u = q(l), d = [];
      this.failIf(u.lessThan(t.amount), "Not enough proofs to cover amount + fee reserve", {
        sendAmount: u.toString(),
        quoteAmount: t.amount.toString()
      });
      let f = u.subtract(t.amount);
      if (i.type === "custom") d = i.data;
      else if (s && f.greaterThan(0)) {
        let e20 = Math.ceil(Math.log2(f.toNumberUnsafe())) || 1;
        e20 < 0 && (e20 = 0);
        let t2 = e20 ? Array(e20).fill(0) : [];
        this._logger.debug("Creating NUT-08 blanks for fee reserve", {
          feeReserve: f,
          denominations: t2
        });
        let n2 = {
          ...i,
          denominations: t2
        }, r2 = await this.addCountersToOutputTypes(c.id, n2);
        [n2] = r2.outputTypes, r2.used && this.safeCallback(o, r2.used, { op: "meltProofs" }), this._logger.debug("melt counter", {
          counter: r2.used,
          meltOT: Yi(n2)
        }), d = this.createOutputData(0, c, n2);
      }
      return {
        method: e19,
        inputs: l,
        outputData: d,
        keysetId: c.id,
        quote: t
      };
    }
    async completeMelt(e19, t, n) {
      let r = typeof n == "boolean" ? { preferAsync: n } : n ?? {}, i = e19.inputs, a = e19.outputData.map((e20) => e20.blindedMessage), o = e19.quote.quote;
      t && (i = this.signP2PKProofs(i, t, e19.outputData, o)), i = this._prepareInputsForMint(i);
      let s = {
        quote: o,
        inputs: i,
        outputs: a,
        ...r.preferAsync ? { prefer_async: true } : {},
        ...r.extraPayload
      }, c = await this.mint.melt(e19.method, s), l = this.createMeltChangeProofs(e19.outputData, c.change ?? []);
      return r.preferAsync ? this._logger.debug("ASYNC MELT REQUESTED", c) : this._logger.debug("MELT COMPLETED", { changeAmounts: l.map((e20) => e20.amount.toString()) }), {
        quote: {
          ...e19.quote,
          ...c
        },
        change: l,
        outputData: l.length > 0 ? [] : e19.outputData
      };
    }
    createMeltChangeProofs(e19, t) {
      return this.failIf(t.length > e19.length, `Mint returned ${t.length} signatures, but only ${e19.length} blanks were provided. Inputs may already be spent; if the wallet is seeded, try restoring (NUT-09) to recover.`), this.validateReturnedSignatures(t, e19, { checkAmounts: false }), t.map((t2, n) => {
        let r;
        try {
          r = this.getKeyset(t2.id);
        } catch (e20) {
          throw new _(`Cannot reconstruct melt change: keyset ${t2.id} is not loaded in this wallet (may be inactive after rotation). If the wallet is seeded, try restoring (NUT-09) to recover.`, { cause: e20 });
        }
        return e19[n].toProof(t2, r);
      });
    }
    async checkProofsStates(e19) {
      let t = new TextEncoder(), n = e19.map((e20) => Qe(t.encode(e20.secret)).toHex(true)), r = [];
      for (let e20 = 0; e20 < n.length; e20 += 100) {
        let t2 = n.slice(e20, e20 + 100), { states: i } = await this.mint.check({ Ys: t2 }), a = {};
        i.forEach((e21) => {
          a[e21.Y] = e21;
        });
        for (let e21 = 0; e21 < t2.length; e21++) {
          let n2 = a[t2[e21]];
          this.failIfNullish(n2, "Could not find state for proof with Y: " + t2[e21]), r.push(n2);
        }
      }
      return r;
    }
    async groupProofsByState(e19) {
      let t = await this.checkProofsStates(e19), n = {
        unspent: [],
        pending: [],
        spent: []
      };
      for (let r = 0; r < t.length; r++) {
        let i = e19[r];
        switch (t[r].state) {
          case ci.UNSPENT:
            n.unspent.push(i);
            break;
          case ci.PENDING:
            n.pending.push(i);
            break;
          case ci.SPENT:
            n.spent.push(i);
            break;
        }
      }
      return n;
    }
  };
  var da;
  var fa = class e18 {
    constructor(e19, t) {
      this.tokens = {}, this.pool = [], this.desiredPoolSize = 100, this.maxPerMint = 100, this.mintUrl = e19, this.req = t?.request ?? Oi, this.logger = t?.logger ?? S;
      let n = Math.max(1, t?.desiredPoolSize ?? this.desiredPoolSize), r = Math.max(1, t?.maxPerMint ?? this.maxPerMint);
      this.desiredPoolSize = Math.min(n, 100), this.maxPerMint = Math.min(r, 100), this.desiredPoolSize !== n && this.logger.warn("AuthManager: desiredPoolSize exceeds internal cap and was clamped", {
        configured: n,
        clampedTo: this.desiredPoolSize
      }), this.maxPerMint !== r && this.logger.warn("AuthManager: maxPerMint exceeds internal cap and was clamped", {
        configured: r,
        clampedTo: this.maxPerMint
      });
    }
    attachOIDC(e19) {
      return this.oidc = e19, this.oidc.addTokenListener((e20) => this.updateFromOIDC(e20)), this;
    }
    get poolSize() {
      return this.pool.length;
    }
    get poolTarget() {
      return this.desiredPoolSize;
    }
    get activeAuthKeysetId() {
      try {
        return this.keychain?.getCheapestKeyset().id;
      } catch {
        return;
      }
    }
    get hasCAT() {
      return !!this.tokens.accessToken;
    }
    getCAT() {
      return this.tokens.accessToken;
    }
    setCAT(e19) {
      this.tokens.accessToken = e19, e19 || (this.tokens.refreshToken = void 0, this.tokens.expiresAt = void 0);
    }
    async ensureCAT(e19) {
      return this.validForAtLeast(e19) || !this.oidc || !this.tokens.refreshToken ? this.tokens.accessToken : (this.inflightRefresh || (this.inflightRefresh = (async () => {
        try {
          let e20 = await this.oidc.refresh(this.tokens.refreshToken);
          this.updateFromOIDC(e20);
        } catch (e20) {
          this.logger.warn("AuthManager: CAT refresh failed", { err: e20 });
        } finally {
          this.inflightRefresh = void 0;
        }
      })()), await this.inflightRefresh, this.validForAtLeast(0) ? this.tokens.accessToken : void 0);
    }
    validForAtLeast(t = e18.MIN_VALID_SECS) {
      let { accessToken: n, expiresAt: r } = this.tokens;
      return n ? r ? Date.now() + t * 1e3 < r : true : false;
    }
    updateFromOIDC(e19) {
      if (!e19.access_token) return;
      let t = Date.now();
      if (this.tokens.accessToken = e19.access_token, e19.refresh_token && (this.tokens.refreshToken = e19.refresh_token), typeof e19.expires_in == "number" && e19.expires_in > 0) this.tokens.expiresAt = t + e19.expires_in * 1e3;
      else {
        let t2 = this.parseJwtExpSec(e19.access_token);
        this.tokens.expiresAt = t2 ? t2 * 1e3 : void 0;
      }
      this.logger.debug("AuthManager: OIDC tokens updated", { expiresAt: this.tokens.expiresAt });
    }
    async ensure(e19) {
      if (await this.init(), this.pool.length >= e19) return;
      let t = Math.max(this.desiredPoolSize, e19), n = this.getBatMaxMint(), r = Math.min(t - this.pool.length, n);
      r <= 0 || await this.topUp(r);
    }
    async getBlindAuthToken({ method: e19, path: t }) {
      return this.info && !this.info.requiresBlindAuthToken(e19, t) && this.logger.warn("Endpoint is not marked as protected by NUT-22; still issuing BAT", {
        method: e19,
        path: t
      }), this.withLock(async () => {
        if (await this.ensure(1), this.pool.length === 0) throw new _("AuthManager: no BATs available and minting failed");
        let n = this.pool.pop();
        return this.logger.debug("AuthManager: BAT requested", {
          method: e19,
          path: t,
          remaining: this.pool.length
        }), pa(n);
      });
    }
    importPool(e19, t = "replace") {
      t === "replace" && (this.pool = []);
      let n = new Map(this.pool.map((e20) => [e20.secret, e20]));
      for (let t2 of e19) !t2 || !t2.secret || !t2.C || !t2.id || n.has(t2.secret) || (this.pool.push(t2), n.set(t2.secret, t2));
    }
    exportPool() {
      return this.pool.map((e19) => ({
        ...e19,
        dleq: e19.dleq ? { ...e19.dleq } : void 0
      }));
    }
    parseJwtExpSec(e19) {
      if (!e19) return;
      let t = e19.split(".");
      if (t.length === 3) try {
        let e20 = D.toString(D.fromBase64(t[1])), n = JSON.parse(e20), r = typeof n.exp == "number" ? n.exp : Number(n.exp);
        if (Number.isFinite(r) && r > 0) return r;
      } catch {
        this.logger.warn("JWT access token was malformed.", { token: e19 });
      }
    }
    async withLock(e19) {
      let t = this.lockChain ?? Promise.resolve(), n, r = new Promise((e20) => {
        n = e20;
      }), i = t.then(() => r);
      this.lockChain = i;
      try {
        return await t, await e19();
      } finally {
        n(), this.lockChain === i && (this.lockChain = void 0);
      }
    }
    async init() {
      if (!this.info) {
        let e19 = await this.req({
          endpoint: K(this.mintUrl, "/v1/info"),
          method: "GET"
        });
        this.info = new X(e19, this.logger);
      }
      if (!this.keychain) {
        let [e19, t] = await Promise.all([this.req({
          endpoint: K(this.mintUrl, "/v1/auth/blind/keysets"),
          method: "GET"
        }), this.req({
          endpoint: K(this.mintUrl, "/v1/auth/blind/keys"),
          method: "GET"
        })]), n = e19.keysets.map((e20) => ri(e20)), r = t.keysets.map((e20) => ii(e20)), i = Li.mintToCacheDTO(this.mintUrl, n, r);
        this.keychain = Li.fromCache(this.mintUrl, "auth", i), this.keychain.getCheapestKeyset();
      }
    }
    getBatMaxMint() {
      if (!this.info) throw new _("AuthManager: mint info not loaded");
      let e19 = this.info.nuts[22], t = Y(e19?.bat_max_mint, "nuts.22.bat_max_mint", this.maxPerMint);
      return Math.max(1, Math.min(this.maxPerMint, t));
    }
    getActiveKeys() {
      if (!this.keychain) throw new _("AuthManager: keyset not loaded for active keyset");
      return this.keychain.getCheapestKeyset();
    }
    async topUp(e19) {
      if (!this.info) throw new _("AuthManager: mint info not loaded");
      let t = this.info.requiresClearAuthToken("POST", "/v1/auth/blind/mint"), n;
      if (t && (n = await this.ensureCAT(), !n)) throw new _("AuthManager: Clear-auth token required for /v1/auth/blind/mint but not available. Authenticate with the mint to obtain a CAT first.");
      let r = this.getActiveKeys(), i = Q.createRandomData(e19, r), a = { outputs: i.map((e20) => e20.blindedMessage) }, o = {};
      n && (o["Clear-auth"] = n);
      let s = await this.req({
        endpoint: K(this.mintUrl, "/v1/auth/blind/mint"),
        method: "POST",
        headers: o,
        requestBody: a
      });
      if (!Array.isArray(s?.signatures) || s.signatures.length !== i.length) throw new _("AuthManager: bad BAT mint response");
      let c = s.signatures.map((e20) => ({
        ...e20,
        amount: k.from(e20.amount)
      })), l = i.map((e20, t2) => e20.toProof(c[t2], r));
      for (let e20 of l) if (!Zr(e20, r)) throw new _("AuthManager: mint returned BAT with invalid DLEQ");
      this.pool.push(...l), this.logger.debug("AuthManager: performed topUp", {
        minted: l.length,
        pool: this.pool.length
      });
    }
  };
  da = fa, da.MIN_VALID_SECS = 30;
  function pa(e19) {
    let t = JSON.stringify({
      id: e19.id,
      secret: e19.secret,
      C: e19.C
    });
    return `authA${ve(D.fromString(t))}`;
  }

  // src/wallet.src.js
  var DEFAULT_MINT = "https://testnut.cashu.space";
  var num2 = (a) => a && typeof a === "object" && "value" in a ? Number(a.value) : Number(a || 0);
  var sum = (ps) => num2(q(ps || []));
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var retry = async (fn2, n = 3) => {
    let e19;
    for (let i = 0; i < n; i++) {
      try {
        return await fn2();
      } catch (err) {
        e19 = err;
        await sleep(900 * (i + 1));
      }
    }
    throw e19;
  };
  var mintUrl = DEFAULT_MINT;
  var mint = null;
  var wallet = null;
  var proofs = [];
  var owner = "";
  var loaded = false;
  var loadingP = null;
  var initP = null;
  var subs = /* @__PURE__ */ new Set();
  var emit = () => {
    const b2 = sum(proofs);
    subs.forEach((fn2) => {
      try {
        fn2(b2);
      } catch {
      }
    });
  };
  function npub() {
    try {
      return window.TrinityIdentity && window.TrinityIdentity.current && window.TrinityIdentity.current.npub || "";
    } catch {
      return "";
    }
  }
  function lsKey() {
    return "trinityone.wallet." + (owner || "anon");
  }
  function saveLocal() {
    try {
      const plain = JSON.stringify({ mint: mintUrl, proofs });
      const F2 = window.Fellowship;
      const ct2 = F2 && F2.encryptSelf ? F2.encryptSelf(plain) : null;
      localStorage.setItem(lsKey(), ct2 ? JSON.stringify({ v: 2, enc: ct2 }) : plain);
    } catch {
    }
  }
  function loadLocal() {
    try {
      const raw = localStorage.getItem(lsKey());
      if (!raw) return;
      let d = JSON.parse(raw);
      if (d && d.enc) {
        const F2 = window.Fellowship;
        const pt = F2 && F2.decryptSelf ? F2.decryptSelf(d.enc) : null;
        if (!pt) return;
        d = JSON.parse(pt);
      }
      if (d && Array.isArray(d.proofs)) {
        proofs = d.proofs;
        if (d.mint) mintUrl = d.mint;
      }
    } catch {
    }
  }
  async function backup() {
    saveLocal();
    try {
      if (window.Fellowship && window.Fellowship.publishWalletBackup) await window.Fellowship.publishWalletBackup("proofs", { mint: mintUrl, proofs });
    } catch {
    }
  }
  async function ensureMint() {
    if (loaded) return;
    if (!loadingP) loadingP = (async () => {
      mint = new Fi(mintUrl);
      wallet = new ua(mint, { unit: "sat" });
      await retry(() => wallet.loadMint());
      loaded = true;
    })().catch((e19) => {
      loadingP = null;
      throw e19;
    });
    await loadingP;
  }
  function restoreFromRelay() {
    return new Promise((resolve) => {
      if (!(window.Fellowship && window.Fellowship.subscribeWalletBackup)) return resolve();
      let done = false, close = null;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          close && close();
        } catch {
        }
        resolve();
      };
      close = window.Fellowship.subscribeWalletBackup("proofs", async (doc) => {
        if (done || !doc || !Array.isArray(doc.proofs)) return;
        if (doc.mint) mintUrl = doc.mint;
        proofs = doc.proofs;
        saveLocal();
        finish();
        try {
          await pruneSpent();
          emit();
        } catch {
        }
      });
      setTimeout(finish, 6e3);
    });
  }
  async function pruneSpent() {
    if (!proofs.length) return;
    await ensureMint();
    const states = await wallet.checkProofsStates(proofs);
    const keep = proofs.filter((_2, i) => states[i] && states[i].state === ci.UNSPENT);
    if (keep.length !== proofs.length) {
      proofs = keep;
      saveLocal();
    }
  }
  window.TrinityWallet = {
    get mintUrl() {
      return mintUrl;
    },
    balance() {
      return sum(proofs);
    },
    onChange(fn2) {
      subs.add(fn2);
      try {
        fn2(sum(proofs));
      } catch {
      }
      return () => subs.delete(fn2);
    },
    // boot: paint local balance instantly, restore from relay if this device is empty, warm the mint.
    // Idempotent — many surfaces (Giving tab, wallet hub, profile) may call it; they share one init.
    init() {
      if (initP) return initP;
      initP = (async () => {
        owner = npub();
        try {
          if (window.Fellowship && window.Fellowship.ready) await window.Fellowship.ready;
        } catch {
        }
        loadLocal();
        if (!proofs.length) await restoreFromRelay();
        emit();
        ensureMint().catch(() => {
        });
        return this.balance();
      })();
      return initP;
    },
    // re-check on-chain that our proofs are still unspent (e.g. after restoring on a new device)
    async refresh() {
      try {
        await pruneSpent();
        emit();
      } catch {
      }
      return this.balance();
    },
    // ── Top up: occasional load from the member's EXTERNAL wallet (Strike etc.) into the in-app balance ──
    async requestTopUp(sats) {
      await ensureMint();
      const q2 = await retry(() => wallet.createMintQuoteBolt11(sats));
      return { quote: q2.quote, invoice: q2.request, _q: q2, sats };
    },
    // poll until the top-up invoice is paid, then mint the ecash into the balance
    async awaitTopUp(req, { onState, timeoutMs = 6e5 } = {}) {
      await ensureMint();
      const t0 = Date.now();
      while (Date.now() - t0 < timeoutMs) {
        let s = null;
        try {
          s = await mint.checkMintQuoteBolt11(req.quote);
        } catch {
        }
        if (s && onState) onState(s.state);
        if (s && s.state === "PAID") {
          const fresh = await retry(() => wallet.mintProofs("bolt11", req.sats, req._q || { quote: req.quote }));
          proofs = [...proofs, ...fresh];
          await backup();
          emit();
          return this.balance();
        }
        if (s && s.state === "ISSUED") return this.balance();
        await sleep(2500);
      }
      throw new Error("Top-up timed out \u2014 if you paid, it\u2019ll appear shortly.");
    },
    // ── Give: pay a Lightning invoice (the church's) from the in-app balance ──
    // What it'll cost from the balance, incl. mint fee, before committing.
    async quoteInvoice(bolt11) {
      await ensureMint();
      const mq = await retry(() => wallet.createMeltQuoteBolt11(bolt11));
      return { _mq: mq, amount: num2(mq.amount), fee: num2(mq.fee_reserve), total: num2(mq.amount) + num2(mq.fee_reserve) };
    },
    async payInvoice(bolt11, pre) {
      await ensureMint();
      const q2 = pre && pre._mq ? pre : await this.quoteInvoice(bolt11);
      const need = q2.total;
      if (sum(proofs) < need) throw new Error("Not enough balance \u2014 top up first.");
      const { keep, send } = await retry(() => wallet.send(need, proofs, { includeFees: true }));
      const res = await retry(() => wallet.meltProofs("bolt11", q2._mq, send));
      proofs = [...keep, ...res.change || []];
      await backup();
      emit();
      return { paid: res.quote ? res.quote.state === "PAID" : true, fee: q2.fee, balance: this.balance() };
    },
    // ── Withdraw / cash out: send the balance back out to the member's OWN wallet. ──
    // destination = a Lightning address (name@domain — we resolve + request an invoice for `sats`)
    // or a bolt11 invoice (amount is embedded, `sats` ignored). Always available, church-independent.
    async withdraw(destination, sats) {
      const dest = String(destination || "").trim().replace(/^lightning:/i, "");
      let bolt11;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest)) {
        if (!(window.TrinityLN && window.TrinityLN.invoiceFor)) throw new Error("Lightning-address support unavailable");
        const r = await window.TrinityLN.invoiceFor(dest, sats);
        bolt11 = r.bolt11;
      } else if (/^ln(bc|tb|bcrt)/i.test(dest)) {
        bolt11 = dest;
      } else {
        throw new Error("Enter a Lightning address or invoice");
      }
      return this.payInvoice(bolt11);
    }
  };
})();
