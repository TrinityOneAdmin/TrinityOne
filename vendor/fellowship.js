(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/@noble/hashes/utils.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber(n, title = "") {
    if (!Number.isSafeInteger(n) || n < 0) {
      const prefix = title && `"${title}" `;
      throw new Error(`${prefix}expected integer >= 0, got ${n}`);
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
      throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
    }
    return value;
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function")
      throw new Error("Hash must wrapped by utils.createHasher");
    anumber(h.outputLen);
    anumber(h.blockLen);
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
      throw new Error('"digestInto() output" expected to be of length >=' + min);
    }
  }
  function clean(...arrays) {
    for (let i3 = 0; i3 < arrays.length; i3++) {
      arrays[i3].fill(0);
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
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i3) => i3.toString(16).padStart(2, "0"));
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex = "";
    for (let i3 = 0; i3 < bytes.length; i3++) {
      hex += hexes[bytes[i3]];
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
      throw new Error("hex string expected, got " + typeof hex);
    if (hasHexBuiltin)
      return Uint8Array.fromHex(hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
      throw new Error("hex string expected, got unpadded hex of length " + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
      const n1 = asciiToBase16(hex.charCodeAt(hi));
      const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
      if (n1 === void 0 || n2 === void 0) {
        const char = hex[hi] + hex[hi + 1];
        throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
      }
      array[ai] = n1 * 16 + n2;
    }
    return array;
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new Error("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function kdfInputToBytes(data, errorTitle = "") {
    if (typeof data === "string")
      return utf8ToBytes(data);
    return abytes(data, void 0, errorTitle);
  }
  function concatBytes(...arrays) {
    let sum = 0;
    for (let i3 = 0; i3 < arrays.length; i3++) {
      const a = arrays[i3];
      abytes(a);
      sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i3 = 0, pad2 = 0; i3 < arrays.length; i3++) {
      const a = arrays[i3];
      res.set(a, pad2);
      pad2 += a.length;
    }
    return res;
  }
  function checkOpts(defaults, opts) {
    if (opts !== void 0 && {}.toString.call(opts) !== "[object Object]")
      throw new Error("options must be object or undefined");
    const merged = Object.assign(defaults, opts);
    return merged;
  }
  function createHasher(hashCons, info = {}) {
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  function randomBytes(bytesLength = 32) {
    const cr = typeof globalThis === "object" ? globalThis.crypto : null;
    if (typeof cr?.getRandomValues !== "function")
      throw new Error("crypto.getRandomValues must be defined");
    return cr.getRandomValues(new Uint8Array(bytesLength));
  }
  var oidNist = (suffix) => ({
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
  });

  // node_modules/@noble/hashes/_md.js
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }
  var HashMD = class {
    constructor(blockLen, outputLen, padOffset, isLE2) {
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
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
      this.isLE = isLE2;
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
      const { buffer, view, blockLen, isLE: isLE2 } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      clean(this.buffer.subarray(pos));
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i3 = pos; i3 < blockLen; i3++)
        buffer[i3] = 0;
      view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE2);
      this.process(view, 0);
      const oview = createView(out);
      const len = this.outputLen;
      if (len % 4)
        throw new Error("_sha2: outputLen must be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i3 = 0; i3 < outLen; i3++)
        oview.setUint32(4 * i3, state[i3], isLE2);
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

  // node_modules/@noble/hashes/_u64.js
  var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
  var _32n = /* @__PURE__ */ BigInt(32);
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i3 = 0; i3 < len; i3++) {
      const { h, l } = fromBig(lst[i3], le);
      [Ah[i3], Al[i3]] = [h, l];
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

  // node_modules/@noble/hashes/sha2.js
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
      const { A, B, C, D, E, F, G, H } = this;
      return [A, B, C, D, E, F, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F, G, H) {
      this.A = A | 0;
      this.B = B | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    process(view, offset) {
      for (let i3 = 0; i3 < 16; i3++, offset += 4)
        SHA256_W[i3] = view.getUint32(offset, false);
      for (let i3 = 16; i3 < 64; i3++) {
        const W15 = SHA256_W[i3 - 15];
        const W2 = SHA256_W[i3 - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i3] = s1 + SHA256_W[i3 - 7] + s0 + SHA256_W[i3 - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i3 = 0; i3 < 64; i3++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i3] + SHA256_W[i3] | 0;
        const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
        const T2 = sigma0 + Maj(A, B, C) | 0;
        H = G;
        G = F;
        F = E;
        E = D + T1 | 0;
        D = C;
        C = B;
        B = A;
        A = T1 + T2 | 0;
      }
      A = A + this.A | 0;
      B = B + this.B | 0;
      C = C + this.C | 0;
      D = D + this.D | 0;
      E = E + this.E | 0;
      F = F + this.F | 0;
      G = G + this.G | 0;
      H = H + this.H | 0;
      this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
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
      for (let i3 = 0; i3 < 16; i3++, offset += 4) {
        SHA512_W_H[i3] = view.getUint32(offset);
        SHA512_W_L[i3] = view.getUint32(offset += 4);
      }
      for (let i3 = 16; i3 < 80; i3++) {
        const W15h = SHA512_W_H[i3 - 15] | 0;
        const W15l = SHA512_W_L[i3 - 15] | 0;
        const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
        const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
        const W2h = SHA512_W_H[i3 - 2] | 0;
        const W2l = SHA512_W_L[i3 - 2] | 0;
        const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
        const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
        const SUMl = add4L(s0l, s1l, SHA512_W_L[i3 - 7], SHA512_W_L[i3 - 16]);
        const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i3 - 7], SHA512_W_H[i3 - 16]);
        SHA512_W_H[i3] = SUMh | 0;
        SHA512_W_L[i3] = SUMl | 0;
      }
      let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      for (let i3 = 0; i3 < 80; i3++) {
        const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
        const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
        const CHIh = Eh & Fh ^ ~Eh & Gh;
        const CHIl = El & Fl ^ ~El & Gl;
        const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i3], SHA512_W_L[i3]);
        const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i3], SHA512_W_H[i3]);
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

  // node_modules/@noble/curves/utils.js
  var _0n = /* @__PURE__ */ BigInt(0);
  var _1n = /* @__PURE__ */ BigInt(1);
  function abool(value, title = "") {
    if (typeof value !== "boolean") {
      const prefix = title && `"${title}" `;
      throw new Error(prefix + "expected boolean, got type=" + typeof value);
    }
    return value;
  }
  function abignumber(n) {
    if (typeof n === "bigint") {
      if (!isPosBig(n))
        throw new Error("positive bigint expected, got " + n);
    } else
      anumber(n);
    return n;
  }
  function numberToHexUnpadded(num2) {
    const hex = abignumber(num2).toString(16);
    return hex.length & 1 ? "0" + hex : hex;
  }
  function hexToNumber(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
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
    n = abignumber(n);
    const res = hexToBytes(n.toString(16).padStart(len * 2, "0"));
    if (res.length !== len)
      throw new Error("number too large");
    return res;
  }
  function numberToBytesLE(n, len) {
    return numberToBytesBE(n, len).reverse();
  }
  function copyBytes(bytes) {
    return Uint8Array.from(bytes);
  }
  function asciiToBytes(ascii) {
    return Uint8Array.from(ascii, (c, i3) => {
      const charCode = c.charCodeAt(0);
      if (c.length !== 1 || charCode > 127) {
        throw new Error(`string contains non-ASCII character "${ascii[i3]}" with code ${charCode} at position ${i3}`);
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
      throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
  }
  function bitLen(n) {
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
      throw new Error("hmacFn must be a function");
    const u8n = (len) => new Uint8Array(len);
    const NULL = Uint8Array.of();
    const byte0 = Uint8Array.of(0);
    const byte1 = Uint8Array.of(1);
    const _maxDrbgIters = 1e3;
    let v = u8n(hashLen);
    let k = u8n(hashLen);
    let i3 = 0;
    const reset = () => {
      v.fill(1);
      k.fill(0);
      i3 = 0;
    };
    const h = (...msgs) => hmacFn(k, concatBytes(v, ...msgs));
    const reseed = (seed = NULL) => {
      k = h(byte0, seed);
      v = h();
      if (seed.length === 0)
        return;
      k = h(byte1, seed);
      v = h();
    };
    const gen = () => {
      if (i3++ >= _maxDrbgIters)
        throw new Error("drbg: tried max amount of iterations");
      let len = 0;
      const out = [];
      while (len < qByteLen) {
        v = h();
        const sl = v.slice();
        out.push(sl);
        len += v.length;
      }
      return concatBytes(...out);
    };
    const genUntil = (seed, pred) => {
      reset();
      reseed(seed);
      let res = void 0;
      while (!(res = pred(gen())))
        reseed();
      reset();
      return res;
    };
    return genUntil;
  }
  function validateObject(object, fields = {}, optFields = {}) {
    if (!object || typeof object !== "object")
      throw new Error("expected valid options object");
    function checkField(fieldName, expectedType, isOpt) {
      const val = object[fieldName];
      if (isOpt && val === void 0)
        return;
      const current = typeof val;
      if (current !== expectedType || val === null)
        throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
    }
    const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
    iter(fields, false);
    iter(optFields, true);
  }
  function memoized(fn) {
    const map = /* @__PURE__ */ new WeakMap();
    return (arg, ...args) => {
      const val = map.get(arg);
      if (val !== void 0)
        return val;
      const computed = fn(arg, ...args);
      map.set(arg, computed);
      return computed;
    };
  }

  // node_modules/@noble/curves/abstract/modular.js
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
  function mod(a, b) {
    const result = a % b;
    return result >= _0n2 ? result : b + result;
  }
  function pow2(x, power, modulo) {
    let res = x;
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
    let b = modulo;
    let x = _0n2, y = _1n2, u = _1n2, v = _0n2;
    while (a !== _0n2) {
      const q = b / a;
      const r = b % a;
      const m = x - u * q;
      const n = y - v * q;
      b = a, a = r, x = u, y = v, u = m, v = n;
    }
    const gcd2 = b;
    if (gcd2 !== _1n2)
      throw new Error("invert: does not exist");
    return mod(x, modulo);
  }
  function assertIsSquare(Fp, root, n) {
    if (!Fp.eql(Fp.sqr(root), n))
      throw new Error("Cannot find square root");
  }
  function sqrt3mod4(Fp, n) {
    const p1div4 = (Fp.ORDER + _1n2) / _4n;
    const root = Fp.pow(n, p1div4);
    assertIsSquare(Fp, root, n);
    return root;
  }
  function sqrt5mod8(Fp, n) {
    const p5div8 = (Fp.ORDER - _5n) / _8n;
    const n2 = Fp.mul(n, _2n);
    const v = Fp.pow(n2, p5div8);
    const nv = Fp.mul(n, v);
    const i3 = Fp.mul(Fp.mul(nv, _2n), v);
    const root = Fp.mul(nv, Fp.sub(i3, Fp.ONE));
    assertIsSquare(Fp, root, n);
    return root;
  }
  function sqrt9mod16(P) {
    const Fp_ = Field(P);
    const tn = tonelliShanks(P);
    const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
    const c2 = tn(Fp_, c1);
    const c3 = tn(Fp_, Fp_.neg(c1));
    const c4 = (P + _7n) / _16n;
    return (Fp, n) => {
      let tv1 = Fp.pow(n, c4);
      let tv2 = Fp.mul(tv1, c1);
      const tv3 = Fp.mul(tv1, c2);
      const tv4 = Fp.mul(tv1, c3);
      const e1 = Fp.eql(Fp.sqr(tv2), n);
      const e2 = Fp.eql(Fp.sqr(tv3), n);
      tv1 = Fp.cmov(tv1, tv2, e1);
      tv2 = Fp.cmov(tv4, tv3, e2);
      const e3 = Fp.eql(Fp.sqr(tv2), n);
      const root = Fp.cmov(tv1, tv2, e3);
      assertIsSquare(Fp, root, n);
      return root;
    };
  }
  function tonelliShanks(P) {
    if (P < _3n)
      throw new Error("sqrt is not defined for small field");
    let Q = P - _1n2;
    let S = 0;
    while (Q % _2n === _0n2) {
      Q /= _2n;
      S++;
    }
    let Z = _2n;
    const _Fp = Field(P);
    while (FpLegendre(_Fp, Z) === 1) {
      if (Z++ > 1e3)
        throw new Error("Cannot find square root: probably non-prime P");
    }
    if (S === 1)
      return sqrt3mod4;
    let cc = _Fp.pow(Z, Q);
    const Q1div2 = (Q + _1n2) / _2n;
    return function tonelliSlow(Fp, n) {
      if (Fp.is0(n))
        return n;
      if (FpLegendre(Fp, n) !== 1)
        throw new Error("Cannot find square root");
      let M = S;
      let c = Fp.mul(Fp.ONE, cc);
      let t = Fp.pow(n, Q);
      let R = Fp.pow(n, Q1div2);
      while (!Fp.eql(t, Fp.ONE)) {
        if (Fp.is0(t))
          return Fp.ZERO;
        let i3 = 1;
        let t_tmp = Fp.sqr(t);
        while (!Fp.eql(t_tmp, Fp.ONE)) {
          i3++;
          t_tmp = Fp.sqr(t_tmp);
          if (i3 === M)
            throw new Error("Cannot find square root");
        }
        const exponent = _1n2 << BigInt(M - i3 - 1);
        const b = Fp.pow(c, exponent);
        M = i3;
        c = Fp.sqr(b);
        t = Fp.mul(t, c);
        R = Fp.mul(R, b);
      }
      return R;
    };
  }
  function FpSqrt(P) {
    if (P % _4n === _3n)
      return sqrt3mod4;
    if (P % _8n === _5n)
      return sqrt5mod8;
    if (P % _16n === _9n)
      return sqrt9mod16(P);
    return tonelliShanks(P);
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
    return field;
  }
  function FpPow(Fp, num2, power) {
    if (power < _0n2)
      throw new Error("invalid exponent, negatives unsupported");
    if (power === _0n2)
      return Fp.ONE;
    if (power === _1n2)
      return num2;
    let p = Fp.ONE;
    let d = num2;
    while (power > _0n2) {
      if (power & _1n2)
        p = Fp.mul(p, d);
      d = Fp.sqr(d);
      power >>= _1n2;
    }
    return p;
  }
  function FpInvertBatch(Fp, nums, passZero = false) {
    const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : void 0);
    const multipliedAcc = nums.reduce((acc, num2, i3) => {
      if (Fp.is0(num2))
        return acc;
      inverted[i3] = acc;
      return Fp.mul(acc, num2);
    }, Fp.ONE);
    const invertedAcc = Fp.inv(multipliedAcc);
    nums.reduceRight((acc, num2, i3) => {
      if (Fp.is0(num2))
        return acc;
      inverted[i3] = Fp.mul(acc, inverted[i3]);
      return Fp.mul(acc, num2);
    }, invertedAcc);
    return inverted;
  }
  function FpLegendre(Fp, n) {
    const p1mod2 = (Fp.ORDER - _1n2) / _2n;
    const powered = Fp.pow(n, p1mod2);
    const yes = Fp.eql(powered, Fp.ONE);
    const zero = Fp.eql(powered, Fp.ZERO);
    const no = Fp.eql(powered, Fp.neg(Fp.ONE));
    if (!yes && !zero && !no)
      throw new Error("invalid Legendre symbol result");
    return yes ? 1 : zero ? 0 : -1;
  }
  function nLength(n, nBitLength) {
    if (nBitLength !== void 0)
      anumber(nBitLength);
    const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
  }
  var _Field = class {
    constructor(ORDER, opts = {}) {
      __publicField(this, "ORDER");
      __publicField(this, "BITS");
      __publicField(this, "BYTES");
      __publicField(this, "isLE");
      __publicField(this, "ZERO", _0n2);
      __publicField(this, "ONE", _1n2);
      __publicField(this, "_lengths");
      __publicField(this, "_sqrt");
      // cached sqrt
      __publicField(this, "_mod");
      if (ORDER <= _0n2)
        throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
      let _nbitLength = void 0;
      this.isLE = false;
      if (opts != null && typeof opts === "object") {
        if (typeof opts.BITS === "number")
          _nbitLength = opts.BITS;
        if (typeof opts.sqrt === "function")
          this.sqrt = opts.sqrt;
        if (typeof opts.isLE === "boolean")
          this.isLE = opts.isLE;
        if (opts.allowedLengths)
          this._lengths = opts.allowedLengths?.slice();
        if (typeof opts.modFromBytes === "boolean")
          this._mod = opts.modFromBytes;
      }
      const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
      if (nByteLength > 2048)
        throw new Error("invalid field: expected ORDER of <= 2048 bytes");
      this.ORDER = ORDER;
      this.BITS = nBitLength;
      this.BYTES = nByteLength;
      this._sqrt = void 0;
      Object.preventExtensions(this);
    }
    create(num2) {
      return mod(num2, this.ORDER);
    }
    isValid(num2) {
      if (typeof num2 !== "bigint")
        throw new Error("invalid field element: expected bigint, got " + typeof num2);
      return _0n2 <= num2 && num2 < this.ORDER;
    }
    is0(num2) {
      return num2 === _0n2;
    }
    // is valid and invertible
    isValidNot0(num2) {
      return !this.is0(num2) && this.isValid(num2);
    }
    isOdd(num2) {
      return (num2 & _1n2) === _1n2;
    }
    neg(num2) {
      return mod(-num2, this.ORDER);
    }
    eql(lhs, rhs) {
      return lhs === rhs;
    }
    sqr(num2) {
      return mod(num2 * num2, this.ORDER);
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
    pow(num2, power) {
      return FpPow(this, num2, power);
    }
    div(lhs, rhs) {
      return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
    }
    // Same as above, but doesn't normalize
    sqrN(num2) {
      return num2 * num2;
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
    inv(num2) {
      return invert(num2, this.ORDER);
    }
    sqrt(num2) {
      if (!this._sqrt)
        this._sqrt = FpSqrt(this.ORDER);
      return this._sqrt(this, num2);
    }
    toBytes(num2) {
      return this.isLE ? numberToBytesLE(num2, this.BYTES) : numberToBytesBE(num2, this.BYTES);
    }
    fromBytes(bytes, skipValidation = false) {
      abytes(bytes);
      const { _lengths: allowedLengths, BYTES, isLE: isLE2, ORDER, _mod: modFromBytes } = this;
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
          throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
        }
        const padded = new Uint8Array(BYTES);
        padded.set(bytes, isLE2 ? 0 : padded.length - bytes.length);
        bytes = padded;
      }
      if (bytes.length !== BYTES)
        throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
      let scalar = isLE2 ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
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
    cmov(a, b, condition) {
      return condition ? b : a;
    }
  };
  function Field(ORDER, opts = {}) {
    return new _Field(ORDER, opts);
  }
  function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== "bigint")
      throw new Error("field order must be bigint");
    const bitLength = fieldOrder.toString(2).length;
    return Math.ceil(bitLength / 8);
  }
  function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
  }
  function mapHashToField(key, fieldOrder, isLE2 = false) {
    abytes(key);
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = getMinHashLength(fieldOrder);
    if (len < 16 || len < minLen || len > 1024)
      throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
    const num2 = isLE2 ? bytesToNumberLE(key) : bytesToNumberBE(key);
    const reduced = mod(num2, fieldOrder - _1n2) + _1n2;
    return isLE2 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
  }

  // node_modules/@noble/curves/abstract/curve.js
  var _0n3 = /* @__PURE__ */ BigInt(0);
  var _1n3 = /* @__PURE__ */ BigInt(1);
  function negateCt(condition, item) {
    const neg = item.negate();
    return condition ? neg : item;
  }
  function normalizeZ(c, points) {
    const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
    return points.map((p, i3) => c.fromAffine(p.toAffine(invertedZs[i3])));
  }
  function validateW(W, bits) {
    if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
      throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
  }
  function calcWOpts(W, scalarBits) {
    validateW(W, scalarBits);
    const windows = Math.ceil(scalarBits / W) + 1;
    const windowSize = 2 ** (W - 1);
    const maxNumber = 2 ** W;
    const mask = bitMask(W);
    const shiftBy = BigInt(W);
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
  function getW(P) {
    return pointWindowSizes.get(P) || 1;
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
     * @param point Point instance
     * @param W window size
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(point, W) {
      const { windows, windowSize } = calcWOpts(W, this.bits);
      const points = [];
      let p = point;
      let base = p;
      for (let window2 = 0; window2 < windows; window2++) {
        base = p;
        points.push(base);
        for (let i3 = 1; i3 < windowSize; i3++) {
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
    wNAF(W, precomputes, n) {
      if (!this.Fn.isValid(n))
        throw new Error("invalid scalar");
      let p = this.ZERO;
      let f = this.BASE;
      const wo = calcWOpts(W, this.bits);
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
     * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
     * @param acc accumulator point to add result of multiplication
     * @returns point
     */
    wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
      const wo = calcWOpts(W, this.bits);
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
    getPrecomputes(W, point, transform) {
      let comp = pointPrecomputes.get(point);
      if (!comp) {
        comp = this.precomputeWindow(point, W);
        if (W !== 1) {
          if (typeof transform === "function")
            comp = transform(comp);
          pointPrecomputes.set(point, comp);
        }
      }
      return comp;
    }
    cached(point, scalar, transform) {
      const W = getW(point);
      return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
    }
    unsafe(point, scalar, transform, prev) {
      const W = getW(point);
      if (W === 1)
        return this._unsafeLadder(point, scalar, prev);
      return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
    }
    // We calculate precomputes for elliptic curve point multiplication
    // using windowed method. This specifies window size and
    // stores precomputed values. Usually only base point would be precomputed.
    createCache(P, W) {
      validateW(W, this.bits);
      pointWindowSizes.set(P, W);
      pointPrecomputes.delete(P);
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
  function createField(order, field, isLE2) {
    if (field) {
      if (field.ORDER !== order)
        throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
      validateField(field);
      return field;
    } else {
      return Field(order, { isLE: isLE2 });
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
  function createKeygen(randomSecretKey, getPublicKey3) {
    return function keygen(seed) {
      const secretKey = randomSecretKey(seed);
      return { secretKey, publicKey: getPublicKey3(secretKey) };
    };
  }

  // node_modules/@noble/hashes/hmac.js
  var _HMAC = class {
    constructor(hash, key) {
      __publicField(this, "oHash");
      __publicField(this, "iHash");
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
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
      const pad2 = new Uint8Array(blockLen);
      pad2.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i3 = 0; i3 < pad2.length; i3++)
        pad2[i3] ^= 54;
      this.iHash.update(pad2);
      this.oHash = hash.create();
      for (let i3 = 0; i3 < pad2.length; i3++)
        pad2[i3] ^= 54 ^ 92;
      this.oHash.update(pad2);
      clean(pad2);
    }
    update(buf) {
      aexists(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      aexists(this);
      abytes(out, this.outputLen, "output");
      this.finished = true;
      this.iHash.digestInto(out);
      this.oHash.update(out);
      this.oHash.digestInto(out);
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
  var hmac = (hash, key, message) => new _HMAC(hash, key).update(message).digest();
  hmac.create = (hash, key) => new _HMAC(hash, key);

  // node_modules/@noble/curves/abstract/weierstrass.js
  var divNearest = (num2, den) => (num2 + (num2 >= 0 ? den : -den) / _2n2) / den;
  function _splitEndoScalar(k, basis, n) {
    const [[a1, b1], [a2, b2]] = basis;
    const c1 = divNearest(b2 * k, n);
    const c2 = divNearest(-b1 * k, n);
    let k1 = k - c1 * a1 - c2 * a2;
    let k2 = -c1 * b1 - c2 * b2;
    const k1neg = k1 < _0n4;
    const k2neg = k2 < _0n4;
    if (k1neg)
      k1 = -k1;
    if (k2neg)
      k2 = -k2;
    const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n4;
    if (k1 < _0n4 || k1 >= MAX_NUM || k2 < _0n4 || k2 >= MAX_NUM) {
      throw new Error("splitScalar (endomorphism): failed, k=" + k);
    }
    return { k1neg, k1, k2neg, k2 };
  }
  function validateSigFormat(format) {
    if (!["compact", "recovered", "der"].includes(format))
      throw new Error('Signature format must be "compact", "recovered", or "der"');
    return format;
  }
  function validateSigOpts(opts, def) {
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
        if (tag < 0 || tag > 256)
          throw new E("tlv.encode: wrong tag");
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
        let pos = 0;
        if (tag < 0 || tag > 256)
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
          for (const b of lengthBytes)
            length = length << 8 | b;
          pos += lenLen;
          if (length < 128)
            throw new E("tlv.decode(long): not minimal encoding");
        }
        const v = data.subarray(pos, pos + length);
        if (v.length !== length)
          throw new E("tlv.decode: wrong value length");
        return { v, l: data.subarray(pos + length) };
      }
    },
    // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
    // since we always use positive integers here. It must always be empty:
    // - add zero byte if exists
    // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
    _int: {
      encode(num2) {
        const { Err: E } = DER;
        if (num2 < _0n4)
          throw new E("integer: negative integers are not allowed");
        let hex = numberToHexUnpadded(num2);
        if (Number.parseInt(hex[0], 16) & 8)
          hex = "00" + hex;
        if (hex.length & 1)
          throw new E("unexpected DER parsing assertion: unpadded hex");
        return hex;
      },
      decode(data) {
        const { Err: E } = DER;
        if (data[0] & 128)
          throw new E("invalid signature integer: negative");
        if (data[0] === 0 && !(data[1] & 128))
          throw new E("invalid signature integer: unnecessary leading zero");
        return bytesToNumberBE(data);
      }
    },
    toSig(bytes) {
      const { Err: E, _int: int, _tlv: tlv } = DER;
      const data = abytes(bytes, void 0, "signature");
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
  var _0n4 = BigInt(0);
  var _1n4 = BigInt(1);
  var _2n2 = BigInt(2);
  var _3n2 = BigInt(3);
  var _4n2 = BigInt(4);
  function weierstrass(params, extraOpts = {}) {
    const validated = createCurveFields("weierstrass", params, extraOpts);
    const { Fp, Fn: Fn2 } = validated;
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
    const { endo } = extraOpts;
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
      const { x, y } = point.toAffine();
      const bx = Fp.toBytes(x);
      abool(isCompressed, "isCompressed");
      if (isCompressed) {
        assertCompressionIsSupported();
        const hasEvenY = !Fp.isOdd(y);
        return concatBytes(pprefix(hasEvenY), bx);
      } else {
        return concatBytes(Uint8Array.of(4), bx, Fp.toBytes(y));
      }
    }
    function pointFromBytes(bytes) {
      abytes(bytes, void 0, "Point");
      const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
      const length = bytes.length;
      const head = bytes[0];
      const tail = bytes.subarray(1);
      if (length === comp && (head === 2 || head === 3)) {
        const x = Fp.fromBytes(tail);
        if (!Fp.isValid(x))
          throw new Error("bad point: is not on curve, wrong x");
        const y2 = weierstrassEquation(x);
        let y;
        try {
          y = Fp.sqrt(y2);
        } catch (sqrtError) {
          const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
          throw new Error("bad point: is not on curve, sqrt error" + err);
        }
        assertCompressionIsSupported();
        const evenY = Fp.isOdd(y);
        const evenH = (head & 1) === 1;
        if (evenH !== evenY)
          y = Fp.neg(y);
        return { x, y };
      } else if (length === uncomp && head === 4) {
        const L = Fp.BYTES;
        const x = Fp.fromBytes(tail.subarray(0, L));
        const y = Fp.fromBytes(tail.subarray(L, L * 2));
        if (!isValidXY(x, y))
          throw new Error("bad point: is not on curve");
        return { x, y };
      } else {
        throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
      }
    }
    const encodePoint = extraOpts.toBytes || pointToBytes2;
    const decodePoint = extraOpts.fromBytes || pointFromBytes;
    function weierstrassEquation(x) {
      const x2 = Fp.sqr(x);
      const x3 = Fp.mul(x2, x);
      return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
    }
    function isValidXY(x, y) {
      const left = Fp.sqr(y);
      const right = weierstrassEquation(x);
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
    function splitEndoScalarN(k) {
      if (!endo || !endo.basises)
        throw new Error("no endo");
      return _splitEndoScalar(k, endo.basises, Fn2.ORDER);
    }
    const toAffineMemo = memoized((p, iz) => {
      const { X, Y, Z } = p;
      if (Fp.eql(Z, Fp.ONE))
        return { x: X, y: Y };
      const is0 = p.is0();
      if (iz == null)
        iz = is0 ? Fp.ONE : Fp.inv(Z);
      const x = Fp.mul(X, iz);
      const y = Fp.mul(Y, iz);
      const zz = Fp.mul(Z, iz);
      if (is0)
        return { x: Fp.ZERO, y: Fp.ZERO };
      if (!Fp.eql(zz, Fp.ONE))
        throw new Error("invZ was invalid");
      return { x, y };
    });
    const assertValidMemo = memoized((p) => {
      if (p.is0()) {
        if (extraOpts.allowInfinityPoint && !Fp.is0(p.Y))
          return;
        throw new Error("bad point: ZERO");
      }
      const { x, y } = p.toAffine();
      if (!Fp.isValid(x) || !Fp.isValid(y))
        throw new Error("bad point: x or y not field elements");
      if (!isValidXY(x, y))
        throw new Error("bad point: equation left != right");
      if (!p.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
      return true;
    });
    function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
      k2p = new Point2(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
      k1p = negateCt(k1neg, k1p);
      k2p = negateCt(k2neg, k2p);
      return k1p.add(k2p);
    }
    const _Point = class _Point {
      /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
      constructor(X, Y, Z) {
        __publicField(this, "X");
        __publicField(this, "Y");
        __publicField(this, "Z");
        this.X = acoord("x", X);
        this.Y = acoord("y", Y, true);
        this.Z = acoord("z", Z);
        Object.freeze(this);
      }
      static CURVE() {
        return CURVE;
      }
      /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
      static fromAffine(p) {
        const { x, y } = p || {};
        if (!p || !Fp.isValid(x) || !Fp.isValid(y))
          throw new Error("invalid affine point");
        if (p instanceof _Point)
          throw new Error("projective point not allowed");
        if (Fp.is0(x) && Fp.is0(y))
          return _Point.ZERO;
        return new _Point(x, y, Fp.ONE);
      }
      static fromBytes(bytes) {
        const P = _Point.fromAffine(decodePoint(abytes(bytes, void 0, "point")));
        P.assertValidity();
        return P;
      }
      static fromHex(hex) {
        return _Point.fromBytes(hexToBytes(hex));
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
       * @param isLazy true will defer table computation until the first multiplication
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
        assertValidMemo(this);
      }
      hasEvenY() {
        const { y } = this.toAffine();
        if (!Fp.isOdd)
          throw new Error("Field doesn't support isOdd");
        return !Fp.isOdd(y);
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
        const { a, b } = CURVE;
        const b3 = Fp.mul(b, _3n2);
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
       * @param scalar by which the point would be multiplied
       * @returns New point
       */
      multiply(scalar) {
        const { endo: endo2 } = extraOpts;
        if (!Fn2.isValidNot0(scalar))
          throw new Error("invalid scalar: out of range");
        let point, fake;
        const mul3 = (n) => wnaf.cached(this, n, (p) => normalizeZ(_Point, p));
        if (endo2) {
          const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
          const { p: k1p, f: k1f } = mul3(k1);
          const { p: k2p, f: k2f } = mul3(k2);
          fake = k1f.add(k2f);
          point = finishEndo(endo2.beta, k1p, k2p, k1neg, k2neg);
        } else {
          const { p, f } = mul3(scalar);
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
      multiplyUnsafe(sc) {
        const { endo: endo2 } = extraOpts;
        const p = this;
        if (!Fn2.isValid(sc))
          throw new Error("invalid scalar: out of range");
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
       * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
       */
      toAffine(invertedZ) {
        return toAffineMemo(this, invertedZ);
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
        return this.multiplyUnsafe(cofactor).is0();
      }
      toBytes(isCompressed = true) {
        abool(isCompressed, "isCompressed");
        this.assertValidity();
        return encodePoint(_Point, this, isCompressed);
      }
      toHex(isCompressed = true) {
        return bytesToHex(this.toBytes(isCompressed));
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
    Point2.BASE.precompute(8);
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
      signature: 2 * Fn2.BYTES
    };
  }
  function ecdh(Point2, ecdhOpts = {}) {
    const { Fn: Fn2 } = Point2;
    const randomBytes_ = ecdhOpts.randomBytes || randomBytes;
    const lengths = Object.assign(getWLengths(Point2.Fp, Fn2), { seed: getMinHashLength(Fn2.ORDER) });
    function isValidSecretKey(secretKey) {
      try {
        const num2 = Fn2.fromBytes(secretKey);
        return Fn2.isValidNot0(num2);
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
    function randomSecretKey(seed = randomBytes_(lengths.seed)) {
      return mapHashToField(abytes(seed, lengths.seed, "seed"), Fn2.ORDER);
    }
    function getPublicKey3(secretKey, isCompressed = true) {
      return Point2.BASE.multiply(Fn2.fromBytes(secretKey)).toBytes(isCompressed);
    }
    function isProbPub(item) {
      const { secretKey, publicKey, publicKeyUncompressed } = lengths;
      if (!isBytes(item))
        return void 0;
      if ("_lengths" in Fn2 && Fn2._lengths || secretKey === publicKey)
        return void 0;
      const l = abytes(item, void 0, "key").length;
      return l === publicKey || l === publicKeyUncompressed;
    }
    function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
      if (isProbPub(secretKeyA) === true)
        throw new Error("first arg must be private key");
      if (isProbPub(publicKeyB) === false)
        throw new Error("second arg must be public key");
      const s = Fn2.fromBytes(secretKeyA);
      const b = Point2.fromBytes(publicKeyB);
      return b.multiply(s).toBytes(isCompressed);
    }
    const utils = {
      isValidSecretKey,
      isValidPublicKey,
      randomSecretKey
    };
    const keygen = createKeygen(randomSecretKey, getPublicKey3);
    return Object.freeze({ getPublicKey: getPublicKey3, getSharedSecret, keygen, Point: Point2, utils, lengths });
  }
  function ecdsa(Point2, hash, ecdsaOpts = {}) {
    ahash(hash);
    validateObject(ecdsaOpts, {}, {
      hmac: "function",
      lowS: "boolean",
      randomBytes: "function",
      bits2int: "function",
      bits2int_modN: "function"
    });
    ecdsaOpts = Object.assign({}, ecdsaOpts);
    const randomBytes3 = ecdsaOpts.randomBytes || randomBytes;
    const hmac2 = ecdsaOpts.hmac || ((key, msg) => hmac(hash, key, msg));
    const { Fp, Fn: Fn2 } = Point2;
    const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn2;
    const { keygen, getPublicKey: getPublicKey3, getSharedSecret, utils, lengths } = ecdh(Point2, ecdsaOpts);
    const defaultSigOpts = {
      prehash: true,
      lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : true,
      format: "compact",
      extraEntropy: false
    };
    const hasLargeCofactor = CURVE_ORDER * _2n2 < Fp.ORDER;
    function isBiggerThanHalfOrder(number) {
      const HALF = CURVE_ORDER >> _1n4;
      return number > HALF;
    }
    function validateRS(title, num2) {
      if (!Fn2.isValidNot0(num2))
        throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
      return num2;
    }
    function assertSmallCofactor() {
      if (hasLargeCofactor)
        throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
    }
    function validateSigLength(bytes, format) {
      validateSigFormat(format);
      const size = lengths.signature;
      const sizer = format === "compact" ? size : format === "recovered" ? size + 1 : void 0;
      return abytes(bytes, sizer);
    }
    class Signature {
      constructor(r, s, recovery) {
        __publicField(this, "r");
        __publicField(this, "s");
        __publicField(this, "recovery");
        this.r = validateRS("r", r);
        this.s = validateRS("s", s);
        if (recovery != null) {
          assertSmallCofactor();
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
          const { r: r2, s: s2 } = DER.toSig(abytes(bytes));
          return new Signature(r2, s2);
        }
        if (format === "recovered") {
          recid = bytes[0];
          format = "compact";
          bytes = bytes.subarray(1);
        }
        const L = lengths.signature / 2;
        const r = bytes.subarray(0, L);
        const s = bytes.subarray(L, L * 2);
        return new Signature(Fn2.fromBytes(r), Fn2.fromBytes(s), recid);
      }
      static fromHex(hex, format) {
        return this.fromBytes(hexToBytes(hex), format);
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
      recoverPublicKey(messageHash) {
        const { r, s } = this;
        const recovery = this.assertRecovery();
        const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
        if (!Fp.isValid(radj))
          throw new Error("invalid recovery id: sig.r+curve.n != R.x");
        const x = Fp.toBytes(radj);
        const R = Point2.fromBytes(concatBytes(pprefix((recovery & 1) === 0), x));
        const ir = Fn2.inv(radj);
        const h = bits2int_modN(abytes(messageHash, void 0, "msgHash"));
        const u1 = Fn2.create(-h * ir);
        const u2 = Fn2.create(s * ir);
        const Q = Point2.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
        if (Q.is0())
          throw new Error("invalid recovery: point at infinify");
        Q.assertValidity();
        return Q;
      }
      // Signatures should be low-s, to prevent malleability.
      hasHighS() {
        return isBiggerThanHalfOrder(this.s);
      }
      toBytes(format = defaultSigOpts.format) {
        validateSigFormat(format);
        if (format === "der")
          return hexToBytes(DER.hexFromSig(this));
        const { r, s } = this;
        const rb = Fn2.toBytes(r);
        const sb = Fn2.toBytes(s);
        if (format === "recovered") {
          assertSmallCofactor();
          return concatBytes(Uint8Array.of(this.assertRecovery()), rb, sb);
        }
        return concatBytes(rb, sb);
      }
      toHex(format) {
        return bytesToHex(this.toBytes(format));
      }
    }
    const bits2int = ecdsaOpts.bits2int || function bits2int_def(bytes) {
      if (bytes.length > 8192)
        throw new Error("input is too large");
      const num2 = bytesToNumberBE(bytes);
      const delta = bytes.length * 8 - fnBits;
      return delta > 0 ? num2 >> BigInt(delta) : num2;
    };
    const bits2int_modN = ecdsaOpts.bits2int_modN || function bits2int_modN_def(bytes) {
      return Fn2.create(bits2int(bytes));
    };
    const ORDER_MASK = bitMask(fnBits);
    function int2octets(num2) {
      aInRange("num < 2^" + fnBits, num2, _0n4, ORDER_MASK);
      return Fn2.toBytes(num2);
    }
    function validateMsgAndHash(message, prehash) {
      abytes(message, void 0, "message");
      return prehash ? abytes(hash(message), void 0, "prehashed message") : message;
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
        const e = extraEntropy === true ? randomBytes3(lengths.secretKey) : extraEntropy;
        seedArgs.push(abytes(e, void 0, "extraEntropy"));
      }
      const seed = concatBytes(...seedArgs);
      const m = h1int;
      function k2sig(kBytes) {
        const k = bits2int(kBytes);
        if (!Fn2.isValidNot0(k))
          return;
        const ik = Fn2.inv(k);
        const q = Point2.BASE.multiply(k).toAffine();
        const r = Fn2.create(q.x);
        if (r === _0n4)
          return;
        const s = Fn2.create(ik * Fn2.create(m + r * d));
        if (s === _0n4)
          return;
        let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n4);
        let normS = s;
        if (lowS && isBiggerThanHalfOrder(s)) {
          normS = Fn2.neg(s);
          recovery ^= 1;
        }
        return new Signature(r, normS, hasLargeCofactor ? void 0 : recovery);
      }
      return { seed, k2sig };
    }
    function sign(message, secretKey, opts = {}) {
      const { seed, k2sig } = prepSig(message, secretKey, opts);
      const drbg = createHmacDrbg(hash.outputLen, Fn2.BYTES, hmac2);
      const sig = drbg(seed, k2sig);
      return sig.toBytes(opts.format);
    }
    function verify(signature, message, publicKey, opts = {}) {
      const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
      publicKey = abytes(publicKey, void 0, "publicKey");
      message = validateMsgAndHash(message, prehash);
      if (!isBytes(signature)) {
        const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
        throw new Error("verify expects Uint8Array signature" + end);
      }
      validateSigLength(signature, format);
      try {
        const sig = Signature.fromBytes(signature, format);
        const P = Point2.fromBytes(publicKey);
        if (lowS && sig.hasHighS())
          return false;
        const { r, s } = sig;
        const h = bits2int_modN(message);
        const is = Fn2.inv(s);
        const u1 = Fn2.create(h * is);
        const u2 = Fn2.create(r * is);
        const R = Point2.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
        if (R.is0())
          return false;
        const v = Fn2.create(R.x);
        return v === r;
      } catch (e) {
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
      getPublicKey: getPublicKey3,
      getSharedSecret,
      utils,
      lengths,
      Point: Point2,
      sign,
      verify,
      recoverPublicKey,
      Signature,
      hash
    });
  }

  // node_modules/@noble/curves/secp256k1.js
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
  function sqrtMod(y) {
    const P = secp256k1_CURVE.p;
    const _3n3 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
    const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
    const b2 = y * y * y % P;
    const b3 = b2 * b2 * y % P;
    const b6 = pow2(b3, _3n3, P) * b3 % P;
    const b9 = pow2(b6, _3n3, P) * b3 % P;
    const b11 = pow2(b9, _2n3, P) * b2 % P;
    const b22 = pow2(b11, _11n, P) * b11 % P;
    const b44 = pow2(b22, _22n, P) * b22 % P;
    const b88 = pow2(b44, _44n, P) * b44 % P;
    const b176 = pow2(b88, _88n, P) * b88 % P;
    const b220 = pow2(b176, _44n, P) * b44 % P;
    const b223 = pow2(b220, _3n3, P) * b3 % P;
    const t1 = pow2(b223, _23n, P) * b22 % P;
    const t2 = pow2(t1, _6n, P) * b2 % P;
    const root = pow2(t2, _2n3, P);
    if (!Fpk1.eql(Fpk1.sqr(root), y))
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
      tagP = concatBytes(tagH, tagH);
      TAGGED_HASH_PREFIXES[tag] = tagP;
    }
    return sha256(concatBytes(tagP, ...messages));
  }
  var pointToBytes = (point) => point.toBytes(true).slice(1);
  var hasEven = (y) => y % _2n3 === _0n5;
  function schnorrGetExtPubKey(priv) {
    const { Fn: Fn2, BASE } = Pointk1;
    const d_ = Fn2.fromBytes(priv);
    const p = BASE.multiply(d_);
    const scalar = hasEven(p.y) ? d_ : Fn2.neg(d_);
    return { scalar, bytes: pointToBytes(p) };
  }
  function lift_x(x) {
    const Fp = Fpk1;
    if (!Fp.isValidNot0(x))
      throw new Error("invalid x: Fail if x \u2265 p");
    const xx = Fp.create(x * x);
    const c = Fp.create(xx * x + BigInt(7));
    let y = Fp.sqrt(c);
    if (!hasEven(y))
      y = Fp.neg(y);
    const p = Pointk1.fromAffine({ x, y });
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
    const { Fn: Fn2 } = Pointk1;
    const m = abytes(message, void 0, "message");
    const { bytes: px, scalar: d } = schnorrGetExtPubKey(secretKey);
    const a = abytes(auxRand, 32, "auxRand");
    const t = Fn2.toBytes(d ^ num(taggedHash("BIP0340/aux", a)));
    const rand = taggedHash("BIP0340/nonce", t, px, m);
    const { bytes: rx, scalar: k } = schnorrGetExtPubKey(rand);
    const e = challenge(rx, px, m);
    const sig = new Uint8Array(64);
    sig.set(rx, 0);
    sig.set(Fn2.toBytes(Fn2.create(k + e * d)), 32);
    if (!schnorrVerify(sig, m, px))
      throw new Error("sign: Invalid signature produced");
    return sig;
  }
  function schnorrVerify(signature, message, publicKey) {
    const { Fp, Fn: Fn2, BASE } = Pointk1;
    const sig = abytes(signature, 64, "signature");
    const m = abytes(message, void 0, "message");
    const pub2 = abytes(publicKey, 32, "publicKey");
    try {
      const P = lift_x(num(pub2));
      const r = num(sig.subarray(0, 32));
      if (!Fp.isValidNot0(r))
        return false;
      const s = num(sig.subarray(32, 64));
      if (!Fn2.isValidNot0(s))
        return false;
      const e = challenge(Fn2.toBytes(r), pointToBytes(P), m);
      const R = BASE.multiplyUnsafe(s).add(P.multiplyUnsafe(Fn2.neg(e)));
      const { x, y } = R.toAffine();
      if (R.is0() || !hasEven(y) || x !== r)
        return false;
      return true;
    } catch (error) {
      return false;
    }
  }
  var schnorr = /* @__PURE__ */ (() => {
    const size = 32;
    const seedLength = 48;
    const randomSecretKey = (seed = randomBytes(seedLength)) => {
      return mapHashToField(seed, secp256k1_CURVE.n);
    };
    return {
      keygen: createKeygen(randomSecretKey, schnorrGetPublicKey),
      getPublicKey: schnorrGetPublicKey,
      sign: schnorrSign,
      verify: schnorrVerify,
      Point: Pointk1,
      utils: {
        randomSecretKey,
        taggedHash,
        lift_x,
        pointToBytes
      },
      lengths: {
        secretKey: size,
        publicKey: size,
        publicKeyHasPrefix: false,
        signature: size * 2,
        seed: seedLength
      }
    };
  })();

  // node_modules/nostr-tools/lib/esm/pool.js
  var verifiedSymbol = /* @__PURE__ */ Symbol("verified");
  var isRecord = (obj) => obj instanceof Object;
  function validateEvent(event) {
    if (!isRecord(event))
      return false;
    if (typeof event.kind !== "number")
      return false;
    if (typeof event.content !== "string")
      return false;
    if (typeof event.created_at !== "number")
      return false;
    if (typeof event.pubkey !== "string")
      return false;
    if (!event.pubkey.match(/^[a-f0-9]{64}$/))
      return false;
    if (!Array.isArray(event.tags))
      return false;
    for (let i22 = 0; i22 < event.tags.length; i22++) {
      let tag = event.tags[i22];
      if (!Array.isArray(tag))
        return false;
      for (let j = 0; j < tag.length; j++) {
        if (typeof tag[j] !== "string")
          return false;
      }
    }
    return true;
  }
  var utf8Decoder = new TextDecoder("utf-8");
  var utf8Encoder = new TextEncoder();
  function normalizeURL(url) {
    try {
      if (url.indexOf("://") === -1)
        url = "wss://" + url;
      let p = new URL(url);
      if (p.protocol === "http:")
        p.protocol = "ws:";
      else if (p.protocol === "https:")
        p.protocol = "wss:";
      p.pathname = p.pathname.replace(/\/+/g, "/");
      if (p.pathname.endsWith("/"))
        p.pathname = p.pathname.slice(0, -1);
      if (p.port === "80" && p.protocol === "ws:" || p.port === "443" && p.protocol === "wss:")
        p.port = "";
      p.searchParams.sort();
      p.hash = "";
      return p.toString();
    } catch (e) {
      throw new Error(`Invalid URL: ${url}`);
    }
  }
  var JS = class {
    generateSecretKey() {
      return schnorr.utils.randomSecretKey();
    }
    getPublicKey(secretKey) {
      return bytesToHex(schnorr.getPublicKey(secretKey));
    }
    finalizeEvent(t, secretKey) {
      const event = t;
      event.pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
      event.id = getEventHash(event);
      event.sig = bytesToHex(schnorr.sign(hexToBytes(getEventHash(event)), secretKey));
      event[verifiedSymbol] = true;
      return event;
    }
    verifyEvent(event) {
      if (typeof event[verifiedSymbol] === "boolean")
        return event[verifiedSymbol];
      try {
        const hash = getEventHash(event);
        if (hash !== event.id) {
          event[verifiedSymbol] = false;
          return false;
        }
        const valid = schnorr.verify(hexToBytes(event.sig), hexToBytes(hash), hexToBytes(event.pubkey));
        event[verifiedSymbol] = valid;
        return valid;
      } catch (err) {
        event[verifiedSymbol] = false;
        return false;
      }
    }
  };
  function serializeEvent(evt) {
    if (!validateEvent(evt))
      throw new Error("can't serialize event with wrong or missing properties");
    return JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content]);
  }
  function getEventHash(event) {
    let eventHash = sha256(utf8Encoder.encode(serializeEvent(event)));
    return bytesToHex(eventHash);
  }
  var i = new JS();
  var generateSecretKey = i.generateSecretKey;
  var getPublicKey = i.getPublicKey;
  var finalizeEvent = i.finalizeEvent;
  var verifyEvent = i.verifyEvent;
  var ClientAuth = 22242;
  function matchFilter(filter, event) {
    if (filter.ids && filter.ids.indexOf(event.id) === -1) {
      return false;
    }
    if (filter.kinds && filter.kinds.indexOf(event.kind) === -1) {
      return false;
    }
    if (filter.authors && filter.authors.indexOf(event.pubkey) === -1) {
      return false;
    }
    for (let f in filter) {
      if (f[0] === "#") {
        let tagName = f.slice(1);
        let values = filter[`#${tagName}`];
        if (values && !event.tags.find(([t, v]) => t === f.slice(1) && values.indexOf(v) !== -1))
          return false;
      }
    }
    if (filter.since && event.created_at < filter.since)
      return false;
    if (filter.until && event.created_at > filter.until)
      return false;
    return true;
  }
  function matchFilters(filters, event) {
    for (let i22 = 0; i22 < filters.length; i22++) {
      if (matchFilter(filters[i22], event)) {
        return true;
      }
    }
    return false;
  }
  function getHex64(json, field) {
    let len = field.length + 3;
    let idx = json.indexOf(`"${field}":`) + len;
    let s = json.slice(idx).indexOf(`"`) + idx + 1;
    return json.slice(s, s + 64);
  }
  function getSubscriptionId(json) {
    let idx = json.slice(0, 22).indexOf(`"EVENT"`);
    if (idx === -1)
      return null;
    let pstart = json.slice(idx + 7 + 1).indexOf(`"`);
    if (pstart === -1)
      return null;
    let start = idx + 7 + 1 + pstart;
    let pend = json.slice(start + 1, 80).indexOf(`"`);
    if (pend === -1)
      return null;
    let end = start + 1 + pend;
    return json.slice(start + 1, end);
  }
  function makeAuthEvent(relayURL, challenge2) {
    return {
      kind: ClientAuth,
      created_at: Math.floor(Date.now() / 1e3),
      tags: [
        ["relay", relayURL],
        ["challenge", challenge2]
      ],
      content: ""
    };
  }
  var SendingOnClosedConnection = class extends Error {
    constructor(message, relay) {
      super(`Tried to send message '${message} on a closed connection to ${relay}.`);
      this.name = "SendingOnClosedConnection";
    }
  };
  var AbstractRelay = class {
    constructor(url, opts) {
      __publicField(this, "url");
      __publicField(this, "_connected", false);
      __publicField(this, "onclose", null);
      __publicField(this, "onnotice", (msg) => console.debug(`NOTICE from ${this.url}: ${msg}`));
      __publicField(this, "onauth");
      __publicField(this, "baseEoseTimeout", 4400);
      __publicField(this, "publishTimeout", 4400);
      __publicField(this, "pingFrequency", 29e3);
      __publicField(this, "pingTimeout", 2e4);
      __publicField(this, "resubscribeBackoff", [1e4, 1e4, 1e4, 2e4, 2e4, 3e4, 6e4]);
      __publicField(this, "openSubs", /* @__PURE__ */ new Map());
      __publicField(this, "enablePing");
      __publicField(this, "enableReconnect");
      __publicField(this, "idleSince", Date.now());
      __publicField(this, "ongoingOperations", 0);
      __publicField(this, "reconnectTimeoutHandle");
      __publicField(this, "pingIntervalHandle");
      __publicField(this, "reconnectAttempts", 0);
      __publicField(this, "skipReconnection", false);
      __publicField(this, "connectionPromise");
      __publicField(this, "openCountRequests", /* @__PURE__ */ new Map());
      __publicField(this, "openEventPublishes", /* @__PURE__ */ new Map());
      __publicField(this, "ws");
      __publicField(this, "challenge");
      __publicField(this, "authPromise");
      __publicField(this, "serial", 0);
      __publicField(this, "verifyEvent");
      __publicField(this, "_WebSocket");
      this.url = normalizeURL(url);
      this.verifyEvent = opts.verifyEvent;
      this._WebSocket = opts.websocketImplementation || WebSocket;
      this.enablePing = opts.enablePing;
      this.enableReconnect = opts.enableReconnect || false;
    }
    static async connect(url, opts) {
      const relay = new AbstractRelay(url, opts);
      await relay.connect(opts);
      return relay;
    }
    closeAllSubscriptions(reason) {
      for (let [_, sub] of this.openSubs) {
        sub.close(reason);
      }
      this.openSubs.clear();
      for (let [_, ep] of this.openEventPublishes) {
        ep.reject(new Error(reason));
      }
      this.openEventPublishes.clear();
      for (let [_, cr] of this.openCountRequests) {
        cr.reject(new Error(reason));
      }
      this.openCountRequests.clear();
    }
    get connected() {
      return this._connected;
    }
    async reconnect() {
      const backoff = this.resubscribeBackoff[Math.min(this.reconnectAttempts, this.resubscribeBackoff.length - 1)];
      this.reconnectAttempts++;
      this.reconnectTimeoutHandle = setTimeout(async () => {
        try {
          await this.connect();
        } catch (err) {
        }
      }, backoff);
    }
    handleHardClose(reason) {
      if (this.pingIntervalHandle) {
        clearInterval(this.pingIntervalHandle);
        this.pingIntervalHandle = void 0;
      }
      this._connected = false;
      this.connectionPromise = void 0;
      this.idleSince = void 0;
      if (this.enableReconnect && !this.skipReconnection) {
        this.reconnect();
      } else {
        this.onclose?.();
        this.closeAllSubscriptions(reason);
      }
    }
    async connect(opts) {
      let connectionTimeoutHandle;
      if (this.connectionPromise)
        return this.connectionPromise;
      this.challenge = void 0;
      this.authPromise = void 0;
      this.skipReconnection = false;
      this.connectionPromise = new Promise((resolve, reject) => {
        if (opts?.timeout) {
          connectionTimeoutHandle = setTimeout(() => {
            reject("connection timed out");
            this.connectionPromise = void 0;
            this.skipReconnection = true;
            this.onclose?.();
            this.handleHardClose("relay connection timed out");
          }, opts.timeout);
        }
        if (opts?.abort) {
          opts.abort.onabort = reject;
        }
        try {
          this.ws = new this._WebSocket(this.url);
        } catch (err) {
          clearTimeout(connectionTimeoutHandle);
          reject(err);
          return;
        }
        this.ws.onopen = () => {
          if (this.reconnectTimeoutHandle) {
            clearTimeout(this.reconnectTimeoutHandle);
            this.reconnectTimeoutHandle = void 0;
          }
          clearTimeout(connectionTimeoutHandle);
          this._connected = true;
          const isReconnection = this.reconnectAttempts > 0;
          this.reconnectAttempts = 0;
          for (const sub of this.openSubs.values()) {
            sub.eosed = false;
            if (isReconnection) {
              for (let f = 0; f < sub.filters.length; f++) {
                if (sub.lastEmitted) {
                  sub.filters[f].since = sub.lastEmitted + 1;
                }
              }
            }
            sub.fire();
          }
          if (this.enablePing) {
            this.pingIntervalHandle = setInterval(() => this.pingpong(), this.pingFrequency);
          }
          resolve();
        };
        this.ws.onerror = () => {
          clearTimeout(connectionTimeoutHandle);
          reject("connection failed");
          this.connectionPromise = void 0;
          this.skipReconnection = true;
          this.onclose?.();
          this.handleHardClose("relay connection failed");
        };
        this.ws.onclose = (ev) => {
          clearTimeout(connectionTimeoutHandle);
          reject(ev.message || "websocket closed");
          this.handleHardClose("relay connection closed");
        };
        this.ws.onmessage = this._onmessage.bind(this);
      });
      return this.connectionPromise;
    }
    waitForPingPong() {
      return new Promise((resolve) => {
        ;
        this.ws.once("pong", () => resolve(true));
        this.ws.ping();
      });
    }
    waitForDummyReq() {
      return new Promise((resolve, reject) => {
        if (!this.connectionPromise)
          return reject(new Error(`no connection to ${this.url}, can't ping`));
        try {
          const sub = this.subscribe(
            [{ ids: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], limit: 0 }],
            {
              label: "<forced-ping>",
              oneose: () => {
                resolve(true);
                sub.close();
              },
              onclose() {
                resolve(true);
              },
              eoseTimeout: this.pingTimeout + 1e3
            }
          );
        } catch (err) {
          reject(err);
        }
      });
    }
    async pingpong() {
      if (this.ws?.readyState === 1) {
        const result = await Promise.any([
          this.ws && this.ws.ping && this.ws.once ? this.waitForPingPong() : this.waitForDummyReq(),
          new Promise((res) => setTimeout(() => res(false), this.pingTimeout))
        ]);
        if (!result) {
          if (this.ws?.readyState === this._WebSocket.OPEN) {
            this.ws?.close();
          }
        }
      }
    }
    async send(message) {
      if (!this.connectionPromise)
        throw new SendingOnClosedConnection(message, this.url);
      this.connectionPromise.then(() => {
        this.ws?.send(message);
      });
    }
    async auth(signAuthEvent) {
      const challenge2 = this.challenge;
      if (!challenge2)
        throw new Error("can't perform auth, no challenge was received");
      if (this.authPromise)
        return this.authPromise;
      this.authPromise = new Promise(async (resolve, reject) => {
        try {
          let evt = await signAuthEvent(makeAuthEvent(this.url, challenge2));
          let timeout = setTimeout(() => {
            let ep = this.openEventPublishes.get(evt.id);
            if (ep) {
              ep.reject(new Error("auth timed out"));
              this.openEventPublishes.delete(evt.id);
            }
          }, this.publishTimeout);
          this.openEventPublishes.set(evt.id, { resolve, reject, timeout });
          this.send('["AUTH",' + JSON.stringify(evt) + "]");
        } catch (err) {
          console.warn("subscribe auth function failed:", err);
        }
      });
      return this.authPromise;
    }
    async publish(event) {
      this.idleSince = void 0;
      this.ongoingOperations++;
      const ret = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const ep = this.openEventPublishes.get(event.id);
          if (ep) {
            ep.reject(new Error("publish timed out"));
            this.openEventPublishes.delete(event.id);
          }
        }, this.publishTimeout);
        this.openEventPublishes.set(event.id, { resolve, reject, timeout });
      });
      this.send('["EVENT",' + JSON.stringify(event) + "]");
      this.ongoingOperations--;
      if (this.ongoingOperations === 0)
        this.idleSince = Date.now();
      return ret;
    }
    async count(filters, params) {
      this.serial++;
      const id = params?.id || "count:" + this.serial;
      const ret = new Promise((resolve, reject) => {
        this.openCountRequests.set(id, { resolve, reject });
      });
      this.send('["COUNT","' + id + '",' + JSON.stringify(filters).substring(1));
      return ret;
    }
    subscribe(filters, params) {
      if (params.label !== "<forced-ping>") {
        this.idleSince = void 0;
        this.ongoingOperations++;
      }
      const sub = this.prepareSubscription(filters, params);
      sub.fire();
      if (params.abort) {
        params.abort.onabort = () => sub.close(String(params.abort.reason || "<aborted>"));
      }
      return sub;
    }
    prepareSubscription(filters, params) {
      this.serial++;
      const id = params.id || (params.label ? params.label + ":" : "sub:") + this.serial;
      const sub = new Subscription(this, id, filters, params);
      this.openSubs.set(id, sub);
      return sub;
    }
    close() {
      this.skipReconnection = true;
      if (this.reconnectTimeoutHandle) {
        clearTimeout(this.reconnectTimeoutHandle);
        this.reconnectTimeoutHandle = void 0;
      }
      if (this.pingIntervalHandle) {
        clearInterval(this.pingIntervalHandle);
        this.pingIntervalHandle = void 0;
      }
      this.closeAllSubscriptions("relay connection closed by us");
      this._connected = false;
      this.idleSince = void 0;
      this.onclose?.();
      if (this.ws?.readyState === this._WebSocket.OPEN) {
        this.ws?.close();
      }
    }
    _onmessage(ev) {
      const json = ev.data;
      if (!json) {
        return;
      }
      const subid = getSubscriptionId(json);
      if (subid) {
        const so = this.openSubs.get(subid);
        if (!so) {
          return;
        }
        const id = getHex64(json, "id");
        const alreadyHave = so.alreadyHaveEvent?.(id);
        so.receivedEvent?.(this, id);
        if (alreadyHave) {
          return;
        }
      }
      try {
        let data = JSON.parse(json);
        switch (data[0]) {
          case "EVENT": {
            const so = this.openSubs.get(data[1]);
            const event = data[2];
            if (this.verifyEvent(event) && matchFilters(so.filters, event)) {
              so.onevent(event);
            } else {
              so.oninvalidevent?.(event);
            }
            if (!so.lastEmitted || so.lastEmitted < event.created_at)
              so.lastEmitted = event.created_at;
            return;
          }
          case "COUNT": {
            const id = data[1];
            const payload = data[2];
            const cr = this.openCountRequests.get(id);
            if (cr) {
              cr.resolve(payload.count);
              this.openCountRequests.delete(id);
            }
            return;
          }
          case "EOSE": {
            const so = this.openSubs.get(data[1]);
            if (!so)
              return;
            so.receivedEose();
            return;
          }
          case "OK": {
            const id = data[1];
            const ok = data[2];
            const reason = data[3];
            const ep = this.openEventPublishes.get(id);
            if (ep) {
              clearTimeout(ep.timeout);
              if (ok)
                ep.resolve(reason);
              else
                ep.reject(new Error(reason));
              this.openEventPublishes.delete(id);
            }
            return;
          }
          case "CLOSED": {
            const id = data[1];
            const so = this.openSubs.get(id);
            if (!so)
              return;
            so.closed = true;
            so.close(data[2]);
            return;
          }
          case "NOTICE": {
            this.onnotice(data[1]);
            return;
          }
          case "AUTH": {
            this.challenge = data[1];
            if (this.onauth) {
              this.auth(this.onauth).catch((err) => {
                if (!(err instanceof SendingOnClosedConnection)) {
                  throw err;
                }
              });
            }
            return;
          }
          default: {
            const so = this.openSubs.get(data[1]);
            so?.oncustom?.(data);
            return;
          }
        }
      } catch (err) {
        try {
          const [_, __, event] = JSON.parse(json);
          console.warn(`[nostr] relay ${this.url} error processing message:`, err, event);
        } catch (_) {
          console.warn(`[nostr] relay ${this.url} error processing message:`, err);
        }
        return;
      }
    }
  };
  var Subscription = class {
    constructor(relay, id, filters, params) {
      __publicField(this, "relay");
      __publicField(this, "id");
      __publicField(this, "lastEmitted");
      __publicField(this, "closed", false);
      __publicField(this, "eosed", false);
      __publicField(this, "filters");
      __publicField(this, "alreadyHaveEvent");
      __publicField(this, "receivedEvent");
      __publicField(this, "onevent");
      __publicField(this, "oninvalidevent");
      __publicField(this, "oneose");
      __publicField(this, "onclose");
      __publicField(this, "oncustom");
      __publicField(this, "eoseTimeout");
      __publicField(this, "eoseTimeoutHandle");
      if (filters.length === 0)
        throw new Error("subscription can't be created with zero filters");
      this.relay = relay;
      this.filters = filters;
      this.id = id;
      this.alreadyHaveEvent = params.alreadyHaveEvent;
      this.receivedEvent = params.receivedEvent;
      this.eoseTimeout = params.eoseTimeout || relay.baseEoseTimeout;
      this.oneose = params.oneose;
      this.onclose = params.onclose;
      this.oninvalidevent = params.oninvalidevent;
      this.onevent = params.onevent || ((event) => {
        console.warn(
          `onevent() callback not defined for subscription '${this.id}' in relay ${this.relay.url}. event received:`,
          event
        );
      });
    }
    fire() {
      this.relay.send('["REQ","' + this.id + '",' + JSON.stringify(this.filters).substring(1));
      this.eoseTimeoutHandle = setTimeout(this.receivedEose.bind(this), this.eoseTimeout);
    }
    receivedEose() {
      if (this.eosed)
        return;
      clearTimeout(this.eoseTimeoutHandle);
      this.eosed = true;
      this.oneose?.();
    }
    close(reason = "closed by caller") {
      if (!this.closed && this.relay.connected) {
        try {
          this.relay.send('["CLOSE",' + JSON.stringify(this.id) + "]");
        } catch (err) {
          if (err instanceof SendingOnClosedConnection) {
          } else {
            throw err;
          }
        }
        this.closed = true;
      }
      this.relay.openSubs.delete(this.id);
      this.relay.ongoingOperations--;
      if (this.relay.ongoingOperations === 0)
        this.relay.idleSince = Date.now();
      this.onclose?.(reason);
    }
  };
  var alwaysTrue = (t) => {
    t[verifiedSymbol] = true;
    return true;
  };
  var AbstractSimplePool = class {
    constructor(opts) {
      __publicField(this, "relays", /* @__PURE__ */ new Map());
      __publicField(this, "seenOn", /* @__PURE__ */ new Map());
      __publicField(this, "trackRelays", false);
      __publicField(this, "verifyEvent");
      __publicField(this, "enablePing");
      __publicField(this, "enableReconnect");
      __publicField(this, "automaticallyAuth");
      __publicField(this, "trustedRelayURLs", /* @__PURE__ */ new Set());
      __publicField(this, "onRelayConnectionFailure");
      __publicField(this, "onRelayConnectionSuccess");
      __publicField(this, "allowConnectingToRelay");
      __publicField(this, "maxWaitForConnection");
      __publicField(this, "_WebSocket");
      this.verifyEvent = opts.verifyEvent;
      this._WebSocket = opts.websocketImplementation;
      this.enablePing = opts.enablePing;
      this.enableReconnect = opts.enableReconnect || false;
      this.automaticallyAuth = opts.automaticallyAuth;
      this.onRelayConnectionFailure = opts.onRelayConnectionFailure;
      this.onRelayConnectionSuccess = opts.onRelayConnectionSuccess;
      this.allowConnectingToRelay = opts.allowConnectingToRelay;
      this.maxWaitForConnection = opts.maxWaitForConnection || 3e3;
    }
    async ensureRelay(url, params) {
      url = normalizeURL(url);
      let relay = this.relays.get(url);
      if (!relay) {
        relay = new AbstractRelay(url, {
          verifyEvent: this.trustedRelayURLs.has(url) ? alwaysTrue : this.verifyEvent,
          websocketImplementation: this._WebSocket,
          enablePing: this.enablePing,
          enableReconnect: this.enableReconnect
        });
        relay.onclose = () => {
          this.relays.delete(url);
        };
        this.relays.set(url, relay);
      }
      if (this.automaticallyAuth) {
        const authSignerFn = this.automaticallyAuth(url);
        if (authSignerFn) {
          relay.onauth = authSignerFn;
        }
      }
      try {
        await relay.connect({
          timeout: params?.connectionTimeout,
          abort: params?.abort
        });
      } catch (err) {
        this.relays.delete(url);
        throw err;
      }
      return relay;
    }
    close(relays) {
      relays.map(normalizeURL).forEach((url) => {
        this.relays.get(url)?.close();
        this.relays.delete(url);
      });
    }
    subscribe(relays, filter, params) {
      const request = [];
      const uniqUrls = [];
      for (let i22 = 0; i22 < relays.length; i22++) {
        const url = normalizeURL(relays[i22]);
        if (!request.find((r) => r.url === url)) {
          if (uniqUrls.indexOf(url) === -1) {
            uniqUrls.push(url);
            request.push({ url, filter });
          }
        }
      }
      return this.subscribeMap(request, params);
    }
    subscribeMany(relays, filter, params) {
      return this.subscribe(relays, filter, params);
    }
    subscribeMap(requests, params) {
      const grouped = /* @__PURE__ */ new Map();
      for (const req of requests) {
        const { url, filter } = req;
        if (!grouped.has(url))
          grouped.set(url, []);
        grouped.get(url).push(filter);
      }
      const groupedRequests = Array.from(grouped.entries()).map(([url, filters]) => ({ url, filters }));
      if (this.trackRelays) {
        params.receivedEvent = (relay, id) => {
          let set = this.seenOn.get(id);
          if (!set) {
            set = /* @__PURE__ */ new Set();
            this.seenOn.set(id, set);
          }
          set.add(relay);
        };
      }
      const _knownIds = /* @__PURE__ */ new Set();
      const subs = [];
      const eosesReceived = [];
      let handleEose = (i22) => {
        if (eosesReceived[i22])
          return;
        eosesReceived[i22] = true;
        if (eosesReceived.filter((a) => a).length === groupedRequests.length) {
          params.oneose?.();
          handleEose = () => {
          };
        }
      };
      const closesReceived = [];
      let handleClose = (i22, reason) => {
        if (closesReceived[i22])
          return;
        handleEose(i22);
        closesReceived[i22] = reason;
        if (closesReceived.filter((a) => a).length === groupedRequests.length) {
          params.onclose?.(closesReceived);
          handleClose = () => {
          };
        }
      };
      const localAlreadyHaveEventHandler = (id) => {
        if (params.alreadyHaveEvent?.(id)) {
          return true;
        }
        const have = _knownIds.has(id);
        _knownIds.add(id);
        return have;
      };
      const allOpened = Promise.all(
        groupedRequests.map(async ({ url, filters }, i22) => {
          if (this.allowConnectingToRelay?.(url, ["read", filters]) === false) {
            handleClose(i22, "connection skipped by allowConnectingToRelay");
            return;
          }
          let relay;
          try {
            relay = await this.ensureRelay(url, {
              connectionTimeout: this.maxWaitForConnection < (params.maxWait || 0) ? Math.max(params.maxWait * 0.8, params.maxWait - 1e3) : this.maxWaitForConnection,
              abort: params.abort
            });
          } catch (err) {
            this.onRelayConnectionFailure?.(url);
            handleClose(i22, err?.message || String(err));
            return;
          }
          this.onRelayConnectionSuccess?.(url);
          let subscription = relay.subscribe(filters, {
            ...params,
            oneose: () => handleEose(i22),
            onclose: (reason) => {
              if (reason.startsWith("auth-required: ") && params.onauth) {
                relay.auth(params.onauth).then(() => {
                  relay.subscribe(filters, {
                    ...params,
                    oneose: () => handleEose(i22),
                    onclose: (reason2) => {
                      handleClose(i22, reason2);
                    },
                    alreadyHaveEvent: localAlreadyHaveEventHandler,
                    eoseTimeout: params.maxWait,
                    abort: params.abort
                  });
                }).catch((err) => {
                  handleClose(i22, `auth was required and attempted, but failed with: ${err}`);
                });
              } else {
                handleClose(i22, reason);
              }
            },
            alreadyHaveEvent: localAlreadyHaveEventHandler,
            eoseTimeout: params.maxWait,
            abort: params.abort
          });
          subs.push(subscription);
        })
      );
      return {
        async close(reason) {
          await allOpened;
          subs.forEach((sub) => {
            sub.close(reason);
          });
        }
      };
    }
    subscribeEose(relays, filter, params) {
      let subcloser;
      subcloser = this.subscribe(relays, filter, {
        ...params,
        oneose() {
          const reason = "closed automatically on eose";
          if (subcloser)
            subcloser.close(reason);
          else
            params.onclose?.(relays.map((_) => reason));
        }
      });
      return subcloser;
    }
    subscribeManyEose(relays, filter, params) {
      return this.subscribeEose(relays, filter, params);
    }
    async querySync(relays, filter, params) {
      return new Promise(async (resolve) => {
        const events = [];
        this.subscribeEose(relays, filter, {
          ...params,
          onevent(event) {
            events.push(event);
          },
          onclose(_) {
            resolve(events);
          }
        });
      });
    }
    async get(relays, filter, params) {
      filter.limit = 1;
      const events = await this.querySync(relays, filter, params);
      events.sort((a, b) => b.created_at - a.created_at);
      return events[0] || null;
    }
    publish(relays, event, params) {
      return relays.map(normalizeURL).map(async (url, i22, arr) => {
        if (arr.indexOf(url) !== i22) {
          return Promise.reject("duplicate url");
        }
        if (this.allowConnectingToRelay?.(url, ["write", event]) === false) {
          return Promise.reject("connection skipped by allowConnectingToRelay");
        }
        let r;
        try {
          r = await this.ensureRelay(url, {
            connectionTimeout: this.maxWaitForConnection < (params?.maxWait || 0) ? Math.max(params.maxWait * 0.8, params.maxWait - 1e3) : this.maxWaitForConnection,
            abort: params?.abort
          });
        } catch (err) {
          this.onRelayConnectionFailure?.(url);
          return String("connection failure: " + String(err));
        }
        return r.publish(event).catch(async (err) => {
          if (err instanceof Error && err.message.startsWith("auth-required: ") && params?.onauth) {
            await r.auth(params.onauth);
            return r.publish(event);
          }
          throw err;
        }).then((reason) => {
          if (this.trackRelays) {
            let set = this.seenOn.get(event.id);
            if (!set) {
              set = /* @__PURE__ */ new Set();
              this.seenOn.set(event.id, set);
            }
            set.add(r);
          }
          return reason;
        });
      });
    }
    listConnectionStatus() {
      const map = /* @__PURE__ */ new Map();
      this.relays.forEach((relay, url) => map.set(url, relay.connected));
      return map;
    }
    destroy() {
      this.relays.forEach((conn) => conn.close());
      this.relays = /* @__PURE__ */ new Map();
    }
    pruneIdleRelays(idleThresholdMs = 1e4) {
      const prunedUrls = [];
      for (const [url, relay] of this.relays) {
        if (relay.idleSince && Date.now() - relay.idleSince >= idleThresholdMs) {
          this.relays.delete(url);
          prunedUrls.push(url);
          relay.close();
        }
      }
      return prunedUrls;
    }
  };
  var _WebSocket;
  try {
    _WebSocket = WebSocket;
  } catch {
  }
  var SimplePool = class extends AbstractSimplePool {
    constructor(options) {
      super({ verifyEvent, websocketImplementation: _WebSocket, maxWaitForConnection: 3e3, ...options });
    }
  };

  // node_modules/nostr-tools/lib/esm/pure.js
  var verifiedSymbol2 = /* @__PURE__ */ Symbol("verified");
  var isRecord2 = (obj) => obj instanceof Object;
  function validateEvent2(event) {
    if (!isRecord2(event))
      return false;
    if (typeof event.kind !== "number")
      return false;
    if (typeof event.content !== "string")
      return false;
    if (typeof event.created_at !== "number")
      return false;
    if (typeof event.pubkey !== "string")
      return false;
    if (!event.pubkey.match(/^[a-f0-9]{64}$/))
      return false;
    if (!Array.isArray(event.tags))
      return false;
    for (let i22 = 0; i22 < event.tags.length; i22++) {
      let tag = event.tags[i22];
      if (!Array.isArray(tag))
        return false;
      for (let j = 0; j < tag.length; j++) {
        if (typeof tag[j] !== "string")
          return false;
      }
    }
    return true;
  }
  var utf8Decoder2 = new TextDecoder("utf-8");
  var utf8Encoder2 = new TextEncoder();
  var JS2 = class {
    generateSecretKey() {
      return schnorr.utils.randomSecretKey();
    }
    getPublicKey(secretKey) {
      return bytesToHex(schnorr.getPublicKey(secretKey));
    }
    finalizeEvent(t, secretKey) {
      const event = t;
      event.pubkey = bytesToHex(schnorr.getPublicKey(secretKey));
      event.id = getEventHash2(event);
      event.sig = bytesToHex(schnorr.sign(hexToBytes(getEventHash2(event)), secretKey));
      event[verifiedSymbol2] = true;
      return event;
    }
    verifyEvent(event) {
      if (typeof event[verifiedSymbol2] === "boolean")
        return event[verifiedSymbol2];
      try {
        const hash = getEventHash2(event);
        if (hash !== event.id) {
          event[verifiedSymbol2] = false;
          return false;
        }
        const valid = schnorr.verify(hexToBytes(event.sig), hexToBytes(hash), hexToBytes(event.pubkey));
        event[verifiedSymbol2] = valid;
        return valid;
      } catch (err) {
        event[verifiedSymbol2] = false;
        return false;
      }
    }
  };
  function serializeEvent2(evt) {
    if (!validateEvent2(evt))
      throw new Error("can't serialize event with wrong or missing properties");
    return JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content]);
  }
  function getEventHash2(event) {
    let eventHash = sha256(utf8Encoder2.encode(serializeEvent2(event)));
    return bytesToHex(eventHash);
  }
  var i2 = new JS2();
  var generateSecretKey2 = i2.generateSecretKey;
  var getPublicKey2 = i2.getPublicKey;
  var finalizeEvent2 = i2.finalizeEvent;
  var verifyEvent2 = i2.verifyEvent;

  // node_modules/@noble/ciphers/utils.js
  function isBytes2(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function abool2(b) {
    if (typeof b !== "boolean")
      throw new Error(`boolean expected, not ${b}`);
  }
  function anumber2(n) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("positive integer expected, got " + n);
  }
  function abytes2(value, length, title = "") {
    const bytes = isBytes2(value);
    const len = value?.length;
    const needsLen = length !== void 0;
    if (!bytes || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes ? `length=${len}` : `type=${typeof value}`;
      throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
    }
    return value;
  }
  function aexists2(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput2(out, instance) {
    abytes2(out, void 0, "output");
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error("digestInto() expects output buffer of length at least " + min);
    }
  }
  function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
  }
  function clean2(...arrays) {
    for (let i3 = 0; i3 < arrays.length; i3++) {
      arrays[i3].fill(0);
    }
  }
  function createView2(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
  function overlapBytes(a, b) {
    return a.buffer === b.buffer && // best we can do, may fail with an obscure Proxy
    a.byteOffset < b.byteOffset + b.byteLength && // a starts before b end
    b.byteOffset < a.byteOffset + a.byteLength;
  }
  function complexOverlapBytes(input, output) {
    if (overlapBytes(input, output) && input.byteOffset < output.byteOffset)
      throw new Error("complex overlap of input and output is not supported");
  }
  function checkOpts2(defaults, opts) {
    if (opts == null || typeof opts !== "object")
      throw new Error("options must be defined");
    const merged = Object.assign(defaults, opts);
    return merged;
  }
  function equalBytes(a, b) {
    if (a.length !== b.length)
      return false;
    let diff = 0;
    for (let i3 = 0; i3 < a.length; i3++)
      diff |= a[i3] ^ b[i3];
    return diff === 0;
  }
  var wrapCipher = /* @__NO_SIDE_EFFECTS__ */ (params, constructor) => {
    function wrappedCipher(key, ...args) {
      abytes2(key, void 0, "key");
      if (!isLE)
        throw new Error("Non little-endian hardware is not yet supported");
      if (params.nonceLength !== void 0) {
        const nonce = args[0];
        abytes2(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
      }
      const tagl = params.tagLength;
      if (tagl && args[1] !== void 0)
        abytes2(args[1], void 0, "AAD");
      const cipher = constructor(key, ...args);
      const checkOutput = (fnLength, output) => {
        if (output !== void 0) {
          if (fnLength !== 2)
            throw new Error("cipher output not supported");
          abytes2(output, void 0, "output");
        }
      };
      let called = false;
      const wrCipher = {
        encrypt(data, output) {
          if (called)
            throw new Error("cannot encrypt() twice with same key + nonce");
          called = true;
          abytes2(data);
          checkOutput(cipher.encrypt.length, output);
          return cipher.encrypt(data, output);
        },
        decrypt(data, output) {
          abytes2(data);
          if (tagl && data.length < tagl)
            throw new Error('"ciphertext" expected length bigger than tagLength=' + tagl);
          checkOutput(cipher.decrypt.length, output);
          return cipher.decrypt(data, output);
        }
      };
      return wrCipher;
    }
    Object.assign(wrappedCipher, params);
    return wrappedCipher;
  };
  function getOutput(expectedLength, out, onlyAligned = true) {
    if (out === void 0)
      return new Uint8Array(expectedLength);
    if (out.length !== expectedLength)
      throw new Error('"output" expected Uint8Array of length ' + expectedLength + ", got: " + out.length);
    if (onlyAligned && !isAligned32(out))
      throw new Error("invalid output, must be aligned");
    return out;
  }
  function u64Lengths(dataLength, aadLength, isLE2) {
    abool2(isLE2);
    const num2 = new Uint8Array(16);
    const view = createView2(num2);
    view.setBigUint64(0, BigInt(aadLength), isLE2);
    view.setBigUint64(8, BigInt(dataLength), isLE2);
    return num2;
  }
  function isAligned32(bytes) {
    return bytes.byteOffset % 4 === 0;
  }
  function copyBytes2(bytes) {
    return Uint8Array.from(bytes);
  }

  // node_modules/@noble/ciphers/_arx.js
  var encodeStr = (str) => Uint8Array.from(str.split(""), (c) => c.charCodeAt(0));
  var sigma16 = encodeStr("expand 16-byte k");
  var sigma32 = encodeStr("expand 32-byte k");
  var sigma16_32 = u32(sigma16);
  var sigma32_32 = u32(sigma32);
  function rotl2(a, b) {
    return a << b | a >>> 32 - b;
  }
  function isAligned322(b) {
    return b.byteOffset % 4 === 0;
  }
  var BLOCK_LEN = 64;
  var BLOCK_LEN32 = 16;
  var MAX_COUNTER = 2 ** 32 - 1;
  var U32_EMPTY = Uint32Array.of();
  function runCipher(core, sigma, key, nonce, data, output, counter, rounds) {
    const len = data.length;
    const block = new Uint8Array(BLOCK_LEN);
    const b32 = u32(block);
    const isAligned = isAligned322(data) && isAligned322(output);
    const d32 = isAligned ? u32(data) : U32_EMPTY;
    const o32 = isAligned ? u32(output) : U32_EMPTY;
    for (let pos = 0; pos < len; counter++) {
      core(sigma, key, nonce, b32, counter, rounds);
      if (counter >= MAX_COUNTER)
        throw new Error("arx: counter overflow");
      const take = Math.min(BLOCK_LEN, len - pos);
      if (isAligned && take === BLOCK_LEN) {
        const pos32 = pos / 4;
        if (pos % 4 !== 0)
          throw new Error("arx: invalid block position");
        for (let j = 0, posj; j < BLOCK_LEN32; j++) {
          posj = pos32 + j;
          o32[posj] = d32[posj] ^ b32[j];
        }
        pos += BLOCK_LEN;
        continue;
      }
      for (let j = 0, posj; j < take; j++) {
        posj = pos + j;
        output[posj] = data[posj] ^ block[j];
      }
      pos += take;
    }
  }
  function createCipher(core, opts) {
    const { allowShortKeys, extendNonceFn, counterLength, counterRight, rounds } = checkOpts2({ allowShortKeys: false, counterLength: 8, counterRight: false, rounds: 20 }, opts);
    if (typeof core !== "function")
      throw new Error("core must be a function");
    anumber2(counterLength);
    anumber2(rounds);
    abool2(counterRight);
    abool2(allowShortKeys);
    return (key, nonce, data, output, counter = 0) => {
      abytes2(key, void 0, "key");
      abytes2(nonce, void 0, "nonce");
      abytes2(data, void 0, "data");
      const len = data.length;
      if (output === void 0)
        output = new Uint8Array(len);
      abytes2(output, void 0, "output");
      anumber2(counter);
      if (counter < 0 || counter >= MAX_COUNTER)
        throw new Error("arx: counter overflow");
      if (output.length < len)
        throw new Error(`arx: output (${output.length}) is shorter than data (${len})`);
      const toClean = [];
      let l = key.length;
      let k;
      let sigma;
      if (l === 32) {
        toClean.push(k = copyBytes2(key));
        sigma = sigma32_32;
      } else if (l === 16 && allowShortKeys) {
        k = new Uint8Array(32);
        k.set(key);
        k.set(key, 16);
        sigma = sigma16_32;
        toClean.push(k);
      } else {
        abytes2(key, 32, "arx key");
        throw new Error("invalid key size");
      }
      if (!isAligned322(nonce))
        toClean.push(nonce = copyBytes2(nonce));
      const k32 = u32(k);
      if (extendNonceFn) {
        if (nonce.length !== 24)
          throw new Error(`arx: extended nonce must be 24 bytes`);
        extendNonceFn(sigma, k32, u32(nonce.subarray(0, 16)), k32);
        nonce = nonce.subarray(16);
      }
      const nonceNcLen = 16 - counterLength;
      if (nonceNcLen !== nonce.length)
        throw new Error(`arx: nonce must be ${nonceNcLen} or 16 bytes`);
      if (nonceNcLen !== 12) {
        const nc = new Uint8Array(12);
        nc.set(nonce, counterRight ? 0 : 12 - nonce.length);
        nonce = nc;
        toClean.push(nonce);
      }
      const n32 = u32(nonce);
      runCipher(core, sigma, k32, n32, data, output, counter, rounds);
      clean2(...toClean);
      return output;
    };
  }

  // node_modules/@noble/ciphers/_poly1305.js
  function u8to16(a, i3) {
    return a[i3++] & 255 | (a[i3++] & 255) << 8;
  }
  var Poly1305 = class {
    // Can be speed-up using BigUint64Array, at the cost of complexity
    constructor(key) {
      __publicField(this, "blockLen", 16);
      __publicField(this, "outputLen", 16);
      __publicField(this, "buffer", new Uint8Array(16));
      __publicField(this, "r", new Uint16Array(10));
      // Allocating 1 array with .subarray() here is slower than 3
      __publicField(this, "h", new Uint16Array(10));
      __publicField(this, "pad", new Uint16Array(8));
      __publicField(this, "pos", 0);
      __publicField(this, "finished", false);
      key = copyBytes2(abytes2(key, 32, "key"));
      const t0 = u8to16(key, 0);
      const t1 = u8to16(key, 2);
      const t2 = u8to16(key, 4);
      const t3 = u8to16(key, 6);
      const t4 = u8to16(key, 8);
      const t5 = u8to16(key, 10);
      const t6 = u8to16(key, 12);
      const t7 = u8to16(key, 14);
      this.r[0] = t0 & 8191;
      this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
      this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
      this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
      this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
      this.r[5] = t4 >>> 1 & 8190;
      this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
      this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
      this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
      this.r[9] = t7 >>> 5 & 127;
      for (let i3 = 0; i3 < 8; i3++)
        this.pad[i3] = u8to16(key, 16 + 2 * i3);
    }
    process(data, offset, isLast = false) {
      const hibit = isLast ? 0 : 1 << 11;
      const { h, r } = this;
      const r0 = r[0];
      const r1 = r[1];
      const r2 = r[2];
      const r3 = r[3];
      const r4 = r[4];
      const r5 = r[5];
      const r6 = r[6];
      const r7 = r[7];
      const r8 = r[8];
      const r9 = r[9];
      const t0 = u8to16(data, offset + 0);
      const t1 = u8to16(data, offset + 2);
      const t2 = u8to16(data, offset + 4);
      const t3 = u8to16(data, offset + 6);
      const t4 = u8to16(data, offset + 8);
      const t5 = u8to16(data, offset + 10);
      const t6 = u8to16(data, offset + 12);
      const t7 = u8to16(data, offset + 14);
      let h0 = h[0] + (t0 & 8191);
      let h1 = h[1] + ((t0 >>> 13 | t1 << 3) & 8191);
      let h2 = h[2] + ((t1 >>> 10 | t2 << 6) & 8191);
      let h3 = h[3] + ((t2 >>> 7 | t3 << 9) & 8191);
      let h4 = h[4] + ((t3 >>> 4 | t4 << 12) & 8191);
      let h5 = h[5] + (t4 >>> 1 & 8191);
      let h6 = h[6] + ((t4 >>> 14 | t5 << 2) & 8191);
      let h7 = h[7] + ((t5 >>> 11 | t6 << 5) & 8191);
      let h8 = h[8] + ((t6 >>> 8 | t7 << 8) & 8191);
      let h9 = h[9] + (t7 >>> 5 | hibit);
      let c = 0;
      let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
      c = d0 >>> 13;
      d0 &= 8191;
      d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
      c += d0 >>> 13;
      d0 &= 8191;
      let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
      c = d1 >>> 13;
      d1 &= 8191;
      d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
      c += d1 >>> 13;
      d1 &= 8191;
      let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
      c = d2 >>> 13;
      d2 &= 8191;
      d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
      c += d2 >>> 13;
      d2 &= 8191;
      let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
      c = d3 >>> 13;
      d3 &= 8191;
      d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
      c += d3 >>> 13;
      d3 &= 8191;
      let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
      c = d4 >>> 13;
      d4 &= 8191;
      d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
      c += d4 >>> 13;
      d4 &= 8191;
      let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
      c = d5 >>> 13;
      d5 &= 8191;
      d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
      c += d5 >>> 13;
      d5 &= 8191;
      let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
      c = d6 >>> 13;
      d6 &= 8191;
      d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
      c += d6 >>> 13;
      d6 &= 8191;
      let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
      c = d7 >>> 13;
      d7 &= 8191;
      d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
      c += d7 >>> 13;
      d7 &= 8191;
      let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
      c = d8 >>> 13;
      d8 &= 8191;
      d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
      c += d8 >>> 13;
      d8 &= 8191;
      let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
      c = d9 >>> 13;
      d9 &= 8191;
      d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
      c += d9 >>> 13;
      d9 &= 8191;
      c = (c << 2) + c | 0;
      c = c + d0 | 0;
      d0 = c & 8191;
      c = c >>> 13;
      d1 += c;
      h[0] = d0;
      h[1] = d1;
      h[2] = d2;
      h[3] = d3;
      h[4] = d4;
      h[5] = d5;
      h[6] = d6;
      h[7] = d7;
      h[8] = d8;
      h[9] = d9;
    }
    finalize() {
      const { h, pad: pad2 } = this;
      const g = new Uint16Array(10);
      let c = h[1] >>> 13;
      h[1] &= 8191;
      for (let i3 = 2; i3 < 10; i3++) {
        h[i3] += c;
        c = h[i3] >>> 13;
        h[i3] &= 8191;
      }
      h[0] += c * 5;
      c = h[0] >>> 13;
      h[0] &= 8191;
      h[1] += c;
      c = h[1] >>> 13;
      h[1] &= 8191;
      h[2] += c;
      g[0] = h[0] + 5;
      c = g[0] >>> 13;
      g[0] &= 8191;
      for (let i3 = 1; i3 < 10; i3++) {
        g[i3] = h[i3] + c;
        c = g[i3] >>> 13;
        g[i3] &= 8191;
      }
      g[9] -= 1 << 13;
      let mask = (c ^ 1) - 1;
      for (let i3 = 0; i3 < 10; i3++)
        g[i3] &= mask;
      mask = ~mask;
      for (let i3 = 0; i3 < 10; i3++)
        h[i3] = h[i3] & mask | g[i3];
      h[0] = (h[0] | h[1] << 13) & 65535;
      h[1] = (h[1] >>> 3 | h[2] << 10) & 65535;
      h[2] = (h[2] >>> 6 | h[3] << 7) & 65535;
      h[3] = (h[3] >>> 9 | h[4] << 4) & 65535;
      h[4] = (h[4] >>> 12 | h[5] << 1 | h[6] << 14) & 65535;
      h[5] = (h[6] >>> 2 | h[7] << 11) & 65535;
      h[6] = (h[7] >>> 5 | h[8] << 8) & 65535;
      h[7] = (h[8] >>> 8 | h[9] << 5) & 65535;
      let f = h[0] + pad2[0];
      h[0] = f & 65535;
      for (let i3 = 1; i3 < 8; i3++) {
        f = (h[i3] + pad2[i3] | 0) + (f >>> 16) | 0;
        h[i3] = f & 65535;
      }
      clean2(g);
    }
    update(data) {
      aexists2(this);
      abytes2(data);
      data = copyBytes2(data);
      const { buffer, blockLen } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(data, pos);
          continue;
        }
        buffer.set(data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(buffer, 0, false);
          this.pos = 0;
        }
      }
      return this;
    }
    destroy() {
      clean2(this.h, this.r, this.buffer, this.pad);
    }
    digestInto(out) {
      aexists2(this);
      aoutput2(out, this);
      this.finished = true;
      const { buffer, h } = this;
      let { pos } = this;
      if (pos) {
        buffer[pos++] = 1;
        for (; pos < 16; pos++)
          buffer[pos] = 0;
        this.process(buffer, 0, true);
      }
      this.finalize();
      let opos = 0;
      for (let i3 = 0; i3 < 8; i3++) {
        out[opos++] = h[i3] >>> 0;
        out[opos++] = h[i3] >>> 8;
      }
      return out;
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
  };
  function wrapConstructorWithKey(hashCons) {
    const hashC = (msg, key) => hashCons(key).update(msg).digest();
    const tmp = hashCons(new Uint8Array(32));
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (key) => hashCons(key);
    return hashC;
  }
  var poly1305 = /* @__PURE__ */ (() => wrapConstructorWithKey((key) => new Poly1305(key)))();

  // node_modules/@noble/ciphers/chacha.js
  function chachaCore(s, k, n, out, cnt, rounds = 20) {
    let y00 = s[0], y01 = s[1], y02 = s[2], y03 = s[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
    let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
    for (let r = 0; r < rounds; r += 2) {
      x00 = x00 + x04 | 0;
      x12 = rotl2(x12 ^ x00, 16);
      x08 = x08 + x12 | 0;
      x04 = rotl2(x04 ^ x08, 12);
      x00 = x00 + x04 | 0;
      x12 = rotl2(x12 ^ x00, 8);
      x08 = x08 + x12 | 0;
      x04 = rotl2(x04 ^ x08, 7);
      x01 = x01 + x05 | 0;
      x13 = rotl2(x13 ^ x01, 16);
      x09 = x09 + x13 | 0;
      x05 = rotl2(x05 ^ x09, 12);
      x01 = x01 + x05 | 0;
      x13 = rotl2(x13 ^ x01, 8);
      x09 = x09 + x13 | 0;
      x05 = rotl2(x05 ^ x09, 7);
      x02 = x02 + x06 | 0;
      x14 = rotl2(x14 ^ x02, 16);
      x10 = x10 + x14 | 0;
      x06 = rotl2(x06 ^ x10, 12);
      x02 = x02 + x06 | 0;
      x14 = rotl2(x14 ^ x02, 8);
      x10 = x10 + x14 | 0;
      x06 = rotl2(x06 ^ x10, 7);
      x03 = x03 + x07 | 0;
      x15 = rotl2(x15 ^ x03, 16);
      x11 = x11 + x15 | 0;
      x07 = rotl2(x07 ^ x11, 12);
      x03 = x03 + x07 | 0;
      x15 = rotl2(x15 ^ x03, 8);
      x11 = x11 + x15 | 0;
      x07 = rotl2(x07 ^ x11, 7);
      x00 = x00 + x05 | 0;
      x15 = rotl2(x15 ^ x00, 16);
      x10 = x10 + x15 | 0;
      x05 = rotl2(x05 ^ x10, 12);
      x00 = x00 + x05 | 0;
      x15 = rotl2(x15 ^ x00, 8);
      x10 = x10 + x15 | 0;
      x05 = rotl2(x05 ^ x10, 7);
      x01 = x01 + x06 | 0;
      x12 = rotl2(x12 ^ x01, 16);
      x11 = x11 + x12 | 0;
      x06 = rotl2(x06 ^ x11, 12);
      x01 = x01 + x06 | 0;
      x12 = rotl2(x12 ^ x01, 8);
      x11 = x11 + x12 | 0;
      x06 = rotl2(x06 ^ x11, 7);
      x02 = x02 + x07 | 0;
      x13 = rotl2(x13 ^ x02, 16);
      x08 = x08 + x13 | 0;
      x07 = rotl2(x07 ^ x08, 12);
      x02 = x02 + x07 | 0;
      x13 = rotl2(x13 ^ x02, 8);
      x08 = x08 + x13 | 0;
      x07 = rotl2(x07 ^ x08, 7);
      x03 = x03 + x04 | 0;
      x14 = rotl2(x14 ^ x03, 16);
      x09 = x09 + x14 | 0;
      x04 = rotl2(x04 ^ x09, 12);
      x03 = x03 + x04 | 0;
      x14 = rotl2(x14 ^ x03, 8);
      x09 = x09 + x14 | 0;
      x04 = rotl2(x04 ^ x09, 7);
    }
    let oi = 0;
    out[oi++] = y00 + x00 | 0;
    out[oi++] = y01 + x01 | 0;
    out[oi++] = y02 + x02 | 0;
    out[oi++] = y03 + x03 | 0;
    out[oi++] = y04 + x04 | 0;
    out[oi++] = y05 + x05 | 0;
    out[oi++] = y06 + x06 | 0;
    out[oi++] = y07 + x07 | 0;
    out[oi++] = y08 + x08 | 0;
    out[oi++] = y09 + x09 | 0;
    out[oi++] = y10 + x10 | 0;
    out[oi++] = y11 + x11 | 0;
    out[oi++] = y12 + x12 | 0;
    out[oi++] = y13 + x13 | 0;
    out[oi++] = y14 + x14 | 0;
    out[oi++] = y15 + x15 | 0;
  }
  function hchacha(s, k, i3, out) {
    let x00 = s[0], x01 = s[1], x02 = s[2], x03 = s[3], x04 = k[0], x05 = k[1], x06 = k[2], x07 = k[3], x08 = k[4], x09 = k[5], x10 = k[6], x11 = k[7], x12 = i3[0], x13 = i3[1], x14 = i3[2], x15 = i3[3];
    for (let r = 0; r < 20; r += 2) {
      x00 = x00 + x04 | 0;
      x12 = rotl2(x12 ^ x00, 16);
      x08 = x08 + x12 | 0;
      x04 = rotl2(x04 ^ x08, 12);
      x00 = x00 + x04 | 0;
      x12 = rotl2(x12 ^ x00, 8);
      x08 = x08 + x12 | 0;
      x04 = rotl2(x04 ^ x08, 7);
      x01 = x01 + x05 | 0;
      x13 = rotl2(x13 ^ x01, 16);
      x09 = x09 + x13 | 0;
      x05 = rotl2(x05 ^ x09, 12);
      x01 = x01 + x05 | 0;
      x13 = rotl2(x13 ^ x01, 8);
      x09 = x09 + x13 | 0;
      x05 = rotl2(x05 ^ x09, 7);
      x02 = x02 + x06 | 0;
      x14 = rotl2(x14 ^ x02, 16);
      x10 = x10 + x14 | 0;
      x06 = rotl2(x06 ^ x10, 12);
      x02 = x02 + x06 | 0;
      x14 = rotl2(x14 ^ x02, 8);
      x10 = x10 + x14 | 0;
      x06 = rotl2(x06 ^ x10, 7);
      x03 = x03 + x07 | 0;
      x15 = rotl2(x15 ^ x03, 16);
      x11 = x11 + x15 | 0;
      x07 = rotl2(x07 ^ x11, 12);
      x03 = x03 + x07 | 0;
      x15 = rotl2(x15 ^ x03, 8);
      x11 = x11 + x15 | 0;
      x07 = rotl2(x07 ^ x11, 7);
      x00 = x00 + x05 | 0;
      x15 = rotl2(x15 ^ x00, 16);
      x10 = x10 + x15 | 0;
      x05 = rotl2(x05 ^ x10, 12);
      x00 = x00 + x05 | 0;
      x15 = rotl2(x15 ^ x00, 8);
      x10 = x10 + x15 | 0;
      x05 = rotl2(x05 ^ x10, 7);
      x01 = x01 + x06 | 0;
      x12 = rotl2(x12 ^ x01, 16);
      x11 = x11 + x12 | 0;
      x06 = rotl2(x06 ^ x11, 12);
      x01 = x01 + x06 | 0;
      x12 = rotl2(x12 ^ x01, 8);
      x11 = x11 + x12 | 0;
      x06 = rotl2(x06 ^ x11, 7);
      x02 = x02 + x07 | 0;
      x13 = rotl2(x13 ^ x02, 16);
      x08 = x08 + x13 | 0;
      x07 = rotl2(x07 ^ x08, 12);
      x02 = x02 + x07 | 0;
      x13 = rotl2(x13 ^ x02, 8);
      x08 = x08 + x13 | 0;
      x07 = rotl2(x07 ^ x08, 7);
      x03 = x03 + x04 | 0;
      x14 = rotl2(x14 ^ x03, 16);
      x09 = x09 + x14 | 0;
      x04 = rotl2(x04 ^ x09, 12);
      x03 = x03 + x04 | 0;
      x14 = rotl2(x14 ^ x03, 8);
      x09 = x09 + x14 | 0;
      x04 = rotl2(x04 ^ x09, 7);
    }
    let oi = 0;
    out[oi++] = x00;
    out[oi++] = x01;
    out[oi++] = x02;
    out[oi++] = x03;
    out[oi++] = x12;
    out[oi++] = x13;
    out[oi++] = x14;
    out[oi++] = x15;
  }
  var chacha20 = /* @__PURE__ */ createCipher(chachaCore, {
    counterRight: false,
    counterLength: 4,
    allowShortKeys: false
  });
  var xchacha20 = /* @__PURE__ */ createCipher(chachaCore, {
    counterRight: false,
    counterLength: 8,
    extendNonceFn: hchacha,
    allowShortKeys: false
  });
  var ZEROS16 = /* @__PURE__ */ new Uint8Array(16);
  var updatePadded = (h, msg) => {
    h.update(msg);
    const leftover = msg.length % 16;
    if (leftover)
      h.update(ZEROS16.subarray(leftover));
  };
  var ZEROS32 = /* @__PURE__ */ new Uint8Array(32);
  function computeTag(fn, key, nonce, ciphertext, AAD) {
    if (AAD !== void 0)
      abytes2(AAD, void 0, "AAD");
    const authKey = fn(key, nonce, ZEROS32);
    const lengths = u64Lengths(ciphertext.length, AAD ? AAD.length : 0, true);
    const h = poly1305.create(authKey);
    if (AAD)
      updatePadded(h, AAD);
    updatePadded(h, ciphertext);
    h.update(lengths);
    const res = h.digest();
    clean2(authKey, lengths);
    return res;
  }
  var _poly1305_aead = (xorStream) => (key, nonce, AAD) => {
    const tagLength = 16;
    return {
      encrypt(plaintext, output) {
        const plength = plaintext.length;
        output = getOutput(plength + tagLength, output, false);
        output.set(plaintext);
        const oPlain = output.subarray(0, -tagLength);
        xorStream(key, nonce, oPlain, oPlain, 1);
        const tag = computeTag(xorStream, key, nonce, oPlain, AAD);
        output.set(tag, plength);
        clean2(tag);
        return output;
      },
      decrypt(ciphertext, output) {
        output = getOutput(ciphertext.length - tagLength, output, false);
        const data = ciphertext.subarray(0, -tagLength);
        const passedTag = ciphertext.subarray(-tagLength);
        const tag = computeTag(xorStream, key, nonce, data, AAD);
        if (!equalBytes(passedTag, tag))
          throw new Error("invalid tag");
        output.set(ciphertext.subarray(0, -tagLength));
        xorStream(key, nonce, output, output, 1);
        clean2(tag);
        return output;
      }
    };
  };
  var chacha20poly1305 = /* @__PURE__ */ wrapCipher({ blockSize: 64, nonceLength: 12, tagLength: 16 }, _poly1305_aead(chacha20));
  var xchacha20poly1305 = /* @__PURE__ */ wrapCipher({ blockSize: 64, nonceLength: 24, tagLength: 16 }, _poly1305_aead(xchacha20));

  // node_modules/@noble/hashes/hkdf.js
  function extract(hash, ikm, salt) {
    ahash(hash);
    if (salt === void 0)
      salt = new Uint8Array(hash.outputLen);
    return hmac(hash, salt, ikm);
  }
  var HKDF_COUNTER = /* @__PURE__ */ Uint8Array.of(0);
  var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
  function expand(hash, prk, info, length = 32) {
    ahash(hash);
    anumber(length, "length");
    const olen = hash.outputLen;
    if (length > 255 * olen)
      throw new Error("Length must be <= 255*HashLen");
    const blocks = Math.ceil(length / olen);
    if (info === void 0)
      info = EMPTY_BUFFER;
    else
      abytes(info, void 0, "info");
    const okm = new Uint8Array(blocks * olen);
    const HMAC = hmac.create(hash, prk);
    const HMACTmp = HMAC._cloneInto();
    const T = new Uint8Array(HMAC.outputLen);
    for (let counter = 0; counter < blocks; counter++) {
      HKDF_COUNTER[0] = counter + 1;
      HMACTmp.update(counter === 0 ? EMPTY_BUFFER : T).update(info).update(HKDF_COUNTER).digestInto(T);
      okm.set(T, olen * counter);
      HMAC._cloneInto(HMACTmp);
    }
    HMAC.destroy();
    HMACTmp.destroy();
    clean(T, HKDF_COUNTER);
    return okm.slice(0, length);
  }

  // node_modules/@scure/base/index.js
  function isBytes3(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function abytes3(b) {
    if (!isBytes3(b))
      throw new Error("Uint8Array expected");
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
      throw new Error("function expected");
    return true;
  }
  function astr(label, input) {
    if (typeof input !== "string")
      throw new Error(`${label}: string expected`);
    return true;
  }
  function anumber3(n) {
    if (!Number.isSafeInteger(n))
      throw new Error(`invalid integer: ${n}`);
  }
  function aArr(input) {
    if (!Array.isArray(input))
      throw new Error("array expected");
  }
  function astrArr(label, input) {
    if (!isArrayOf(true, input))
      throw new Error(`${label}: array of strings expected`);
  }
  function anumArr(label, input) {
    if (!isArrayOf(false, input))
      throw new Error(`${label}: array of numbers expected`);
  }
  // @__NO_SIDE_EFFECTS__
  function chain(...args) {
    const id = (a) => a;
    const wrap = (a, b) => (c) => a(b(c));
    const encode = args.map((x) => x.encode).reduceRight(wrap, id);
    const decode2 = args.map((x) => x.decode).reduce(wrap, id);
    return { encode, decode: decode2 };
  }
  // @__NO_SIDE_EFFECTS__
  function alphabet(letters) {
    const lettersA = typeof letters === "string" ? letters.split("") : letters;
    const len = lettersA.length;
    astrArr("alphabet", lettersA);
    const indexes = new Map(lettersA.map((l, i3) => [l, i3]));
    return {
      encode: (digits) => {
        aArr(digits);
        return digits.map((i3) => {
          if (!Number.isSafeInteger(i3) || i3 < 0 || i3 >= len)
            throw new Error(`alphabet.encode: digit index outside alphabet "${i3}". Allowed: ${letters}`);
          return lettersA[i3];
        });
      },
      decode: (input) => {
        aArr(input);
        return input.map((letter) => {
          astr("alphabet.decode", letter);
          const i3 = indexes.get(letter);
          if (i3 === void 0)
            throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
          return i3;
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
  // @__NO_SIDE_EFFECTS__
  function padding(bits, chr = "=") {
    anumber3(bits);
    astr("padding", chr);
    return {
      encode(data) {
        astrArr("padding.encode", data);
        while (data.length * bits % 8)
          data.push(chr);
        return data;
      },
      decode(input) {
        astrArr("padding.decode", input);
        let end = input.length;
        if (end * bits % 8)
          throw new Error("padding: invalid, string should have whole number of bytes");
        for (; end > 0 && input[end - 1] === chr; end--) {
          const last = end - 1;
          const byte = last * bits;
          if (byte % 8 === 0)
            throw new Error("padding: invalid, string has too much padding");
        }
        return input.slice(0, end);
      }
    };
  }
  function convertRadix(data, from, to) {
    if (from < 2)
      throw new Error(`convertRadix: invalid from=${from}, base cannot be less than 2`);
    if (to < 2)
      throw new Error(`convertRadix: invalid to=${to}, base cannot be less than 2`);
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
      for (let i3 = pos; i3 < dlen; i3++) {
        const digit = digits[i3];
        const fromCarry = from * carry;
        const digitBase = fromCarry + digit;
        if (!Number.isSafeInteger(digitBase) || fromCarry / from !== carry || digitBase - digit !== fromCarry) {
          throw new Error("convertRadix: carry overflow");
        }
        const div = digitBase / to;
        carry = digitBase % to;
        const rounded = Math.floor(div);
        digits[i3] = rounded;
        if (!Number.isSafeInteger(rounded) || rounded * to + carry !== digitBase)
          throw new Error("convertRadix: carry overflow");
        if (!done)
          continue;
        else if (!rounded)
          pos = i3;
        else
          done = false;
      }
      res.push(carry);
      if (done)
        break;
    }
    for (let i3 = 0; i3 < data.length - 1 && data[i3] === 0; i3++)
      res.push(0);
    return res.reverse();
  }
  var gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  var radix2carry = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd(from, to));
  var powers = /* @__PURE__ */ (() => {
    let res = [];
    for (let i3 = 0; i3 < 40; i3++)
      res.push(2 ** i3);
    return res;
  })();
  function convertRadix2(data, from, to, padding2) {
    aArr(data);
    if (from <= 0 || from > 32)
      throw new Error(`convertRadix2: wrong from=${from}`);
    if (to <= 0 || to > 32)
      throw new Error(`convertRadix2: wrong to=${to}`);
    if (/* @__PURE__ */ radix2carry(from, to) > 32) {
      throw new Error(`convertRadix2: carry overflow from=${from} to=${to} carryBits=${/* @__PURE__ */ radix2carry(from, to)}`);
    }
    let carry = 0;
    let pos = 0;
    const max = powers[from];
    const mask = powers[to] - 1;
    const res = [];
    for (const n of data) {
      anumber3(n);
      if (n >= max)
        throw new Error(`convertRadix2: invalid data word=${n} from=${from}`);
      carry = carry << from | n;
      if (pos + from > 32)
        throw new Error(`convertRadix2: carry overflow pos=${pos} from=${from}`);
      pos += from;
      for (; pos >= to; pos -= to)
        res.push((carry >> pos - to & mask) >>> 0);
      const pow = powers[pos];
      if (pow === void 0)
        throw new Error("invalid carry");
      carry &= pow - 1;
    }
    carry = carry << to - pos & mask;
    if (!padding2 && pos >= from)
      throw new Error("Excess padding");
    if (!padding2 && carry > 0)
      throw new Error(`Non-zero padding: ${carry}`);
    if (padding2 && pos > 0)
      res.push(carry >>> 0);
    return res;
  }
  // @__NO_SIDE_EFFECTS__
  function radix(num2) {
    anumber3(num2);
    const _256 = 2 ** 8;
    return {
      encode: (bytes) => {
        if (!isBytes3(bytes))
          throw new Error("radix.encode input should be Uint8Array");
        return convertRadix(Array.from(bytes), _256, num2);
      },
      decode: (digits) => {
        anumArr("radix.decode", digits);
        return Uint8Array.from(convertRadix(digits, num2, _256));
      }
    };
  }
  // @__NO_SIDE_EFFECTS__
  function radix2(bits, revPadding = false) {
    anumber3(bits);
    if (bits <= 0 || bits > 32)
      throw new Error("radix2: bits should be in (0..32]");
    if (/* @__PURE__ */ radix2carry(8, bits) > 32 || /* @__PURE__ */ radix2carry(bits, 8) > 32)
      throw new Error("radix2: carry overflow");
    return {
      encode: (bytes) => {
        if (!isBytes3(bytes))
          throw new Error("radix2.encode input should be Uint8Array");
        return convertRadix2(Array.from(bytes), 8, bits, !revPadding);
      },
      decode: (digits) => {
        anumArr("radix2.decode", digits);
        return Uint8Array.from(convertRadix2(digits, bits, 8, revPadding));
      }
    };
  }
  function unsafeWrapper(fn) {
    afn(fn);
    return function(...args) {
      try {
        return fn.apply(null, args);
      } catch (e) {
      }
    };
  }
  function checksum(len, fn) {
    anumber3(len);
    afn(fn);
    return {
      encode(data) {
        if (!isBytes3(data))
          throw new Error("checksum.encode: input should be Uint8Array");
        const sum = fn(data).slice(0, len);
        const res = new Uint8Array(data.length + len);
        res.set(data);
        res.set(sum, data.length);
        return res;
      },
      decode(data) {
        if (!isBytes3(data))
          throw new Error("checksum.decode: input should be Uint8Array");
        const payload = data.slice(0, -len);
        const oldChecksum = data.slice(-len);
        const newChecksum = fn(payload).slice(0, len);
        for (let i3 = 0; i3 < len; i3++)
          if (newChecksum[i3] !== oldChecksum[i3])
            throw new Error("Invalid checksum");
        return payload;
      }
    };
  }
  var hasBase64Builtin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toBase64 === "function" && typeof Uint8Array.fromBase64 === "function")();
  var decodeBase64Builtin = (s, isUrl) => {
    astr("base64", s);
    const re = isUrl ? /^[A-Za-z0-9=_-]+$/ : /^[A-Za-z0-9=+/]+$/;
    const alphabet2 = isUrl ? "base64url" : "base64";
    if (s.length > 0 && !re.test(s))
      throw new Error("invalid base64");
    return Uint8Array.fromBase64(s, { alphabet: alphabet2, lastChunkHandling: "strict" });
  };
  var base64 = hasBase64Builtin ? {
    encode(b) {
      abytes3(b);
      return b.toBase64();
    },
    decode(s) {
      return decodeBase64Builtin(s, false);
    }
  } : /* @__PURE__ */ chain(/* @__PURE__ */ radix2(6), /* @__PURE__ */ alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), /* @__PURE__ */ padding(6), /* @__PURE__ */ join(""));
  var genBase58 = /* @__NO_SIDE_EFFECTS__ */ (abc) => /* @__PURE__ */ chain(/* @__PURE__ */ radix(58), /* @__PURE__ */ alphabet(abc), /* @__PURE__ */ join(""));
  var base58 = /* @__PURE__ */ genBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");
  var createBase58check = (sha2562) => /* @__PURE__ */ chain(checksum(4, (data) => sha2562(sha2562(data))), base58);
  var BECH_ALPHABET = /* @__PURE__ */ chain(/* @__PURE__ */ alphabet("qpzry9x8gf2tvdw0s3jn54khce6mua7l"), /* @__PURE__ */ join(""));
  var POLYMOD_GENERATORS = [996825010, 642813549, 513874426, 1027748829, 705979059];
  function bech32Polymod(pre) {
    const b = pre >> 25;
    let chk = (pre & 33554431) << 5;
    for (let i3 = 0; i3 < POLYMOD_GENERATORS.length; i3++) {
      if ((b >> i3 & 1) === 1)
        chk ^= POLYMOD_GENERATORS[i3];
    }
    return chk;
  }
  function bechChecksum(prefix, words, encodingConst = 1) {
    const len = prefix.length;
    let chk = 1;
    for (let i3 = 0; i3 < len; i3++) {
      const c = prefix.charCodeAt(i3);
      if (c < 33 || c > 126)
        throw new Error(`Invalid prefix (${prefix})`);
      chk = bech32Polymod(chk) ^ c >> 5;
    }
    chk = bech32Polymod(chk);
    for (let i3 = 0; i3 < len; i3++)
      chk = bech32Polymod(chk) ^ prefix.charCodeAt(i3) & 31;
    for (let v of words)
      chk = bech32Polymod(chk) ^ v;
    for (let i3 = 0; i3 < 6; i3++)
      chk = bech32Polymod(chk);
    chk ^= encodingConst;
    return BECH_ALPHABET.encode(convertRadix2([chk % powers[30]], 30, 5, false));
  }
  // @__NO_SIDE_EFFECTS__
  function genBech32(encoding) {
    const ENCODING_CONST = encoding === "bech32" ? 1 : 734539939;
    const _words = /* @__PURE__ */ radix2(5);
    const fromWords = _words.decode;
    const toWords = _words.encode;
    const fromWordsUnsafe = unsafeWrapper(fromWords);
    function encode(prefix, words, limit = 90) {
      astr("bech32.encode prefix", prefix);
      if (isBytes3(words))
        words = Array.from(words);
      anumArr("bech32.encode", words);
      const plen = prefix.length;
      if (plen === 0)
        throw new TypeError(`Invalid prefix length ${plen}`);
      const actualLength = plen + 7 + words.length;
      if (limit !== false && actualLength > limit)
        throw new TypeError(`Length ${actualLength} exceeds limit ${limit}`);
      const lowered = prefix.toLowerCase();
      const sum = bechChecksum(lowered, words, ENCODING_CONST);
      return `${lowered}1${BECH_ALPHABET.encode(words)}${sum}`;
    }
    function decode2(str, limit = 90) {
      astr("bech32.decode input", str);
      const slen = str.length;
      if (slen < 8 || limit !== false && slen > limit)
        throw new TypeError(`invalid string length: ${slen} (${str}). Expected (8..${limit})`);
      const lowered = str.toLowerCase();
      if (str !== lowered && str !== str.toUpperCase())
        throw new Error(`String must be lowercase or uppercase`);
      const sepIndex = lowered.lastIndexOf("1");
      if (sepIndex === 0 || sepIndex === -1)
        throw new Error(`Letter "1" must be present between prefix and data only`);
      const prefix = lowered.slice(0, sepIndex);
      const data = lowered.slice(sepIndex + 1);
      if (data.length < 6)
        throw new Error("Data must be at least 6 characters long");
      const words = BECH_ALPHABET.decode(data).slice(0, -6);
      const sum = bechChecksum(prefix, words, ENCODING_CONST);
      if (!data.endsWith(sum))
        throw new Error(`Invalid checksum in ${str}: expected "${sum}"`);
      return { prefix, words };
    }
    const decodeUnsafe = unsafeWrapper(decode2);
    function decodeToBytes(str) {
      const { prefix, words } = decode2(str, false);
      return { prefix, words, bytes: fromWords(words) };
    }
    function encodeFromBytes(prefix, bytes) {
      return encode(prefix, toWords(bytes));
    }
    return {
      encode,
      decode: decode2,
      encodeFromBytes,
      decodeToBytes,
      decodeUnsafe,
      fromWords,
      fromWordsUnsafe,
      toWords
    };
  }
  var bech32 = /* @__PURE__ */ genBech32("bech32");

  // node_modules/nostr-tools/lib/esm/nip44.js
  var utf8Decoder3 = new TextDecoder("utf-8");
  var utf8Encoder3 = new TextEncoder();
  var minPlaintextSize = 1;
  var maxPlaintextSize = 4294967295;
  var extendedPrefixThreshold = 65536;
  function getConversationKey(privkeyA, pubkeyB) {
    const sharedX = secp256k1.getSharedSecret(privkeyA, hexToBytes("02" + pubkeyB)).subarray(1, 33);
    return extract(sha256, sharedX, utf8Encoder3.encode("nip44-v2"));
  }
  function getMessageKeys(conversationKey, nonce) {
    const keys = expand(sha256, conversationKey, nonce, 76);
    return {
      chacha_key: keys.subarray(0, 32),
      chacha_nonce: keys.subarray(32, 44),
      hmac_key: keys.subarray(44, 76)
    };
  }
  function calcPaddedLen(len) {
    if (!Number.isSafeInteger(len) || len < 1)
      throw new Error("expected positive integer");
    if (len <= 32)
      return 32;
    const nextPower = 2 ** (Math.floor(Math.log2(len - 1)) + 1);
    const chunk = nextPower <= 256 ? 32 : nextPower / 8;
    return chunk * (Math.floor((len - 1) / chunk) + 1);
  }
  function writeU16BE(num2) {
    if (!Number.isSafeInteger(num2) || num2 < minPlaintextSize || num2 > 65535)
      throw new Error("invalid plaintext size: must be between 1 and 65535 bytes");
    const arr = new Uint8Array(2);
    new DataView(arr.buffer).setUint16(0, num2, false);
    return arr;
  }
  function writeU32BE(num2) {
    if (!Number.isSafeInteger(num2) || num2 < extendedPrefixThreshold || num2 > maxPlaintextSize)
      throw new Error("invalid plaintext size: must be between 65536 and 4294967295 bytes");
    const arr = new Uint8Array(4);
    new DataView(arr.buffer).setUint32(0, num2, false);
    return arr;
  }
  function pad(plaintext) {
    const unpadded = utf8Encoder3.encode(plaintext);
    const unpaddedLen = unpadded.length;
    if (unpaddedLen < minPlaintextSize || unpaddedLen > maxPlaintextSize)
      throw new Error("invalid plaintext size: must be between 1 and 4294967295 bytes");
    const prefix = unpaddedLen >= extendedPrefixThreshold ? concatBytes(new Uint8Array([0, 0]), writeU32BE(unpaddedLen)) : writeU16BE(unpaddedLen);
    const suffix = new Uint8Array(calcPaddedLen(unpaddedLen) - unpaddedLen);
    return concatBytes(prefix, unpadded, suffix);
  }
  function unpad(padded) {
    const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
    const firstTwo = dv.getUint16(0);
    let unpaddedLen;
    let prefixLen;
    if (firstTwo === 0) {
      unpaddedLen = dv.getUint32(2);
      if (unpaddedLen < extendedPrefixThreshold)
        throw new Error("invalid padding");
      prefixLen = 6;
    } else {
      unpaddedLen = firstTwo;
      prefixLen = 2;
    }
    const unpadded = padded.subarray(prefixLen, prefixLen + unpaddedLen);
    if (unpaddedLen < minPlaintextSize || unpaddedLen > maxPlaintextSize || unpadded.length !== unpaddedLen || padded.length !== prefixLen + calcPaddedLen(unpaddedLen))
      throw new Error("invalid padding");
    return utf8Decoder3.decode(unpadded);
  }
  function hmacAad(key, message, aad) {
    if (aad.length !== 32)
      throw new Error("AAD associated data must be 32 bytes");
    const combined = concatBytes(aad, message);
    return hmac(sha256, key, combined);
  }
  function decodePayload(payload) {
    if (typeof payload !== "string")
      throw new Error("payload must be a valid string");
    const plen = payload.length;
    if (plen < 132)
      throw new Error("invalid payload length: " + plen);
    if (payload[0] === "#")
      throw new Error("unknown encryption version");
    let data;
    try {
      data = base64.decode(payload);
    } catch (error) {
      throw new Error("invalid base64: " + error.message);
    }
    const dlen = data.length;
    if (dlen < 99)
      throw new Error("invalid data length: " + dlen);
    const vers = data[0];
    if (vers !== 2)
      throw new Error("unknown encryption version " + vers);
    return {
      nonce: data.subarray(1, 33),
      ciphertext: data.subarray(33, -32),
      mac: data.subarray(-32)
    };
  }
  function encrypt(plaintext, conversationKey, nonce = randomBytes(32)) {
    const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
    const padded = pad(plaintext);
    const ciphertext = chacha20(chacha_key, chacha_nonce, padded);
    const mac = hmacAad(hmac_key, ciphertext, nonce);
    return base64.encode(concatBytes(new Uint8Array([2]), nonce, ciphertext, mac));
  }
  function decrypt(payload, conversationKey) {
    const { nonce, ciphertext, mac } = decodePayload(payload);
    const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
    const calculatedMac = hmacAad(hmac_key, ciphertext, nonce);
    if (!equalBytes(calculatedMac, mac))
      throw new Error("invalid MAC");
    const padded = chacha20(chacha_key, chacha_nonce, ciphertext);
    return unpad(padded);
  }

  // node_modules/@noble/hashes/pbkdf2.js
  function pbkdf2Init(hash, _password, _salt, _opts) {
    ahash(hash);
    const opts = checkOpts({ dkLen: 32, asyncTick: 10 }, _opts);
    const { c, dkLen, asyncTick } = opts;
    anumber(c, "c");
    anumber(dkLen, "dkLen");
    anumber(asyncTick, "asyncTick");
    if (c < 1)
      throw new Error("iterations (c) must be >= 1");
    const password = kdfInputToBytes(_password, "password");
    const salt = kdfInputToBytes(_salt, "salt");
    const DK = new Uint8Array(dkLen);
    const PRF = hmac.create(hash, password);
    const PRFSalt = PRF._cloneInto().update(salt);
    return { c, dkLen, asyncTick, DK, PRF, PRFSalt };
  }
  function pbkdf2Output(PRF, PRFSalt, DK, prfW, u) {
    PRF.destroy();
    PRFSalt.destroy();
    if (prfW)
      prfW.destroy();
    clean(u);
    return DK;
  }
  function pbkdf2(hash, password, salt, opts) {
    const { c, dkLen, DK, PRF, PRFSalt } = pbkdf2Init(hash, password, salt, opts);
    let prfW;
    const arr = new Uint8Array(4);
    const view = createView(arr);
    const u = new Uint8Array(PRF.outputLen);
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
      const Ti = DK.subarray(pos, pos + PRF.outputLen);
      view.setInt32(0, ti, false);
      (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
      Ti.set(u.subarray(0, Ti.length));
      for (let ui = 1; ui < c; ui++) {
        PRF._cloneInto(prfW).update(u).digestInto(u);
        for (let i3 = 0; i3 < Ti.length; i3++)
          Ti[i3] ^= u[i3];
      }
    }
    return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
  }

  // node_modules/nostr-tools/node_modules/@scure/bip39/index.js
  function nfkd(str) {
    if (typeof str !== "string")
      throw new TypeError("invalid mnemonic type: " + typeof str);
    return str.normalize("NFKD");
  }
  function normalize(str) {
    const norm = nfkd(str);
    const words = norm.split(" ");
    if (![12, 15, 18, 21, 24].includes(words.length))
      throw new Error("Invalid mnemonic");
    return { nfkd: norm, words };
  }
  var psalt = (passphrase) => nfkd("mnemonic" + passphrase);
  function mnemonicToSeedSync(mnemonic, passphrase = "") {
    return pbkdf2(sha512, normalize(mnemonic).nfkd, psalt(passphrase), { c: 2048, dkLen: 64 });
  }

  // node_modules/@noble/hashes/legacy.js
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
  var Id160 = /* @__PURE__ */ (() => Uint8Array.from(new Array(16).fill(0).map((_, i3) => i3)))();
  var Pi160 = /* @__PURE__ */ (() => Id160.map((i3) => (9 * i3 + 5) % 16))();
  var idxLR = /* @__PURE__ */ (() => {
    const L = [Id160];
    const R = [Pi160];
    const res = [L, R];
    for (let i3 = 0; i3 < 4; i3++)
      for (let j of res)
        j.push(j[i3].map((k) => Rho160[k]));
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
  ].map((i3) => Uint8Array.from(i3));
  var shiftsL160 = /* @__PURE__ */ idxL.map((idx, i3) => idx.map((j) => shifts160[i3][j]));
  var shiftsR160 = /* @__PURE__ */ idxR.map((idx, i3) => idx.map((j) => shifts160[i3][j]));
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
  function ripemd_f(group, x, y, z) {
    if (group === 0)
      return x ^ y ^ z;
    if (group === 1)
      return x & y | ~x & z;
    if (group === 2)
      return (x | ~y) ^ z;
    if (group === 3)
      return x & z | y & ~z;
    return x ^ (y | ~z);
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
      for (let i3 = 0; i3 < 16; i3++, offset += 4)
        BUF_160[i3] = view.getUint32(offset, true);
      let al = this.h0 | 0, ar = al, bl = this.h1 | 0, br = bl, cl = this.h2 | 0, cr = cl, dl = this.h3 | 0, dr = dl, el = this.h4 | 0, er = el;
      for (let group = 0; group < 5; group++) {
        const rGroup = 4 - group;
        const hbl = Kl160[group], hbr = Kr160[group];
        const rl = idxL[group], rr = idxR[group];
        const sl = shiftsL160[group], sr = shiftsR160[group];
        for (let i3 = 0; i3 < 16; i3++) {
          const tl = rotl(al + ripemd_f(group, bl, cl, dl) + BUF_160[rl[i3]] + hbl, sl[i3]) + el | 0;
          al = el, el = dl, dl = rotl(cl, 10) | 0, cl = bl, bl = tl;
        }
        for (let i3 = 0; i3 < 16; i3++) {
          const tr = rotl(ar + ripemd_f(rGroup, br, cr, dr) + BUF_160[rr[i3]] + hbr, sr[i3]) + er | 0;
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

  // node_modules/@scure/bip32/index.js
  var Point = secp256k1.Point;
  var { Fn } = Point;
  var base58check = createBase58check(sha256);
  var MASTER_SECRET = Uint8Array.from("Bitcoin seed".split(""), (char) => char.charCodeAt(0));
  var BITCOIN_VERSIONS = { private: 76066276, public: 76067358 };
  var HARDENED_OFFSET = 2147483648;
  var hash160 = (data) => ripemd160(sha256(data));
  var fromU32 = (data) => createView(data).getUint32(0, false);
  var toU32 = (n) => {
    if (!Number.isSafeInteger(n) || n < 0 || n > 2 ** 32 - 1) {
      throw new Error("invalid number, should be from 0 to 2**32-1, got " + n);
    }
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
      this.chainCode = opt.chainCode || null;
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
        this._privateKey = opt.privateKey;
        this._publicKey = secp256k1.getPublicKey(opt.privateKey, true);
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
        throw new Error("HDKey: seed length must be between 128 and 512 bits; 256 bits is advised, got " + seed.length);
      }
      const I = hmac(sha512, MASTER_SECRET, seed);
      const privateKey = I.slice(0, 32);
      const chainCode = I.slice(32);
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
    deriveChild(index) {
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
      const I = hmac(sha512, this.chainCode, data);
      const childTweak = I.slice(0, 32);
      const chainCode = I.slice(32);
      if (!secp256k1.utils.isValidSecretKey(childTweak)) {
        throw new Error("Tweak bigger than curve order");
      }
      const opt = {
        versions: this.versions,
        chainCode,
        depth: this.depth + 1,
        parentFingerprint: this.fingerprint,
        index
      };
      const ctweak = Fn.fromBytes(childTweak);
      try {
        if (this._privateKey) {
          const added = Fn.create(Fn.fromBytes(this._privateKey) + ctweak);
          if (!Fn.isValidNot0(added)) {
            throw new Error("The tweak was out of range or the resulted private key is invalid");
          }
          opt.privateKey = Fn.toBytes(added);
        } else {
          const added = Point.fromBytes(this._publicKey).add(Point.BASE.multiply(ctweak));
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

  // node_modules/nostr-tools/lib/esm/nip06.js
  var DERIVATION_PATH = `m/44'/1237'`;
  function privateKeyFromSeedWords(mnemonic, passphrase, accountIndex = 0) {
    let root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, passphrase));
    let privateKey = root.derive(`${DERIVATION_PATH}/${accountIndex}'/0/0`).privateKey;
    if (!privateKey)
      throw new Error("could not derive private key");
    return privateKey;
  }

  // node_modules/nostr-tools/lib/esm/nip19.js
  var utf8Decoder4 = new TextDecoder("utf-8");
  var utf8Encoder4 = new TextEncoder();
  var Bech32MaxSize = 5e3;
  function decode(code) {
    let { prefix, words } = bech32.decode(code, Bech32MaxSize);
    let data = new Uint8Array(bech32.fromWords(words));
    switch (prefix) {
      case "nprofile": {
        let tlv = parseTLV(data);
        if (!tlv[0]?.[0])
          throw new Error("missing TLV 0 for nprofile");
        if (tlv[0][0].length !== 32)
          throw new Error("TLV 0 should be 32 bytes");
        return {
          type: "nprofile",
          data: {
            pubkey: bytesToHex(tlv[0][0]),
            relays: tlv[1] ? tlv[1].map((d) => utf8Decoder4.decode(d)) : []
          }
        };
      }
      case "nevent": {
        let tlv = parseTLV(data);
        if (!tlv[0]?.[0])
          throw new Error("missing TLV 0 for nevent");
        if (tlv[0][0].length !== 32)
          throw new Error("TLV 0 should be 32 bytes");
        if (tlv[2] && tlv[2][0].length !== 32)
          throw new Error("TLV 2 should be 32 bytes");
        if (tlv[3] && tlv[3][0].length !== 4)
          throw new Error("TLV 3 should be 4 bytes");
        return {
          type: "nevent",
          data: {
            id: bytesToHex(tlv[0][0]),
            relays: tlv[1] ? tlv[1].map((d) => utf8Decoder4.decode(d)) : [],
            author: tlv[2]?.[0] ? bytesToHex(tlv[2][0]) : void 0,
            kind: tlv[3]?.[0] ? parseInt(bytesToHex(tlv[3][0]), 16) : void 0
          }
        };
      }
      case "naddr": {
        let tlv = parseTLV(data);
        if (!tlv[0]?.[0])
          throw new Error("missing TLV 0 for naddr");
        if (!tlv[2]?.[0])
          throw new Error("missing TLV 2 for naddr");
        if (tlv[2][0].length !== 32)
          throw new Error("TLV 2 should be 32 bytes");
        if (!tlv[3]?.[0])
          throw new Error("missing TLV 3 for naddr");
        if (tlv[3][0].length !== 4)
          throw new Error("TLV 3 should be 4 bytes");
        return {
          type: "naddr",
          data: {
            identifier: utf8Decoder4.decode(tlv[0][0]),
            pubkey: bytesToHex(tlv[2][0]),
            kind: parseInt(bytesToHex(tlv[3][0]), 16),
            relays: tlv[1] ? tlv[1].map((d) => utf8Decoder4.decode(d)) : []
          }
        };
      }
      case "nsec":
        return { type: prefix, data };
      case "npub":
      case "note":
        return { type: prefix, data: bytesToHex(data) };
      default:
        throw new Error(`unknown prefix ${prefix}`);
    }
  }
  function parseTLV(data) {
    let result = {};
    let rest = data;
    while (rest.length > 0) {
      let t = rest[0];
      let l = rest[1];
      let v = rest.slice(2, 2 + l);
      rest = rest.slice(2 + l);
      if (v.length < l)
        throw new Error(`not enough data to read on TLV ${t}`);
      result[t] = result[t] || [];
      result[t].push(v);
    }
    return result;
  }
  function npubEncode(hex) {
    return encodeBytes("npub", hexToBytes(hex));
  }
  function encodeBech32(prefix, data) {
    let words = bech32.toWords(data);
    return bech32.encode(prefix, words, Bech32MaxSize);
  }
  function encodeBytes(prefix, bytes) {
    return encodeBech32(prefix, bytes);
  }

  // node_modules/@noble/ciphers/aes.js
  var BLOCK_SIZE = 16;
  var POLY = 283;
  function validateKeyLength(key) {
    if (![16, 24, 32].includes(key.length))
      throw new Error('"aes key" expected Uint8Array of length 16/24/32, got length=' + key.length);
  }
  function mul2(n) {
    return n << 1 ^ POLY & -(n >> 7);
  }
  function mul(a, b) {
    let res = 0;
    for (; b > 0; b >>= 1) {
      res ^= a & -(b & 1);
      a = mul2(a);
    }
    return res;
  }
  var sbox = /* @__PURE__ */ (() => {
    const t = new Uint8Array(256);
    for (let i3 = 0, x = 1; i3 < 256; i3++, x ^= mul2(x))
      t[i3] = x;
    const box = new Uint8Array(256);
    box[0] = 99;
    for (let i3 = 0; i3 < 255; i3++) {
      let x = t[255 - i3];
      x |= x << 8;
      box[t[i3]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
    }
    clean2(t);
    return box;
  })();
  var invSbox = /* @__PURE__ */ sbox.map((_, j) => sbox.indexOf(j));
  var rotr32_8 = (n) => n << 24 | n >>> 8;
  var rotl32_8 = (n) => n << 8 | n >>> 24;
  function genTtable(sbox2, fn) {
    if (sbox2.length !== 256)
      throw new Error("Wrong sbox length");
    const T0 = new Uint32Array(256).map((_, j) => fn(sbox2[j]));
    const T1 = T0.map(rotl32_8);
    const T2 = T1.map(rotl32_8);
    const T3 = T2.map(rotl32_8);
    const T01 = new Uint32Array(256 * 256);
    const T23 = new Uint32Array(256 * 256);
    const sbox22 = new Uint16Array(256 * 256);
    for (let i3 = 0; i3 < 256; i3++) {
      for (let j = 0; j < 256; j++) {
        const idx = i3 * 256 + j;
        T01[idx] = T0[i3] ^ T1[j];
        T23[idx] = T2[i3] ^ T3[j];
        sbox22[idx] = sbox2[i3] << 8 | sbox2[j];
      }
    }
    return { sbox: sbox2, sbox2: sbox22, T0, T1, T2, T3, T01, T23 };
  }
  var tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
  var tableDecoding = /* @__PURE__ */ genTtable(invSbox, (s) => mul(s, 11) << 24 | mul(s, 13) << 16 | mul(s, 9) << 8 | mul(s, 14));
  var xPowers = /* @__PURE__ */ (() => {
    const p = new Uint8Array(16);
    for (let i3 = 0, x = 1; i3 < 16; i3++, x = mul2(x))
      p[i3] = x;
    return p;
  })();
  function expandKeyLE(key) {
    abytes2(key);
    const len = key.length;
    validateKeyLength(key);
    const { sbox2 } = tableEncoding;
    const toClean = [];
    if (!isAligned32(key))
      toClean.push(key = copyBytes2(key));
    const k32 = u32(key);
    const Nk = k32.length;
    const subByte = (n) => applySbox(sbox2, n, n, n, n);
    const xk = new Uint32Array(len + 28);
    xk.set(k32);
    for (let i3 = Nk; i3 < xk.length; i3++) {
      let t = xk[i3 - 1];
      if (i3 % Nk === 0)
        t = subByte(rotr32_8(t)) ^ xPowers[i3 / Nk - 1];
      else if (Nk > 6 && i3 % Nk === 4)
        t = subByte(t);
      xk[i3] = xk[i3 - Nk] ^ t;
    }
    clean2(...toClean);
    return xk;
  }
  function expandKeyDecLE(key) {
    const encKey = expandKeyLE(key);
    const xk = encKey.slice();
    const Nk = encKey.length;
    const { sbox2 } = tableEncoding;
    const { T0, T1, T2, T3 } = tableDecoding;
    for (let i3 = 0; i3 < Nk; i3 += 4) {
      for (let j = 0; j < 4; j++)
        xk[i3 + j] = encKey[Nk - i3 - 4 + j];
    }
    clean2(encKey);
    for (let i3 = 4; i3 < Nk - 4; i3++) {
      const x = xk[i3];
      const w = applySbox(sbox2, x, x, x, x);
      xk[i3] = T0[w & 255] ^ T1[w >>> 8 & 255] ^ T2[w >>> 16 & 255] ^ T3[w >>> 24];
    }
    return xk;
  }
  function apply0123(T01, T23, s0, s1, s2, s3) {
    return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
  }
  function applySbox(sbox2, s0, s1, s2, s3) {
    return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
  }
  function encrypt2(xk, s0, s1, s2, s3) {
    const { sbox2, T01, T23 } = tableEncoding;
    let k = 0;
    s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
    const rounds = xk.length / 4 - 2;
    for (let i3 = 0; i3 < rounds; i3++) {
      const t02 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
      const t12 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
      const t22 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
      const t32 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
      s0 = t02, s1 = t12, s2 = t22, s3 = t32;
    }
    const t0 = xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3);
    const t1 = xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0);
    const t2 = xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1);
    const t3 = xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2);
    return { s0: t0, s1: t1, s2: t2, s3: t3 };
  }
  function decrypt2(xk, s0, s1, s2, s3) {
    const { sbox2, T01, T23 } = tableDecoding;
    let k = 0;
    s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
    const rounds = xk.length / 4 - 2;
    for (let i3 = 0; i3 < rounds; i3++) {
      const t02 = xk[k++] ^ apply0123(T01, T23, s0, s3, s2, s1);
      const t12 = xk[k++] ^ apply0123(T01, T23, s1, s0, s3, s2);
      const t22 = xk[k++] ^ apply0123(T01, T23, s2, s1, s0, s3);
      const t32 = xk[k++] ^ apply0123(T01, T23, s3, s2, s1, s0);
      s0 = t02, s1 = t12, s2 = t22, s3 = t32;
    }
    const t0 = xk[k++] ^ applySbox(sbox2, s0, s3, s2, s1);
    const t1 = xk[k++] ^ applySbox(sbox2, s1, s0, s3, s2);
    const t2 = xk[k++] ^ applySbox(sbox2, s2, s1, s0, s3);
    const t3 = xk[k++] ^ applySbox(sbox2, s3, s2, s1, s0);
    return { s0: t0, s1: t1, s2: t2, s3: t3 };
  }
  function validateBlockDecrypt(data) {
    abytes2(data);
    if (data.length % BLOCK_SIZE !== 0) {
      throw new Error("aes-(cbc/ecb).decrypt ciphertext should consist of blocks with size " + BLOCK_SIZE);
    }
  }
  function validateBlockEncrypt(plaintext, pcks5, dst) {
    abytes2(plaintext);
    let outLen = plaintext.length;
    const remaining = outLen % BLOCK_SIZE;
    if (!pcks5 && remaining !== 0)
      throw new Error("aec/(cbc-ecb): unpadded plaintext with disabled padding");
    if (!isAligned32(plaintext))
      plaintext = copyBytes2(plaintext);
    const b = u32(plaintext);
    if (pcks5) {
      let left = BLOCK_SIZE - remaining;
      if (!left)
        left = BLOCK_SIZE;
      outLen = outLen + left;
    }
    dst = getOutput(outLen, dst);
    complexOverlapBytes(plaintext, dst);
    const o = u32(dst);
    return { b, o, out: dst };
  }
  function validatePCKS(data, pcks5) {
    if (!pcks5)
      return data;
    const len = data.length;
    if (!len)
      throw new Error("aes/pcks5: empty ciphertext not allowed");
    const lastByte = data[len - 1];
    if (lastByte <= 0 || lastByte > 16)
      throw new Error("aes/pcks5: wrong padding");
    const out = data.subarray(0, -lastByte);
    for (let i3 = 0; i3 < lastByte; i3++)
      if (data[len - i3 - 1] !== lastByte)
        throw new Error("aes/pcks5: wrong padding");
    return out;
  }
  function padPCKS(left) {
    const tmp = new Uint8Array(16);
    const tmp32 = u32(tmp);
    tmp.set(left);
    const paddingByte = BLOCK_SIZE - left.length;
    for (let i3 = BLOCK_SIZE - paddingByte; i3 < BLOCK_SIZE; i3++)
      tmp[i3] = paddingByte;
    return tmp32;
  }
  var cbc = /* @__PURE__ */ wrapCipher({ blockSize: 16, nonceLength: 16 }, function aescbc(key, iv, opts = {}) {
    const pcks5 = !opts.disablePadding;
    return {
      encrypt(plaintext, dst) {
        const xk = expandKeyLE(key);
        const { b, o, out: _out } = validateBlockEncrypt(plaintext, pcks5, dst);
        let _iv = iv;
        const toClean = [xk];
        if (!isAligned32(_iv))
          toClean.push(_iv = copyBytes2(_iv));
        const n32 = u32(_iv);
        let s0 = n32[0], s1 = n32[1], s2 = n32[2], s3 = n32[3];
        let i3 = 0;
        for (; i3 + 4 <= b.length; ) {
          s0 ^= b[i3 + 0], s1 ^= b[i3 + 1], s2 ^= b[i3 + 2], s3 ^= b[i3 + 3];
          ({ s0, s1, s2, s3 } = encrypt2(xk, s0, s1, s2, s3));
          o[i3++] = s0, o[i3++] = s1, o[i3++] = s2, o[i3++] = s3;
        }
        if (pcks5) {
          const tmp32 = padPCKS(plaintext.subarray(i3 * 4));
          s0 ^= tmp32[0], s1 ^= tmp32[1], s2 ^= tmp32[2], s3 ^= tmp32[3];
          ({ s0, s1, s2, s3 } = encrypt2(xk, s0, s1, s2, s3));
          o[i3++] = s0, o[i3++] = s1, o[i3++] = s2, o[i3++] = s3;
        }
        clean2(...toClean);
        return _out;
      },
      decrypt(ciphertext, dst) {
        validateBlockDecrypt(ciphertext);
        const xk = expandKeyDecLE(key);
        let _iv = iv;
        const toClean = [xk];
        if (!isAligned32(_iv))
          toClean.push(_iv = copyBytes2(_iv));
        const n32 = u32(_iv);
        dst = getOutput(ciphertext.length, dst);
        if (!isAligned32(ciphertext))
          toClean.push(ciphertext = copyBytes2(ciphertext));
        complexOverlapBytes(ciphertext, dst);
        const b = u32(ciphertext);
        const o = u32(dst);
        let s0 = n32[0], s1 = n32[1], s2 = n32[2], s3 = n32[3];
        for (let i3 = 0; i3 + 4 <= b.length; ) {
          const ps0 = s0, ps1 = s1, ps2 = s2, ps3 = s3;
          s0 = b[i3 + 0], s1 = b[i3 + 1], s2 = b[i3 + 2], s3 = b[i3 + 3];
          const { s0: o0, s1: o1, s2: o2, s3: o3 } = decrypt2(xk, s0, s1, s2, s3);
          o[i3++] = o0 ^ ps0, o[i3++] = o1 ^ ps1, o[i3++] = o2 ^ ps2, o[i3++] = o3 ^ ps3;
        }
        clean2(...toClean);
        return validatePCKS(dst, pcks5);
      }
    };
  });
  function isBytes32(a) {
    return a instanceof Uint32Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint32Array";
  }
  function encryptBlock(xk, block) {
    abytes2(block, 16, "block");
    if (!isBytes32(xk))
      throw new Error("_encryptBlock accepts result of expandKeyLE");
    const b32 = u32(block);
    let { s0, s1, s2, s3 } = encrypt2(xk, b32[0], b32[1], b32[2], b32[3]);
    b32[0] = s0, b32[1] = s1, b32[2] = s2, b32[3] = s3;
    return block;
  }
  function dbl(block) {
    let carry = 0;
    for (let i3 = BLOCK_SIZE - 1; i3 >= 0; i3--) {
      const newCarry = (block[i3] & 128) >>> 7;
      block[i3] = block[i3] << 1 | carry;
      carry = newCarry;
    }
    if (carry) {
      block[BLOCK_SIZE - 1] ^= 135;
    }
    return block;
  }
  function xorBlock(a, b) {
    if (a.length !== b.length)
      throw new Error("xorBlock: blocks must have same length");
    for (let i3 = 0; i3 < a.length; i3++) {
      a[i3] = a[i3] ^ b[i3];
    }
    return a;
  }
  var _CMAC = class {
    constructor(key) {
      __publicField(this, "buffer");
      __publicField(this, "destroyed");
      __publicField(this, "k1");
      __publicField(this, "k2");
      __publicField(this, "xk");
      abytes2(key);
      validateKeyLength(key);
      this.xk = expandKeyLE(key);
      this.buffer = new Uint8Array(0);
      this.destroyed = false;
      const L = new Uint8Array(BLOCK_SIZE);
      encryptBlock(this.xk, L);
      this.k1 = dbl(L);
      this.k2 = dbl(new Uint8Array(this.k1));
    }
    update(data) {
      const { destroyed, buffer } = this;
      if (destroyed)
        throw new Error("CMAC instance was destroyed");
      abytes2(data);
      const newBuffer = new Uint8Array(buffer.length + data.length);
      newBuffer.set(buffer);
      newBuffer.set(data, buffer.length);
      this.buffer = newBuffer;
      return this;
    }
    // see https://www.rfc-editor.org/rfc/rfc4493.html#section-2.4
    digest() {
      if (this.destroyed)
        throw new Error("CMAC instance was destroyed");
      const { buffer } = this;
      const msgLen = buffer.length;
      let n = Math.ceil(msgLen / BLOCK_SIZE);
      let flag;
      if (n === 0) {
        n = 1;
        flag = false;
      } else {
        flag = msgLen % BLOCK_SIZE === 0;
      }
      const lastBlockStart = (n - 1) * BLOCK_SIZE;
      const lastBlockData = buffer.subarray(lastBlockStart);
      let m_last;
      if (flag) {
        m_last = xorBlock(new Uint8Array(lastBlockData), this.k1);
      } else {
        const padded = new Uint8Array(BLOCK_SIZE);
        padded.set(lastBlockData);
        padded[lastBlockData.length] = 128;
        m_last = xorBlock(padded, this.k2);
      }
      let x = new Uint8Array(BLOCK_SIZE);
      for (let i3 = 0; i3 < n - 1; i3++) {
        const m_i = buffer.subarray(i3 * BLOCK_SIZE, (i3 + 1) * BLOCK_SIZE);
        xorBlock(x, m_i);
        encryptBlock(this.xk, x);
      }
      xorBlock(x, m_last);
      encryptBlock(this.xk, x);
      clean2(m_last);
      return x;
    }
    destroy() {
      const { buffer, destroyed, xk, k1, k2 } = this;
      if (destroyed)
        return;
      this.destroyed = true;
      clean2(buffer, xk, k1, k2);
    }
  };
  var cmac = (key, message) => new _CMAC(key).update(message).digest();
  cmac.create = (key) => new _CMAC(key);

  // node_modules/nostr-tools/lib/esm/nip04.js
  var utf8Decoder5 = new TextDecoder("utf-8");
  var utf8Encoder5 = new TextEncoder();
  function encrypt3(secretKey, pubkey, text) {
    const privkey = secretKey instanceof Uint8Array ? secretKey : hexToBytes(secretKey);
    const key = secp256k1.getSharedSecret(privkey, hexToBytes("02" + pubkey));
    const normalizedKey = getNormalizedX(key);
    let iv = Uint8Array.from(randomBytes(16));
    let plaintext = utf8Encoder5.encode(text);
    let ciphertext = cbc(normalizedKey, iv).encrypt(plaintext);
    let ctb64 = base64.encode(new Uint8Array(ciphertext));
    let ivb64 = base64.encode(new Uint8Array(iv.buffer));
    return `${ctb64}?iv=${ivb64}`;
  }
  function decrypt3(secretKey, pubkey, data) {
    const privkey = secretKey instanceof Uint8Array ? secretKey : hexToBytes(secretKey);
    let [ctb64, ivb64] = data.split("?iv=");
    let key = secp256k1.getSharedSecret(privkey, hexToBytes("02" + pubkey));
    let normalizedKey = getNormalizedX(key);
    let iv = base64.decode(ivb64);
    let ciphertext = base64.decode(ctb64);
    let plaintext = cbc(normalizedKey, iv).decrypt(ciphertext);
    return utf8Decoder5.decode(plaintext);
  }
  function getNormalizedX(key) {
    return key.slice(1, 33);
  }

  // src/fellowship.src.js
  function toPub(npubOrHex) {
    if (!npubOrHex) return null;
    if (/^[0-9a-f]{64}$/i.test(npubOrHex)) return npubOrHex.toLowerCase();
    try {
      const d = decode(npubOrHex);
      return d.type === "npub" ? d.data : null;
    } catch {
      return null;
    }
  }
  var GROUP_D = "trinityone/group:";
  var CATEGORY_D = "trinityone/category:";
  var GROUPKEY_D = "trinityone/groupkey:";
  var MEALS_SETTINGS_D = "trinityone/meals-settings";
  var CARE_D = "trinityone/care:";
  var CARESLOT_D = "trinityone/careslot:";
  var CARESKIP_D = "trinityone/careskip:";
  var FAMILY_KEY = "trinityone.family";
  function _loadChildren() {
    try {
      return JSON.parse(localStorage.getItem(FAMILY_KEY) || "[]") || [];
    } catch {
      return [];
    }
  }
  function _saveChildLink(link) {
    const list = _loadChildren().filter((c) => c && c.child !== link.child);
    list.push(link);
    try {
      localStorage.setItem(FAMILY_KEY, JSON.stringify(list));
    } catch {
    }
  }
  var _gkeys = {};
  var _unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)));
  function _ingestGroupKey(e) {
    const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
    if (!d.startsWith(GROUPKEY_D)) return;
    const gid = d.slice(GROUPKEY_D.length);
    try {
      const env = JSON.parse(e.content || "{}");
      const mine = env.keys && pub && env.keys[pub];
      if (mine && sk) _gkeys[gid] = _unhex(decrypt(mine, getConversationKey(sk, e.pubkey)));
      else if (!mine) delete _gkeys[gid];
    } catch {
    }
  }
  function _decEvt(e) {
    if (!e.tags || !e.tags.some((t) => t[0] === "enc")) return e;
    const gid = (e.tags.find((t) => t[0] === "t" && t[1] !== NET) || [])[1];
    const key = gid && _gkeys[gid];
    if (!key) return null;
    try {
      return { ...e, content: decrypt(e.content, key) };
    } catch {
      return null;
    }
  }
  var NET = "trinityone";
  function scheduleVisible(list) {
    const nowS = Math.floor(Date.now() / 1e3);
    return list.filter((m) => !m.draft && (!m.publishAt || m.publishAt <= nowS));
  }
  function withReconnect(makeSub) {
    const closer = makeSub();
    return () => {
      try {
        closer && closer();
      } catch {
      }
    };
  }
  function scheduleNextReveal(list, timer, emit) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const nowMs = Date.now();
    let soonest = Infinity;
    for (const m of list) {
      const t = (m.publishAt || 0) * 1e3;
      if (t > nowMs && t < soonest) soonest = t;
    }
    if (soonest === Infinity) return null;
    return setTimeout(emit, Math.min(soonest - nowMs + 250, 2147483647));
  }
  var _loc = typeof location !== "undefined" ? location : null;
  var RELAY_BASE = _loc && _loc.host ? _loc.host : "127.0.0.1:8090";
  var _native = !!(typeof window !== "undefined" && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var _staticHost = !!(_loc && _loc.host && /\.(github\.io|pages\.dev|netlify\.app)$/i.test(_loc.host));
  var _originRelay = !_native && !_staticHost && _loc && _loc.host ? (_loc.protocol === "https:" ? "wss://" : "ws://") + RELAY_BASE + "/relay" : null;
  var DEFAULT_RELAYS = _originRelay ? [_originRelay] : [];
  var CANONICAL_RELAYS = [
    "wss://app.trinityone.church/relay",
    // a8 / master-01 via Cloudflare — primary (own domain)
    "wss://trinityone-master-01.tailbeaac0.ts.net/relay"
    // same box via Tailscale Funnel — independent network path, fallback
    // dev-box relay (trinityone.tailbeaac0.ts.net) dropped 2026-06-25 on the trinityone.church go-live: not a
    // production node. NAS node removed 2026-06-17 (offline + non-enforcing). Add an always-on second box here later.
  ];
  var CANONICAL_RELAY = CANONICAL_RELAYS[0];
  function churchRelays() {
    return [.../* @__PURE__ */ new Set([...window.Fellowship.relays || [], ...CANONICAL_RELAYS])];
  }
  var RELAYS_KEY = "trinityone.relays";
  function loadRelays() {
    try {
      const r = JSON.parse(localStorage.getItem(RELAYS_KEY) || "null");
      if (Array.isArray(r) && r.length) return r;
    } catch {
    }
    return (DEFAULT_RELAYS.length ? DEFAULT_RELAYS : CANONICAL_RELAYS).slice();
  }
  var HANDLE_POOL = ["Cedar", "River", "Sparrow", "Olive", "Wren", "Maple", "Reed", "Dove", "Ash", "Linden", "Heron", "Bramble"];
  var COLORS = ["#5E8C6A", "#C2913A", "#C25A38", "#5360D6", "#1F9488", "#C24B7A"];
  function hashStr(s) {
    let h = 0;
    for (let i3 = 0; i3 < s.length; i3++) h = h * 31 + s.charCodeAt(i3) >>> 0;
    return h;
  }
  function profile(pub2) {
    const h = hashStr(pub2 || "");
    return { pubkey: pub2, handle: "Anonymous " + HANDLE_POOL[h % HANDLE_POOL.length], color: COLORS[(h >>> 8) % COLORS.length] };
  }
  var pool = new SimplePool();
  var sk = null;
  var pub = null;
  pool.automaticallyAuth = () => async (authEvent) => {
    if (!sk) {
      try {
        await window.Fellowship.ready;
      } catch {
      }
    }
    if (!sk) throw new Error("no key");
    return finalizeEvent2(authEvent, sk);
  };
  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", (e) => {
      const m = e && e.reason && (e.reason.message || String(e.reason));
      if (m && /auth[\s-]?(timed out|required|failed)|no key/i.test(m)) e.preventDefault();
    });
  }
  var profiles = {};
  var pendingProfiles = /* @__PURE__ */ new Set();
  var PROFILE_KEY = "trinityone.profile";
  var PROFILES_KEY = "trinityone.profiles";
  try {
    const c = JSON.parse(localStorage.getItem(PROFILES_KEY) || "{}");
    if (c && typeof c === "object") Object.assign(profiles, c);
  } catch {
  }
  var _profSaveT = null;
  function saveProfiles() {
    if (_profSaveT) return;
    _profSaveT = setTimeout(() => {
      _profSaveT = null;
      try {
        localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
      } catch {
      }
    }, 800);
  }
  var MEMBERS_KEY = "trinityone.members.";
  var MEMBERCOUNT_KEY = "trinityone.membercount.";
  function loadMembersCache(cp) {
    try {
      const a = JSON.parse(localStorage.getItem(MEMBERS_KEY + cp) || "[]");
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  function saveMembersCache(cp, list) {
    try {
      localStorage.setItem(MEMBERS_KEY + cp, JSON.stringify(list.slice(0, 500)));
    } catch {
    }
  }
  function loadCountCache(cp) {
    const n = parseInt(localStorage.getItem(MEMBERCOUNT_KEY + cp) || "", 10);
    return Number.isFinite(n) ? n : null;
  }
  function saveCountCache(cp, n) {
    try {
      localStorage.setItem(MEMBERCOUNT_KEY + cp, String(n));
    } catch {
    }
  }
  function loadDocCache(prefix, cp) {
    try {
      const a = JSON.parse(localStorage.getItem("trinityone." + prefix + "." + cp) || "[]");
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  function saveDocCache(prefix, cp, list) {
    try {
      localStorage.setItem("trinityone." + prefix + "." + cp, JSON.stringify(list.slice(0, 300)));
    } catch {
    }
  }
  var _churchRoster = /* @__PURE__ */ new Map();
  var _groupLeaders = /* @__PURE__ */ new Map();
  var _fireTrust = () => {
    try {
      window.dispatchEvent(new CustomEvent("trinity-church-trust"));
    } catch {
    }
  };
  function _absorbRoster(cp, d, e) {
    if (d !== "trinityone/stewards:" + cp || e.pubkey !== cp) return false;
    let pks = [];
    try {
      pks = JSON.parse(e.content).pubkeys || [];
    } catch {
    }
    _churchRoster.set(cp, new Set(pks));
    _fireTrust();
    return true;
  }
  function _churchVoice(cp, doc) {
    const by = doc && doc._by;
    return by === void 0 || by === cp || !!(_churchRoster.get(cp) && _churchRoster.get(cp).has(by));
  }
  function _noteGroupLeaders(cp, id, content, author) {
    if (author !== cp && !(_churchRoster.get(cp) && _churchRoster.get(cp).has(author))) return;
    _groupLeaders.set(id, new Set(Array.isArray(content && content.leaders) ? content.leaders : []));
    _fireTrust();
  }
  function _groupEventTrusted(cp, gid, by) {
    return by === void 0 || by === cp || !!(_churchRoster.get(cp) && _churchRoster.get(cp).has(by)) || !!(gid && _groupLeaders.get(gid) && _groupLeaders.get(gid).has(by));
  }
  var AV_SYMBOLS = ["halo", "dove", "fish", "flame", "vine", "wheat", "anchor", "crook", "chalice", "olive", "mountain", "well", "star"];
  var _noPhoto = /* @__PURE__ */ new Set();
  function _avSuppressPhoto(pubkey, av) {
    if (av && av.kind === "photo" && _noPhoto.has(pubkey)) return { kind: "symbol", color: av.color, symbol: av.symbol || AV_SYMBOLS[hashStr(pubkey || "") % AV_SYMBOLS.length] };
    return av;
  }
  function displayFor(pubkey) {
    const base = profile(pubkey);
    const p = profiles[pubkey];
    const av = _avSuppressPhoto(pubkey, p && p.av || { kind: "symbol", color: base.color, symbol: AV_SYMBOLS[hashStr(pubkey || "") % AV_SYMBOLS.length] });
    const handle = p && p.name || base.handle;
    return { pubkey, handle, name: handle, color: av.color || base.color, av, picture: p && p.picture, nip05: p && p.nip05 || "" };
  }
  async function deriveFromIdentity() {
    const mnemonic = window.TrinityIdentity ? await window.TrinityIdentity.exportMnemonic() : null;
    if (!mnemonic) throw new Error("no identity available to sign with");
    sk = privateKeyFromSeedWords(mnemonic);
    pub = getPublicKey2(sk);
    window.Fellowship.myPubkey = pub;
    try {
      window.dispatchEvent(new CustomEvent("trinity-profiles", { detail: { pubkey: pub } }));
    } catch {
    }
  }
  async function init() {
    if (window.TrinityIdentity && window.TrinityIdentity.ready) await window.TrinityIdentity.ready;
    await deriveFromIdentity();
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        profiles[pub] = p;
        window.Fellowship.myProfile = p;
      }
    } catch {
    }
  }
  window.addEventListener("trinity-identity", () => {
    deriveFromIdentity().catch(() => {
    });
  });
  window.Fellowship = {
    relays: loadRelays(),
    CANONICAL_RELAY,
    CANONICAL_RELAYS,
    myPubkey: null,
    myProfile: null,
    churchPub: null,
    // hex pubkey of the active church; messages are tagged ['p', churchPub]
    ready: null,
    profile,
    displayFor,
    // http(s) base of the church's gateway (derived from its relay) — for the /feed video proxy
    gatewayBase() {
      const r = (window.Fellowship.relays || [])[0] || "";
      try {
        const u = new URL(r);
        return (u.protocol === "wss:" ? "https:" : "http:") + "//" + u.host;
      } catch {
        return "";
      }
    },
    // resolve a church reference → npub. A bare npub / invite link returns as-is; a NIP-05 "nice name"
    // ("@yourchurch" or "name@host") is looked up via the relay's /.well-known/nostr.json
    // (served by the gateway). A bare @name is resolved against the shared relay pool (first match wins).
    async resolveChurch(input) {
      const raw = String(input || "").trim();
      const m = raw.match(/npub1[0-9a-z]{20,}/);
      if (m) return m[0];
      const nm = raw.replace(/^@/, "");
      if (!/^[a-z0-9._-]{2,}(@[a-z0-9.-]+)?$/i.test(nm)) return null;
      let name, hosts;
      if (nm.includes("@")) {
        const [n, h] = nm.split("@");
        name = n.toLowerCase();
        hosts = [h];
      } else {
        name = nm.toLowerCase();
        const urls = [.../* @__PURE__ */ new Set([...window.Fellowship.CANONICAL_RELAYS || [], ...window.Fellowship.relays || []])];
        hosts = urls.map((u) => {
          try {
            return new URL(u).host;
          } catch {
            return null;
          }
        }).filter(Boolean);
      }
      for (const host of hosts) {
        try {
          const r = await fetch("https://" + host + "/.well-known/nostr.json?name=" + encodeURIComponent(name), { mode: "cors" });
          if (!r.ok) continue;
          const j = await r.json();
          const names = j && j.names || {};
          const hex = names[name] || names[Object.keys(names).find((k) => k.toLowerCase() === name) || ""];
          if (hex && /^[0-9a-f]{64}$/i.test(hex)) {
            try {
              return npubEncode(hex);
            } catch {
              return null;
            }
          }
        } catch (e) {
        }
      }
      return null;
    },
    // scope outgoing messages to a church (so its steward can see who's participating). The member
    // app calls this with the active church's npub whenever it changes; null clears the scope.
    setChurch(npubOrHex) {
      window.Fellowship.churchPub = toPub(npubOrHex);
      return window.Fellowship.churchPub;
    },
    // NIP-98-style signed proof that we control this key, bound to a URL/endpoint — so a push
    // subscription can't be registered under another member's pubkey. Returns a signed event or null.
    async signAuth(url) {
      if (!sk) {
        try {
          await window.Fellowship.ready;
        } catch {
          return null;
        }
      }
      if (!sk) return null;
      return finalizeEvent2({
        kind: 27235,
        created_at: Math.floor(Date.now() / 1e3),
        tags: [["u", String(url || "")], ["method", "POST"]],
        content: ""
      }, sk);
    },
    // announce membership of a church (a signed, addressable presence event) so the steward can see
    // people who joined even if they never post. Idempotent (addressable, d=member:<churchPub>).
    // This makes the member's pseudonymous npub visible as a member of this church.
    async announceMembership(npubOrHex) {
      const cp = toPub(npubOrHex);
      if (!cp) return;
      if (!sk) {
        try {
          await window.Fellowship.ready;
        } catch {
          return;
        }
      }
      if (!sk) return;
      const evt = finalizeEvent2({
        kind: 30078,
        created_at: Math.floor(Date.now() / 1e3),
        tags: [["d", "trinityone/member:" + cp], ["t", NET], ["p", cp]],
        content: JSON.stringify({ joined: Math.floor(Date.now() / 1e3) })
      }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] membership publish failed", e);
      }
      return evt;
    },
    // leave a church: tombstone the membership event (they vanish from the steward's list unless they
    // have posted). Wired for when an unfollow action exists.
    async leaveMembership(npubOrHex) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(npubOrHex);
      if (!cp || !sk) return;
      const evt = finalizeEvent2({
        kind: 30078,
        created_at: Math.floor(Date.now() / 1e3),
        tags: [["d", "trinityone/member:" + cp], ["t", NET], ["p", cp], ["deleted", "1"]],
        content: ""
      }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch {
      }
      return evt;
    },
    // live count of a church's members — matches the steward's rule: distinct people (not the church)
    // who posted (kind-1) or explicitly joined (member:<church>), minus those who left without posting.
    subscribeChurchMemberCount(churchNpub, cb) {
      const cp = toPub(churchNpub);
      if (!cp) {
        cb(0);
        return () => {
        };
      }
      const MEMBER_D = "trinityone/member:";
      const ppl = /* @__PURE__ */ new Map();
      const cached = loadCountCache(cp);
      if (cached != null) cb(cached);
      const tally = () => {
        let n = 0;
        for (const v of ppl.values()) if (v.msgs > 0 || v.joined) n++;
        saveCountCache(cp, n);
        cb(n);
      };
      const makeSub = () => {
        const sub = pool.subscribeMany(churchRelays(), [{ kinds: [1], "#p": [cp] }, { kinds: [30078], "#p": [cp] }], {
          onevent(e) {
            if (e.pubkey === cp) return;
            const m = ppl.get(e.pubkey) || { msgs: 0, joined: false };
            if (e.kind === 30078) {
              const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
              if (d.indexOf(MEMBER_D) !== 0) return;
              m.joined = !(e.tags.some((t) => t[0] === "deleted") || !e.content);
            } else {
              m.msgs++;
            }
            ppl.set(e.pubkey, m);
            tally();
          },
          oneose() {
            tally();
          }
        });
        return () => {
          try {
            sub.close();
          } catch {
          }
        };
      };
      return withReconnect(makeSub);
    },
    // the church's people, for a member-facing directory: distinct folks (not the church) who joined
    // (member:<church>) or posted (kind-1 p-tagged), with their kind-0 profile resolved. Same rule the
    // steward uses. Blocked members are withheld by the relay. The UI filters out the current user.
    subscribeChurchMembers(churchNpub, onMembers) {
      const cp = toPub(churchNpub);
      if (!cp) {
        onMembers([]);
        return () => {
        };
      }
      const MEMBER_D = "trinityone/member:";
      const byPub = /* @__PURE__ */ new Map();
      let profSub = null;
      const profAuthors = /* @__PURE__ */ new Set();
      let profTimer = null;
      for (const m of loadMembersCache(cp)) {
        if (m && m.pubkey) byPub.set(m.pubkey, m);
      }
      const emit = (done) => {
        const visible = [...byPub.values()].filter((m) => !m.hidden && (m.joined || m.msgs > 0)).sort((a, b) => (b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0));
        saveMembersCache(cp, [...byPub.values()]);
        onMembers(visible, !!done);
      };
      const get = (pk) => byPub.get(pk) || { pubkey: pk, npub: npubEncode(pk), name: (profiles[pk] || {}).name || "", nip05: (profiles[pk] || {}).nip05 || "", picture: (profiles[pk] || {}).picture || "", hidden: !!(profiles[pk] || {}).hidden, joined: 0, lastTs: 0, msgs: 0 };
      const refreshProfiles = () => {
        profTimer = null;
        const authors = [...profAuthors].filter((pk) => !(profiles[pk] && profiles[pk].name));
        if (!authors.length) return;
        try {
          profSub && profSub.close();
        } catch {
        }
        profSub = pool.subscribeMany(churchRelays(), [{ kinds: [0], authors }], {
          onevent(e) {
            try {
              const meta = JSON.parse(e.content);
              profiles[e.pubkey] = { name: meta.name || meta.display_name || "", picture: meta.picture || "", about: meta.about || "", nip05: meta.nip05 || "", hidden: !!meta.hidden, av: meta.av || void 0 };
              saveProfiles();
              const m = byPub.get(e.pubkey);
              if (m) {
                m.name = profiles[e.pubkey].name;
                m.picture = profiles[e.pubkey].picture;
                m.nip05 = profiles[e.pubkey].nip05;
                m.hidden = !!meta.hidden;
              }
              emit();
            } catch {
            }
          },
          oneose() {
          }
        });
      };
      const ensureProfile = (pk) => {
        if (profAuthors.has(pk) || profiles[pk] && profiles[pk].name) return;
        profAuthors.add(pk);
        if (!profTimer) profTimer = setTimeout(refreshProfiles, 300);
      };
      const makeSub = () => {
        const sub = pool.subscribeMany(churchRelays(), [{ kinds: [1], "#p": [cp] }, { kinds: [30078], "#p": [cp] }], {
          onevent(e) {
            if (e.pubkey === cp) return;
            const m = get(e.pubkey);
            if (e.kind === 30078) {
              const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
              if (d.indexOf(MEMBER_D) !== 0) return;
              const left = e.tags.some((t) => t[0] === "deleted") || !e.content;
              if (left) m.joined = 0;
              else {
                let j = e.created_at;
                try {
                  j = JSON.parse(e.content).joined || e.created_at;
                } catch {
                }
                m.joined = j;
              }
            } else {
              m.msgs++;
              if (e.created_at > m.lastTs) m.lastTs = e.created_at;
            }
            byPub.set(e.pubkey, m);
            ensureProfile(e.pubkey);
            emit();
          },
          oneose() {
            emit(true);
          }
          // initial load complete
        });
        return () => {
          try {
            sub.close();
          } catch {
          }
        };
      };
      if (byPub.size) emit(false);
      const stop = withReconnect(makeSub);
      return () => {
        stop();
        if (profTimer) clearTimeout(profTimer);
        try {
          profSub && profSub.close();
        } catch {
        }
      };
    },
    // relay configuration (persisted) — accepts ws:// or wss:// URLs
    setRelays(urls) {
      const list = [...new Set((urls || []).map((u) => (u || "").trim()).filter((u) => /^wss?:\/\//i.test(u)))];
      window.Fellowship.relays = list.length ? list : (DEFAULT_RELAYS.length ? DEFAULT_RELAYS : CANONICAL_RELAYS).slice();
      try {
        localStorage.setItem(RELAYS_KEY, JSON.stringify(window.Fellowship.relays));
      } catch {
      }
      window.dispatchEvent(new CustomEvent("trinity-relays", { detail: window.Fellowship.relays }));
      return window.Fellowship.relays;
    },
    addRelay(url) {
      return window.Fellowship.setRelays([...window.Fellowship.relays, url]);
    },
    removeRelay(url) {
      return window.Fellowship.setRelays(window.Fellowship.relays.filter((r) => r !== url));
    },
    // publish this user's kind-0 profile (display name etc.) and cache it
    async setProfile(meta) {
      if (!sk) await window.Fellowship.ready;
      const prev = profiles[pub] || {};
      const p = {
        name: (meta.name != null ? meta.name : prev.name || "").trim(),
        about: (meta.about != null ? meta.about : prev.about || "").trim(),
        picture: (meta.picture != null ? meta.picture : prev.picture || "").trim()
      };
      if (meta.av || prev.av) p.av = meta.av || prev.av;
      const hidden = meta.hidden != null ? meta.hidden : prev.hidden;
      if (hidden) p.hidden = true;
      const handleLocal = p.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "").slice(0, 30);
      const relayHost = (CANONICAL_RELAY || "").replace(/^wss?:\/\//i, "").replace(/\/relay\/?$/i, "");
      if (handleLocal && relayHost) p.nip05 = handleLocal + "@" + relayHost;
      else if (prev.nip05) p.nip05 = prev.nip05;
      const evt = finalizeEvent2({ kind: 0, created_at: Math.floor(Date.now() / 1e3), tags: [], content: JSON.stringify(p) }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] profile publish failed", e);
      }
      profiles[pub] = p;
      window.Fellowship.myProfile = p;
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
      } catch {
      }
      window.dispatchEvent(new CustomEvent("trinity-profiles", { detail: { pubkey: pub } }));
      return evt;
    },
    // fetch kind-0 for pubkeys we haven't resolved yet; fires 'trinity-profiles' on arrival
    requestProfiles(pubkeys) {
      const need = [...new Set(pubkeys)].filter((pk) => pk && !pendingProfiles.has(pk) && (!(pk in profiles) || !(profiles[pk] && profiles[pk].name)));
      if (!need.length) return;
      need.forEach((pk) => pendingProfiles.add(pk));
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [0], authors: need }], {
        onevent(e) {
          try {
            const m = JSON.parse(e.content);
            profiles[e.pubkey] = { name: m.name || m.display_name || "", picture: m.picture || "", about: m.about || "", nip05: m.nip05 || "", hidden: !!m.hidden, av: m.av || void 0 };
            saveProfiles();
            window.dispatchEvent(new CustomEvent("trinity-profiles", { detail: { pubkey: e.pubkey } }));
          } catch {
          }
        },
        oneose() {
          need.forEach((pk) => pendingProfiles.delete(pk));
          try {
            sub.close();
          } catch {
          }
        }
      });
    },
    // publish a message to a group (kind 1, tagged with the network + group ids)
    async publishMessage(groupId, content, extraTags = []) {
      if (!sk) await window.Fellowship.ready;
      const churchTag = window.Fellowship.churchPub ? [["p", window.Fellowship.churchPub]] : [];
      let body = content, encTag = [];
      const gkey = _gkeys[groupId];
      if (gkey) {
        try {
          body = encrypt(content, gkey);
          encTag = [["enc", "1"]];
        } catch (e) {
        }
      }
      const evt = finalizeEvent2({
        kind: 1,
        created_at: Math.floor(Date.now() / 1e3),
        tags: [["t", NET], ["t", groupId], ...churchTag, ...encTag, ...extraTags],
        content: body
      }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] publish failed", e);
      }
      return evt;
    },
    // ── direct messages (1:1, encrypted) ──
    // NIP-04 encrypted kind-4: the content is private to the two parties; the relay sees only that two
    // pubkeys are talking (full metadata privacy = NIP-17, a later/Stage-6 upgrade). Peer = a hex pubkey.
    async sendDM(peerPub, content) {
      if (!sk) await window.Fellowship.ready;
      let ciphertext;
      try {
        ciphertext = await encrypt3(sk, peerPub, content);
      } catch (e) {
        console.warn("[fellowship] DM encrypt failed", e);
        return null;
      }
      const evt = finalizeEvent2({ kind: 4, created_at: Math.floor(Date.now() / 1e3), tags: [["p", peerPub]], content: ciphertext }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] DM publish failed", e);
      }
      return evt;
    },
    // a 1:1 thread with one peer; onMsg({ id, mine, content, ts, pubkey, reactions, myReaction }).
    // kind-7 reactions on either side are folded in and re-emitted against their target message.
    subscribeThread(peerPub, onMsg) {
      if (!pub) return () => {
      };
      const seen = /* @__PURE__ */ new Set();
      const msgs = /* @__PURE__ */ new Map();
      const rx = /* @__PURE__ */ new Map();
      const push = (m) => {
        const r = rx.get(m.id);
        const reactions = r ? [...r.values()].filter(Boolean) : [];
        try {
          onMsg({ ...m, reactions, myReaction: r ? r.get(pub) || "" : "" });
        } catch (err) {
        }
      };
      const deliver = async (e) => {
        if (seen.has(e.id)) return;
        seen.add(e.id);
        const mine = e.pubkey === pub;
        let content = "";
        try {
          content = await decrypt3(sk, peerPub, e.content);
        } catch (err) {
          content = "\u{1F512} (could not decrypt)";
        }
        const m = { id: e.id, mine, content, ts: e.created_at, pubkey: e.pubkey };
        msgs.set(e.id, m);
        push(m);
      };
      const deliverRx = (e) => {
        const tid = (e.tags.find((t) => t[0] === "e") || [])[1];
        if (!tid) return;
        let m = rx.get(tid);
        if (!m) {
          m = /* @__PURE__ */ new Map();
          rx.set(tid, m);
        }
        if (e.content === "-" || e.content === "") m.delete(e.pubkey);
        else m.set(e.pubkey, e.content);
        const msg = msgs.get(tid);
        if (msg) push(msg);
      };
      const sub = pool.subscribeMany(window.Fellowship.relays, [
        { kinds: [4], authors: [pub], "#p": [peerPub] },
        // sent by me to peer
        { kinds: [4], authors: [peerPub], "#p": [pub] },
        // sent by peer to me
        { kinds: [7], authors: [pub], "#p": [peerPub] },
        // my reactions to their DMs
        { kinds: [7], authors: [peerPub], "#p": [pub] }
        // their reactions to my DMs
      ], { onevent(e) {
        if (e.kind === 7) deliverRx(e);
        else deliver(e);
      }, oneose() {
      } });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // react to a DM from a peer (NIP-25 kind-7). emoji '' or '-' retracts.
    async reactDM(peerPub, msgId, emoji) {
      if (!sk) await window.Fellowship.ready;
      if (!peerPub || !msgId) return null;
      const evt = finalizeEvent2({ kind: 7, created_at: Math.floor(Date.now() / 1e3), tags: [["e", msgId], ["p", peerPub], ["t", NET], ["k", "4"]], content: emoji || "-" }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] reactDM failed", e);
      }
      return evt;
    },
    // inbox: every DM involving me, grouped by peer; onConvos([{ peer, lastTs, preview }]). Unsub fn.
    subscribeDMs(onConvos) {
      if (!pub) {
        onConvos([]);
        return () => {
        };
      }
      const byPeer = /* @__PURE__ */ new Map();
      const emit = () => onConvos([...byPeer.values()].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)));
      const handle = async (e) => {
        const peer = e.pubkey === pub ? (e.tags.find((t) => t[0] === "p") || [])[1] : e.pubkey;
        if (!peer) return;
        const prev = byPeer.get(peer);
        if (prev && prev.lastTs >= e.created_at) return;
        let preview = "";
        try {
          preview = await decrypt3(sk, peer, e.content);
        } catch (err) {
          preview = "\u{1F512}";
        }
        byPeer.set(peer, { peer, lastTs: e.created_at, preview: (e.pubkey === pub ? "You: " : "") + preview });
        emit();
      };
      const sub = pool.subscribeMany(window.Fellowship.relays, [
        { kinds: [4], authors: [pub] },
        { kinds: [4], "#p": [pub] }
      ], { onevent: handle, oneose() {
        emit();
      } });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // live connection status of each configured relay (throwaway WS probe)
    async relayStatus() {
      return Promise.all(window.Fellowship.relays.map((url) => new Promise((res) => {
        let done = false;
        const finish = (status) => {
          if (done) return;
          done = true;
          try {
            ws.close();
          } catch {
          }
          res({ url, status });
        };
        let ws;
        try {
          ws = new WebSocket(url);
        } catch {
          return res({ url, status: "off" });
        }
        const t = setTimeout(() => finish("off"), 2500);
        ws.onopen = () => {
          clearTimeout(t);
          finish("on");
        };
        ws.onerror = () => {
          clearTimeout(t);
          finish("off");
        };
      })));
    },
    // watch several groups at once (for the group-list previews/unread); onEvent(groupId, e).
    // Scoped to the active church (read live so church switches don't miss events): churches that
    // happen to share a group id (e.g. "prayer") don't cross-contaminate each other's chat.
    subscribeGroups(groupIds, onEvent) {
      const set = new Set(groupIds);
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], "#t": groupIds, limit: 500 }], {
        onevent(e) {
          const cp = window.Fellowship.churchPub;
          if (cp && !e.tags.some((t) => t[0] === "p" && t[1] === cp)) return;
          const gid = (e.tags.find((t) => t[0] === "t" && set.has(t[1])) || [])[1];
          if (gid) {
            const dec = _decEvt(e);
            if (!dec) return;
            try {
              onEvent(gid, dec);
            } catch (err) {
              console.error(err);
            }
          }
        },
        oneose() {
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // react to a message (NIP-25 kind 7). content = emoji, or '-' to retract.
    async react(groupId, targetId, targetPubkey, content) {
      if (!sk) await window.Fellowship.ready;
      const evt = finalizeEvent2({
        kind: 7,
        created_at: Math.floor(Date.now() / 1e3),
        tags: [["e", targetId], ["p", targetPubkey || ""], ["t", NET], ["t", groupId]],
        content
      }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] react failed", e);
      }
      return evt;
    },
    // live reactions in a group; onReaction({ targetId, pubkey, content, ts })
    subscribeReactions(groupId, onReaction) {
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [7], "#t": [groupId], limit: 1e3 }], {
        onevent(e) {
          const targetId = (e.tags.find((t) => t[0] === "e") || [])[1];
          if (targetId) {
            try {
              onReaction({ targetId, pubkey: e.pubkey, content: e.content, ts: e.created_at });
            } catch (err) {
              console.error(err);
            }
          }
        },
        oneose() {
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // live subscription to a group's messages; returns an unsubscribe fn
    subscribeGroup(groupId, onEvent) {
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], "#t": [groupId], limit: 200 }], {
        onevent(e) {
          if (!e.tags.some((t) => t[0] === "t" && t[1] === groupId)) return;
          const cp = window.Fellowship.churchPub;
          if (cp && !e.tags.some((t) => t[0] === "p" && t[1] === cp)) return;
          const dec = _decEvt(e);
          if (!dec) return;
          try {
            onEvent(dec);
          } catch (err) {
            console.error(err);
          }
        },
        oneose() {
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // ── moderation: pinned message + removed (hidden) messages (read-only on the member side) ──
    // Pin/hide docs are kind-30078 written by the church (steward) OR a group's leaders. The relay only
    // accepts them from the church/network or that group's leaders, so anything that arrives is trustworthy;
    // we still scope to the active church (authored by it, or p-tagged to it) to avoid cross-church bleed.
    // the current pin for a group → cb({ msgId, text, by, ts }) or cb(null) when unpinned. Unsub fn.
    subscribeGroupPin(groupId, cb) {
      if (!groupId) {
        cb(null);
        return () => {
        };
      }
      const PIN_D = "trinityone/pin:";
      let latest = 0;
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], "#d": [PIN_D + groupId] }], {
        onevent(e) {
          const cp = window.Fellowship.churchPub;
          if (cp && e.pubkey !== cp && !e.tags.some((t) => t[0] === "p" && t[1] === cp)) return;
          if (e.created_at < latest) return;
          latest = e.created_at;
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            cb(null);
            return;
          }
          try {
            cb(JSON.parse(e.content));
          } catch {
            cb(null);
          }
        },
        oneose() {
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // the set of removed message ids for the active church → cb(Set<msgId>) on change. Unsub fn.
    subscribeHidden(cb) {
      const cp = window.Fellowship.churchPub;
      if (!cp) {
        cb(/* @__PURE__ */ new Set());
        return () => {
        };
      }
      const HIDE_D = "trinityone/hidden:";
      const hidden = /* @__PURE__ */ new Map();
      const emit = () => cb(new Set([...hidden.entries()].filter(([, h]) => h).map(([id]) => id)));
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], "#p": [cp] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(HIDE_D)) return;
          if (e.pubkey !== cp && !e.tags.some((t) => t[0] === "p" && t[1] === cp)) return;
          hidden.set(d.slice(HIDE_D.length), !(e.tags.some((t) => t[0] === "deleted") || !e.content));
          emit();
        },
        oneose() {
          emit();
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // ── moderation actions a GROUP LEADER may take (signed by me, scoped to the group, p-tagged to the
    // church). The relay only accepts these from the group's leaders (or the church), like group events. ──
    async pinPost(churchNpub, groupId, msg) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !groupId || !msg || !msg.id) return null;
      const content = JSON.stringify({ msgId: msg.id, text: msg.text || "", by: msg.pubkey || msg.by || "", ts: msg._ts || msg.ts || Math.floor(Date.now() / 1e3) });
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", "trinityone/pin:" + groupId], ["t", NET], ["t", groupId], ["p", cp]], content }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] pinPost failed", e);
        return null;
      }
      return evt;
    },
    async unpin(churchNpub, groupId) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !groupId) return null;
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", "trinityone/pin:" + groupId], ["t", NET], ["t", groupId], ["p", cp], ["deleted", "1"]], content: "" }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] unpin failed", e);
        return null;
      }
      return evt;
    },
    async hideMessage(churchNpub, groupId, msgId) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !msgId) return null;
      const tags = [["d", "trinityone/hidden:" + msgId], ["t", NET], ["p", cp]];
      if (groupId) tags.push(["t", groupId]);
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags, content: JSON.stringify({ groupId: groupId || "" }) }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] hideMessage failed", e);
        return null;
      }
      return evt;
    },
    async unhideMessage(churchNpub, groupId, msgId) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !msgId) return null;
      const tags = [["d", "trinityone/hidden:" + msgId], ["t", NET], ["p", cp], ["deleted", "1"]];
      if (groupId) tags.push(["t", groupId]);
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags, content: "" }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] unhideMessage failed", e);
        return null;
      }
      return evt;
    },
    // ── read a church's published GROUP definitions (kind 30078, by the steward console) ──
    // onGroups([{id,name,kind,sub}]) fires on change; returns an unsubscribe fn.
    subscribeChurchGroups(churchNpub, onGroups) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        onGroups([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      for (const g of loadDocCache("groups", pubk)) {
        if (g && g.id) byId.set(g.id, g);
      }
      const emit = () => {
        const v = [...byId.values()].filter((g) => _churchVoice(pubk, g));
        saveDocCache("groups", pubk, v);
        onGroups(v.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0)));
      };
      const makeSub = () => {
        const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (_absorbRoster(pubk, d, e)) {
              emit();
              return;
            }
            if (d.startsWith(GROUPKEY_D)) {
              _ingestGroupKey(e);
              return;
            }
            if (!d.startsWith(GROUP_D)) return;
            const id = d.slice(GROUP_D.length);
            if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
              byId.delete(id);
              emit();
              return;
            }
            try {
              const c = JSON.parse(e.content);
              byId.set(id, { id, ...c, ts: e.created_at, _by: e.pubkey });
              _noteGroupLeaders(pubk, id, c, e.pubkey);
              emit();
            } catch {
            }
          },
          oneose() {
            emit();
          }
        });
        return () => {
          try {
            sub.close();
          } catch {
          }
        };
      };
      if (byId.size) emit();
      return withReconnect(makeSub);
    },
    // ── read the church's group categories (named containers, kind-30078) ──
    // onCats([{ id, name, order, ts }]) sorted by the steward's order. Members section the group list by these.
    subscribeChurchCategories(churchNpub, onCats) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        onCats([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      for (const c of loadDocCache("categories", pubk)) {
        if (c && c.id) byId.set(c.id, c);
      }
      const emit = () => {
        const v = [...byId.values()].filter((c) => _churchVoice(pubk, c));
        saveDocCache("categories", pubk, v);
        onCats(v.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0)));
      };
      const makeSub = () => {
        const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (!d.startsWith(CATEGORY_D)) return;
            const id = d.slice(CATEGORY_D.length);
            if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
              byId.delete(id);
              emit();
              return;
            }
            try {
              const c = JSON.parse(e.content);
              byId.set(id, { id, ...c, ts: e.created_at, _by: e.pubkey });
              emit();
            } catch {
            }
          },
          oneose() {
            emit();
          }
        });
        return () => {
          try {
            sub.close();
          } catch {
          }
        };
      };
      if (byId.size) emit();
      return withReconnect(makeSub);
    },
    // ── safeguarding: read the church's minors + approved-adults lists (kind-30078) ──
    // onLists({ minors:[…], approved:[…], isMinor:bool }) — isMinor reflects THIS member's pubkey. The
    // member app uses it to show a child only child-safe groups and to hide/disable disallowed DMs. The
    // real enforcement is on the relay (gateway accept/canRead); this is the client-side experience.
    subscribeChurchSafeguard(churchNpub, onLists) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        _noPhoto = /* @__PURE__ */ new Set();
        onLists({ minors: [], approved: [], guardians: {}, nophoto: [], isMinor: false });
        return () => {
        };
      }
      let minors = [], approved = [], guardians = {}, nophoto = [];
      const me = window.Fellowship.myPubkey || pub;
      const emit = () => {
        _noPhoto = new Set(nophoto);
        onLists({ minors, approved, guardians, nophoto, isMinor: !!(me && minors.includes(me)), photoBlocked: !!(me && nophoto.includes(me)) });
      };
      const makeSub = () => {
        const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
          onevent(e) {
            if (e.pubkey !== pubk) return;
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (d === "trinityone/minors:" + pubk) {
              try {
                minors = JSON.parse(e.content).pubkeys || [];
              } catch {
                minors = [];
              }
              emit();
            } else if (d === "trinityone/approved:" + pubk) {
              try {
                approved = JSON.parse(e.content).pubkeys || [];
              } catch {
                approved = [];
              }
              emit();
            } else if (d === "trinityone/guardians:" + pubk) {
              try {
                guardians = JSON.parse(e.content).links || {};
              } catch {
                guardians = {};
              }
              emit();
            } else if (d === "trinityone/nophoto:" + pubk) {
              try {
                nophoto = JSON.parse(e.content).pubkeys || [];
              } catch {
                nophoto = [];
              }
              emit();
            }
          },
          oneose() {
            emit();
          }
        });
        return () => {
          try {
            sub.close();
          } catch {
          }
        };
      };
      return withReconnect(makeSub);
    },
    // ── safeguarding v2: a parent creates a child account they own (mints a fresh key, sets the child up
    // in the church, and asks the steward to confirm the link). Returns { childPub, mnemonic, npub, name }
    // so the UI can show the child's recovery words + a one-scan login QR (handoff to the child's device).
    // The mnemonic is NOT persisted (paper stays foundational) — the parent saves it at creation. ──
    async createChildAccount(churchNpub, childName) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !sk) throw new Error("Join a church first.");
      const name = String(childName || "").trim();
      if (!name) throw new Error("Enter the child\u2019s name.");
      const inv = window.TrinityIdentity.makeInvite();
      const childSk = privateKeyFromSeedWords(inv.mnemonic);
      const childPub = getPublicKey2(childSk);
      const ts = Math.floor(Date.now() / 1e3);
      const handleLocal = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "").slice(0, 30);
      const relayHost = (CANONICAL_RELAY || "").replace(/^wss?:\/\//i, "").replace(/\/relay\/?$/i, "");
      const childProfile = { name };
      if (handleLocal && relayHost) childProfile.nip05 = handleLocal + "@" + relayHost;
      const k0 = finalizeEvent2({ kind: 0, created_at: ts, tags: [], content: JSON.stringify(childProfile) }, childSk);
      const join2 = finalizeEvent2({ kind: 30078, created_at: ts, tags: [["d", "trinityone/member:" + cp], ["t", NET], ["p", cp]], content: JSON.stringify({ joined: ts }) }, childSk);
      const myName = window.Fellowship.myProfile && window.Fellowship.myProfile.name || "";
      const req = finalizeEvent2({ kind: 30078, created_at: ts, tags: [["d", "trinityone/guardreq:" + childPub], ["t", NET], ["p", cp], ["p", childPub]], content: JSON.stringify({ child: childPub, parent: pub, parentName: myName, childName: name }) }, sk);
      for (const e of [k0, join2, req]) {
        try {
          await Promise.any(pool.publish(window.Fellowship.relays, e));
        } catch (err) {
          console.warn("[fellowship] child setup publish failed", err);
        }
      }
      _saveChildLink({ child: childPub, name, churchPub: cp, ts });
      return { childPub, mnemonic: inv.mnemonic, npub: npubEncode(childPub), name };
    },
    // the children this parent has set up (local record; no secrets) — [{ child, name, churchPub, ts }]
    myChildren(churchNpub) {
      const list = _loadChildren();
      if (!churchNpub) return list;
      const cp = toPub(churchNpub);
      return cp ? list.filter((c) => c.churchPub === cp) : list;
    },
    // ── joining: read whether a church gates joining behind steward approval, and where I stand ──
    // onState({ approval, isAdmitted, isPending }). isPending = the church requires approval and I'm not
    // on its admitted list yet (the relay withholds my posting until the steward approves me).
    subscribeChurchJoin(churchNpub, onState) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        onState({ approval: false, isAdmitted: true, isPending: false });
        return () => {
        };
      }
      let approval = false, admitted = [];
      const me = window.Fellowship.myPubkey || pub;
      const emit = () => {
        const isAdmitted = !!(me && admitted.includes(me));
        onState({ approval, isAdmitted, isPending: approval && !isAdmitted });
      };
      const makeSub = () => {
        const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (_absorbRoster(pubk, d, e)) {
              emit();
              return;
            }
            if (e.pubkey !== pubk && !(_churchRoster.get(pubk) && _churchRoster.get(pubk).has(e.pubkey))) return;
            if (d === "trinityone/joinpolicy:" + pubk) {
              if (e.tags.some((t) => t[0] === "deleted") || !e.content) approval = false;
              else {
                try {
                  approval = !!JSON.parse(e.content).approval;
                } catch {
                  approval = false;
                }
              }
              emit();
            } else if (d === "trinityone/admitted:" + pubk) {
              try {
                admitted = JSON.parse(e.content).pubkeys || [];
              } catch {
                admitted = [];
              }
              emit();
            }
          },
          oneose() {
            emit();
          }
        });
        return () => {
          try {
            sub.close();
          } catch {
          }
        };
      };
      return withReconnect(makeSub);
    },
    // ── read the reading plans a church shares (kind-30078, d=plan:) ──
    subscribeChurchPlans(churchNpub, onPlans) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        onPlans([]);
        return () => {
        };
      }
      const PLAN_D = "trinityone/plan:";
      const byId = /* @__PURE__ */ new Map();
      for (const p of loadDocCache("plans", pubk)) {
        if (p && p.id) byId.set(p.id, p);
      }
      let timer = null;
      const emit = () => {
        const all = [...byId.values()].filter((x) => _churchVoice(pubk, x));
        saveDocCache("plans", pubk, all);
        onPlans(scheduleVisible(all).sort((a, b) => (a.ts || 0) - (b.ts || 0)));
        timer = scheduleNextReveal(all, timer, emit);
      };
      const makeSub = () => {
        const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (_absorbRoster(pubk, d, e)) {
              emit();
              return;
            }
            if (!d.startsWith(PLAN_D)) return;
            const id = d.slice(PLAN_D.length);
            if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
              byId.delete(id);
              emit();
              return;
            }
            try {
              byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at, _by: e.pubkey });
              emit();
            } catch {
            }
          },
          oneose() {
            emit();
          }
        });
        return () => {
          try {
            sub.close();
          } catch {
          }
        };
      };
      if (byId.size) emit();
      const stop = withReconnect(makeSub);
      return () => {
        stop();
        if (timer) clearTimeout(timer);
      };
    },
    // ── read the devotionals a church shares (kind-30078, d=devotional:) — full content for rendering ──
    subscribeChurchDevotionals(churchNpub, onDevos) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        onDevos([]);
        return () => {
        };
      }
      const DEVO_D = "trinityone/devotional:";
      const byId = /* @__PURE__ */ new Map();
      for (const dv of loadDocCache("devos", pubk)) {
        if (dv && dv.id) byId.set(dv.id, dv);
      }
      const ord = (d) => typeof d.order === "number" ? d.order : Infinity;
      let timer = null;
      const emit = () => {
        const all = [...byId.values()].filter((x) => _churchVoice(pubk, x));
        saveDocCache("devos", pubk, all);
        onDevos(scheduleVisible(all).sort((a, b) => ord(a) - ord(b) || (b.ts || 0) - (a.ts || 0)));
        timer = scheduleNextReveal(all, timer, emit);
      };
      const makeSub = () => {
        const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
          onevent(e) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (_absorbRoster(pubk, d, e)) {
              emit();
              return;
            }
            if (!d.startsWith(DEVO_D)) return;
            const id = d.slice(DEVO_D.length);
            if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
              byId.delete(id);
              emit();
              return;
            }
            try {
              byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at, _by: e.pubkey });
              emit();
            } catch {
            }
          },
          oneose() {
            emit();
          }
        });
        return () => {
          try {
            sub.close();
          } catch {
          }
        };
      };
      if (byId.size) emit();
      const stop = withReconnect(makeSub);
      return () => {
        stop();
        if (timer) clearTimeout(timer);
      };
    },
    // ── generic reader for the church's own addressable docs with a given d-prefix ──
    _subChurchAddr(churchNpub, prefix, map, onItems) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        onItems([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onItems([...byId.values()].filter((x) => _churchVoice(pubk, x)).sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (_absorbRoster(pubk, d, e)) {
            emit();
            return;
          }
          if (!d.startsWith(prefix)) return;
          const id = d.slice(prefix.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            byId.set(id, { id, ...map(JSON.parse(e.content), id), ts: e.created_at, _by: e.pubkey });
            emit();
          } catch {
          }
        },
        oneose() {
          emit();
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // ── serving: services, per-service rotas, rosters, events the church publishes ──
    subscribeChurchServices(churchNpub, cb) {
      return window.Fellowship._subChurchAddr(churchNpub, "trinityone/service:", (c, id) => ({ id, date: c.date, time: c.time, name: c.name }), cb);
    },
    subscribeChurchRunsheets(churchNpub, cb) {
      return window.Fellowship._subChurchAddr(churchNpub, "trinityone/runsheet:", (c, id) => ({ service: id, items: Array.isArray(c.items) ? c.items : [] }), cb);
    },
    subscribeChurchRotas(churchNpub, cb) {
      return window.Fellowship._subChurchAddr(churchNpub, "trinityone/rota:", (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), cb);
    },
    subscribeChurchRosters(churchNpub, cb) {
      return window.Fellowship._subChurchAddr(churchNpub, "trinityone/roster:", (c, id) => ({ team: id, roles: c.roles || [], people: c.people || [] }), cb);
    },
    subscribeChurchEvents(churchNpub, cb) {
      return window.Fellowship._subChurchAddr(churchNpub, "trinityone/event:", (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || "", groupId: c.groupId || "" }), cb);
    },
    // ── Meal trains / Care module (member side) ──
    // Read the church's Care config so the member app knows whether to show the Care card (and, for
    // 'team' visibility, that the church chose to keep needs to the care team). Church-signed → church-voice.
    subscribeMealsSettings(churchNpub, cb) {
      const pubk = toPub(churchNpub);
      const OFF = { enabled: false, visibility: "all", openedBy: "steward", adminGroupId: "" };
      if (!pubk) {
        cb({ ...OFF });
        return () => {
        };
      }
      let best = { ts: 0, doc: { ...OFF } };
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (_absorbRoster(pubk, d, e)) return;
          if (d !== MEALS_SETTINGS_D || !_churchVoice(pubk, { _by: e.pubkey })) return;
          if ((e.created_at || 0) <= best.ts) return;
          try {
            const c = JSON.parse(e.content || "{}");
            best = { ts: e.created_at || 0, doc: { enabled: !!c.enabled, visibility: c.visibility === "team" ? "team" : "all", openedBy: c.openedBy === "member" ? "member" : "steward", adminGroupId: String(c.adminGroupId || "") } };
            cb({ ...best.doc });
          } catch {
          }
        },
        oneose() {
          cb({ ...best.doc });
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // Open care needs. Authored by the church, a steward, or a care-team admin — all relay-enforced, so a
    // need present on the church's relay was written by an authorised pubkey. cb([{ id, displayLabel, type,
    // startDate, endDate, recipient, notes, ts }]).
    subscribeCareNeeds(churchNpub, cb) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        cb([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      const emit = () => cb([...byId.values()].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "") || (a.ts || 0) - (b.ts || 0)));
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pubk], "#t": [NET] }, { kinds: [30078], "#church": [pubk], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (_absorbRoster(pubk, d, e)) {
            emit();
            return;
          }
          if (!d.startsWith(CARE_D)) return;
          const tagged = (e.tags.find((t) => t[0] === "church") || [])[1];
          if (!_churchVoice(pubk, { _by: e.pubkey }) && toPub(tagged) !== pubk) return;
          const id = d.slice(CARE_D.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            const c = JSON.parse(e.content);
            byId.set(id, { id, displayLabel: c.displayLabel || "", type: c.type || "meals", startDate: c.startDate || "", endDate: c.endDate || "", recipient: (c.recipient || "").toLowerCase(), notes: c.notes || "", ts: e.created_at });
            emit();
          } catch {
          }
        },
        oneose() {
          emit();
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // member offers to help (careslot:) + recipient skip-days (careskip:) — both member-signed, church-tagged.
    // Keyed needId|iso|pubkey so each member's fill for a (need,date) is one entry. No church-voice filter:
    // these are members' own events, not church content.
    _subCareTagged(churchNpub, prefix, map, cb) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        cb([]);
        return () => {
        };
      }
      const byKey = /* @__PURE__ */ new Map();
      const emit = () => cb([...byKey.values()]);
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], "#church": [pubk], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(prefix)) return;
          const rest = d.slice(prefix.length).split(":");
          const needId = rest[0] || "", isoDate = rest[1] || "";
          if (!needId || !isoDate) return;
          const key = needId + "|" + isoDate + "|" + e.pubkey;
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byKey.delete(key);
            emit();
            return;
          }
          try {
            byKey.set(key, { needId, isoDate, pubkey: e.pubkey, ts: e.created_at, ...map(JSON.parse(e.content || "{}")) });
            emit();
          } catch {
          }
        },
        oneose() {
          emit();
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    subscribeCareSlots(churchNpub, cb) {
      return window.Fellowship._subCareTagged(churchNpub, CARESLOT_D, (o) => ({ note: String(o.note || "").trim() }), cb);
    },
    subscribeCareSkips(churchNpub, cb) {
      return window.Fellowship._subCareTagged(churchNpub, CARESKIP_D, (o) => ({ reason: String(o.reason || "").trim() }), cb);
    },
    // sign up to bring a meal / give a ride on one date of a need (idempotent per member+need+date).
    async fillCareSlot(careId, iso, note) {
      const cp = window.Fellowship.churchPub;
      if (!sk) {
        try {
          await window.Fellowship.ready;
        } catch {
        }
      }
      if (!sk || !cp || !careId || !iso) return null;
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", CARESLOT_D + careId + ":" + iso], ["t", NET], ["church", cp]], content: JSON.stringify({ careId, isoDate: iso, note: String(note || "").trim() }) }, sk);
      try {
        await Promise.any(pool.publish(churchRelays(), evt));
      } catch (e) {
        console.warn("[fellowship] care slot publish failed", e);
      }
      return evt;
    },
    async clearCareSlot(careId, iso) {
      const cp = window.Fellowship.churchPub;
      if (!sk) {
        try {
          await window.Fellowship.ready;
        } catch {
        }
      }
      if (!sk || !cp || !careId || !iso) return null;
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", CARESLOT_D + careId + ":" + iso], ["t", NET], ["church", cp], ["deleted", "1"]], content: "" }, sk);
      try {
        await Promise.any(pool.publish(churchRelays(), evt));
      } catch {
      }
      return evt;
    },
    // the RECIPIENT marks a day they don't need help (relay rejects this from anyone but the recipient).
    async markCareSkip(careId, iso, reason) {
      const cp = window.Fellowship.churchPub;
      if (!sk) {
        try {
          await window.Fellowship.ready;
        } catch {
        }
      }
      if (!sk || !cp || !careId || !iso) return null;
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", CARESKIP_D + careId + ":" + iso], ["t", NET], ["church", cp]], content: JSON.stringify({ careId, isoDate: iso, reason: String(reason || "").trim() }) }, sk);
      try {
        await Promise.any(pool.publish(churchRelays(), evt));
      } catch (e) {
        console.warn("[fellowship] care skip publish failed", e);
      }
      return evt;
    },
    async clearCareSkip(careId, iso) {
      const cp = window.Fellowship.churchPub;
      if (!sk) {
        try {
          await window.Fellowship.ready;
        } catch {
        }
      }
      if (!sk || !cp || !careId || !iso) return null;
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", CARESKIP_D + careId + ":" + iso], ["t", NET], ["church", cp], ["deleted", "1"]], content: "" }, sk);
      try {
        await Promise.any(pool.publish(churchRelays(), evt));
      } catch {
      }
      return evt;
    },
    // events posted by a GROUP'S leaders (members the church empowered) — authored by the member, scoped to
    // a group. Client-verified (M2): we only show events from the church, a current roster steward, or an
    // empowered leader of that group (per the trusted group def). onEvents([{ id, ...fields, byMember }]).
    subscribeGroupEvents(churchNpub, groupIds, onEvents) {
      const cp = toPub(churchNpub);
      const groups = (groupIds || []).filter(Boolean);
      if (!cp || !groups.length) {
        onEvents([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onEvents([...byId.values()].filter((x) => _groupEventTrusted(cp, x._gid, x._by)).sort((a, b) => (a.date || "").localeCompare(b.date || "")));
      const onTrust = () => emit();
      window.addEventListener("trinity-church-trust", onTrust);
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], "#t": groups }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith("trinityone/event:")) return;
          const gid = (e.tags.find((t) => t[0] === "t" && groups.includes(t[1])) || [])[1] || "";
          const id = d.slice("trinityone/event:".length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            const c = JSON.parse(e.content);
            byId.set(id, { id, date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent, image: c.image || "", groupId: c.groupId || "", byMember: e.pubkey !== cp, ts: e.created_at, _by: e.pubkey, _gid: gid });
            emit();
          } catch {
          }
        },
        oneose() {
          emit();
        }
      });
      return () => {
        window.removeEventListener("trinity-church-trust", onTrust);
        try {
          sub.close();
        } catch {
        }
      };
    },
    // a group leader posts an event for their group: signed by ME, scoped to the group, p-tagged to the church.
    async publishGroupEvent(churchNpub, groupId, ev) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !groupId) return null;
      const id = ev.id || "evt" + Date.now() + Math.random().toString(36).slice(2, 6);
      const content = JSON.stringify({ date: ev.date || "", time: ev.time || "", title: ev.title || "Event", where: ev.where || "", blurb: ev.blurb || "", accent: ev.accent || "var(--clay)", image: ev.image || "", groupId });
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", "trinityone/event:" + id], ["t", NET], ["t", groupId], ["p", cp]], content }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch (e) {
        console.warn("[fellowship] publishGroupEvent failed", e);
        return null;
      }
      return { id, ...JSON.parse(content) };
    },
    // the wider networks/groups-of-churches this church belongs to (it publishes network:<networkPub>)
    subscribeChurchNetworks(churchNpub, cb) {
      return window.Fellowship._subChurchAddr(churchNpub, "trinityone/network:", (c, id) => ({ networkPub: id, npub: (() => {
        try {
          return npubEncode(id);
        } catch {
          return "";
        }
      })() }), cb);
    },
    // a network's broadcast announcements (kind-1 authored by the network, tagged net-announce); newest first
    subscribeNetworkAnnouncements(networkNpub, onPosts) {
      const pubk = toPub(networkNpub);
      if (!pubk) {
        onPosts([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onPosts([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [1], authors: [pubk], "#t": ["net-announce"] }], {
        onevent(e) {
          byId.set(e.id, { id: e.id, text: e.content, ts: e.created_at, networkPub: pubk });
          emit();
        },
        oneose() {
          emit();
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // ── serving requests the church p-tagged to ME ("can you serve?") ──
    subscribeMyServingRequests(onReqs) {
      const me = window.Fellowship.myPubkey;
      if (!me) {
        onReqs([]);
        return () => {
        };
      }
      const REQUEST_D = "trinityone/request:";
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onReqs([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], "#p": [me], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(REQUEST_D)) return;
          const id = d.slice(REQUEST_D.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            byId.set(id, { id, church: e.pubkey, ...JSON.parse(e.content), ts: e.created_at });
            emit();
          } catch {
          }
        },
        oneose() {
          emit();
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // member -> church: reply to a serving request (accept/decline/swap) — p-tagged to the church
    async respondToServingRequest(churchNpub, requestId, verdict, swapTo) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !sk) return;
      const content = JSON.stringify({ request: requestId, v: verdict, swapTo: swapTo || "" });
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", "trinityone/reqreply:" + requestId], ["t", NET], ["p", cp]], content }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch {
      }
      return evt;
    },
    // my replies to serving requests (own reqreply docs) -> { requestId: verdict }
    subscribeMyReqReplies(onReplies) {
      const me = window.Fellowship.myPubkey;
      if (!me) {
        onReplies({});
        return () => {
        };
      }
      const RR = "trinityone/reqreply:";
      const byReq = {};
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [me], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(RR)) return;
          try {
            byReq[d.slice(RR.length)] = JSON.parse(e.content).v;
            onReplies({ ...byReq });
          } catch {
          }
        },
        oneose() {
          onReplies({ ...byReq });
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // member RSVP to a calendar event — one addressable doc per (member,event), p-tagged to church
    async setEventRsvp(churchNpub, eventId, verdict) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !sk) return;
      const content = JSON.stringify({ event: eventId, v: verdict });
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", "trinityone/rsvp:" + eventId], ["t", NET], ["p", cp]], content }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch {
      }
      return evt;
    },
    subscribeMyRsvps(onRsvps) {
      const me = window.Fellowship.myPubkey;
      if (!me) {
        onRsvps({});
        return () => {
        };
      }
      const RSVP_D = "trinityone/rsvp:";
      const byEvent = {};
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [30078], authors: [me], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(RSVP_D)) return;
          try {
            byEvent[d.slice(RSVP_D.length)] = JSON.parse(e.content).v;
            onRsvps({ ...byEvent });
          } catch {
          }
        },
        oneose() {
          onRsvps({ ...byEvent });
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // member sets the Sundays they're unavailable (own addressable doc, p-tagged to church)
    async setUnavailable(churchNpub, dates) {
      if (!sk) await window.Fellowship.ready;
      const cp = toPub(churchNpub);
      if (!cp || !sk) return;
      const me = window.Fellowship.myPubkey;
      const content = JSON.stringify({ dates: dates || [] });
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", "trinityone/unavail:" + me], ["t", NET], ["p", cp]], content }, sk);
      try {
        await Promise.any(pool.publish(window.Fellowship.relays, evt));
      } catch {
      }
      return evt;
    },
    // ── read a church's kind-0 profile (name etc.) -- used when following a church by npub ──
    subscribeChurchProfile(churchNpub, onProfile) {
      const pubk = toPub(churchNpub);
      if (!pubk) {
        onProfile(null);
        return () => {
        };
      }
      let latest = 0;
      const sub = pool.subscribeMany(window.Fellowship.relays, [{ kinds: [0], authors: [pubk] }], {
        onevent(e) {
          if (e.created_at < latest) return;
          latest = e.created_at;
          try {
            onProfile(JSON.parse(e.content));
          } catch {
          }
        },
        oneose() {
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // ── self-encryption (NIP-44 to one's own key): for encrypting on-device secrets at rest, e.g. the
    // wallet's bearer ecash in localStorage. Synchronous; returns null if the key isn't loaded yet. ──
    encryptSelf(str) {
      try {
        return sk && pub ? encrypt(String(str), getConversationKey(sk, pub)) : null;
      } catch {
        return null;
      }
    },
    decryptSelf(ct) {
      try {
        return sk && pub ? decrypt(String(ct), getConversationKey(sk, pub)) : null;
      } catch {
        return null;
      }
    },
    // ── Wallet backup (NIP-60-aligned): one replaceable doc, encrypted to the member's OWN key ──
    // The in-app Cashu wallet (mint + proofs) is mirrored here so a reinstall restores the balance
    // from the same identity + relays — the wallet IS the Nostr identity. d = 'trinityone/wallet:<suffix>'.
    // Always written over churchRelays() so it lands on the canonical relays (master-01) for recovery.
    async publishWalletBackup(suffix, obj) {
      if (!sk || !pub) return null;
      let content;
      try {
        content = encrypt(JSON.stringify(obj), getConversationKey(sk, pub));
      } catch (e) {
        return null;
      }
      const evt = finalizeEvent2({ kind: 30078, created_at: Math.floor(Date.now() / 1e3), tags: [["d", "trinityone/wallet:" + suffix], ["t", NET]], content }, sk);
      try {
        await Promise.any(pool.publish(churchRelays(), evt));
      } catch (e) {
        console.warn("[fellowship] wallet backup failed", e);
      }
      return evt;
    },
    subscribeWalletBackup(suffix, onDoc) {
      if (!pub) {
        onDoc(null);
        return () => {
        };
      }
      let latest = 0;
      const sub = pool.subscribeMany(churchRelays(), [{ kinds: [30078], authors: [pub], "#d": ["trinityone/wallet:" + suffix] }], {
        onevent(e) {
          if (e.created_at < latest) return;
          latest = e.created_at;
          try {
            onDoc(JSON.parse(decrypt(e.content, getConversationKey(sk, pub))));
          } catch {
          }
        },
        oneose() {
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    }
  };
  window.Fellowship.ready = init().catch((e) => console.error("[fellowship] init failed", e));
})();
