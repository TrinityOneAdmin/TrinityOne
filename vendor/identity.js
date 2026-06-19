(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod2) => function __require() {
    return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
    mod2
  ));
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/qrcode-generator/qrcode.js
  var require_qrcode = __commonJS({
    "node_modules/qrcode-generator/qrcode.js"(exports, module) {
      var qrcode2 = (function() {
        var qrcode3 = function(typeNumber, errorCorrectionLevel) {
          var PAD0 = 236;
          var PAD1 = 17;
          var _typeNumber = typeNumber;
          var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
          var _modules = null;
          var _moduleCount = 0;
          var _dataCache = null;
          var _dataList = [];
          var _this = {};
          var makeImpl = function(test, maskPattern) {
            _moduleCount = _typeNumber * 4 + 17;
            _modules = (function(moduleCount) {
              var modules = new Array(moduleCount);
              for (var row = 0; row < moduleCount; row += 1) {
                modules[row] = new Array(moduleCount);
                for (var col = 0; col < moduleCount; col += 1) {
                  modules[row][col] = null;
                }
              }
              return modules;
            })(_moduleCount);
            setupPositionProbePattern(0, 0);
            setupPositionProbePattern(_moduleCount - 7, 0);
            setupPositionProbePattern(0, _moduleCount - 7);
            setupPositionAdjustPattern();
            setupTimingPattern();
            setupTypeInfo(test, maskPattern);
            if (_typeNumber >= 7) {
              setupTypeNumber(test);
            }
            if (_dataCache == null) {
              _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
            }
            mapData(_dataCache, maskPattern);
          };
          var setupPositionProbePattern = function(row, col) {
            for (var r = -1; r <= 7; r += 1) {
              if (row + r <= -1 || _moduleCount <= row + r) continue;
              for (var c = -1; c <= 7; c += 1) {
                if (col + c <= -1 || _moduleCount <= col + c) continue;
                if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
                  _modules[row + r][col + c] = true;
                } else {
                  _modules[row + r][col + c] = false;
                }
              }
            }
          };
          var getBestMaskPattern = function() {
            var minLostPoint = 0;
            var pattern = 0;
            for (var i2 = 0; i2 < 8; i2 += 1) {
              makeImpl(true, i2);
              var lostPoint = QRUtil.getLostPoint(_this);
              if (i2 == 0 || minLostPoint > lostPoint) {
                minLostPoint = lostPoint;
                pattern = i2;
              }
            }
            return pattern;
          };
          var setupTimingPattern = function() {
            for (var r = 8; r < _moduleCount - 8; r += 1) {
              if (_modules[r][6] != null) {
                continue;
              }
              _modules[r][6] = r % 2 == 0;
            }
            for (var c = 8; c < _moduleCount - 8; c += 1) {
              if (_modules[6][c] != null) {
                continue;
              }
              _modules[6][c] = c % 2 == 0;
            }
          };
          var setupPositionAdjustPattern = function() {
            var pos = QRUtil.getPatternPosition(_typeNumber);
            for (var i2 = 0; i2 < pos.length; i2 += 1) {
              for (var j = 0; j < pos.length; j += 1) {
                var row = pos[i2];
                var col = pos[j];
                if (_modules[row][col] != null) {
                  continue;
                }
                for (var r = -2; r <= 2; r += 1) {
                  for (var c = -2; c <= 2; c += 1) {
                    if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
                      _modules[row + r][col + c] = true;
                    } else {
                      _modules[row + r][col + c] = false;
                    }
                  }
                }
              }
            }
          };
          var setupTypeNumber = function(test) {
            var bits = QRUtil.getBCHTypeNumber(_typeNumber);
            for (var i2 = 0; i2 < 18; i2 += 1) {
              var mod2 = !test && (bits >> i2 & 1) == 1;
              _modules[Math.floor(i2 / 3)][i2 % 3 + _moduleCount - 8 - 3] = mod2;
            }
            for (var i2 = 0; i2 < 18; i2 += 1) {
              var mod2 = !test && (bits >> i2 & 1) == 1;
              _modules[i2 % 3 + _moduleCount - 8 - 3][Math.floor(i2 / 3)] = mod2;
            }
          };
          var setupTypeInfo = function(test, maskPattern) {
            var data = _errorCorrectionLevel << 3 | maskPattern;
            var bits = QRUtil.getBCHTypeInfo(data);
            for (var i2 = 0; i2 < 15; i2 += 1) {
              var mod2 = !test && (bits >> i2 & 1) == 1;
              if (i2 < 6) {
                _modules[i2][8] = mod2;
              } else if (i2 < 8) {
                _modules[i2 + 1][8] = mod2;
              } else {
                _modules[_moduleCount - 15 + i2][8] = mod2;
              }
            }
            for (var i2 = 0; i2 < 15; i2 += 1) {
              var mod2 = !test && (bits >> i2 & 1) == 1;
              if (i2 < 8) {
                _modules[8][_moduleCount - i2 - 1] = mod2;
              } else if (i2 < 9) {
                _modules[8][15 - i2 - 1 + 1] = mod2;
              } else {
                _modules[8][15 - i2 - 1] = mod2;
              }
            }
            _modules[_moduleCount - 8][8] = !test;
          };
          var mapData = function(data, maskPattern) {
            var inc = -1;
            var row = _moduleCount - 1;
            var bitIndex = 7;
            var byteIndex = 0;
            var maskFunc = QRUtil.getMaskFunction(maskPattern);
            for (var col = _moduleCount - 1; col > 0; col -= 2) {
              if (col == 6) col -= 1;
              while (true) {
                for (var c = 0; c < 2; c += 1) {
                  if (_modules[row][col - c] == null) {
                    var dark = false;
                    if (byteIndex < data.length) {
                      dark = (data[byteIndex] >>> bitIndex & 1) == 1;
                    }
                    var mask = maskFunc(row, col - c);
                    if (mask) {
                      dark = !dark;
                    }
                    _modules[row][col - c] = dark;
                    bitIndex -= 1;
                    if (bitIndex == -1) {
                      byteIndex += 1;
                      bitIndex = 7;
                    }
                  }
                }
                row += inc;
                if (row < 0 || _moduleCount <= row) {
                  row -= inc;
                  inc = -inc;
                  break;
                }
              }
            }
          };
          var createBytes = function(buffer, rsBlocks) {
            var offset = 0;
            var maxDcCount = 0;
            var maxEcCount = 0;
            var dcdata = new Array(rsBlocks.length);
            var ecdata = new Array(rsBlocks.length);
            for (var r = 0; r < rsBlocks.length; r += 1) {
              var dcCount = rsBlocks[r].dataCount;
              var ecCount = rsBlocks[r].totalCount - dcCount;
              maxDcCount = Math.max(maxDcCount, dcCount);
              maxEcCount = Math.max(maxEcCount, ecCount);
              dcdata[r] = new Array(dcCount);
              for (var i2 = 0; i2 < dcdata[r].length; i2 += 1) {
                dcdata[r][i2] = 255 & buffer.getBuffer()[i2 + offset];
              }
              offset += dcCount;
              var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
              var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
              var modPoly = rawPoly.mod(rsPoly);
              ecdata[r] = new Array(rsPoly.getLength() - 1);
              for (var i2 = 0; i2 < ecdata[r].length; i2 += 1) {
                var modIndex = i2 + modPoly.getLength() - ecdata[r].length;
                ecdata[r][i2] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
              }
            }
            var totalCodeCount = 0;
            for (var i2 = 0; i2 < rsBlocks.length; i2 += 1) {
              totalCodeCount += rsBlocks[i2].totalCount;
            }
            var data = new Array(totalCodeCount);
            var index = 0;
            for (var i2 = 0; i2 < maxDcCount; i2 += 1) {
              for (var r = 0; r < rsBlocks.length; r += 1) {
                if (i2 < dcdata[r].length) {
                  data[index] = dcdata[r][i2];
                  index += 1;
                }
              }
            }
            for (var i2 = 0; i2 < maxEcCount; i2 += 1) {
              for (var r = 0; r < rsBlocks.length; r += 1) {
                if (i2 < ecdata[r].length) {
                  data[index] = ecdata[r][i2];
                  index += 1;
                }
              }
            }
            return data;
          };
          var createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
            var rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
            var buffer = qrBitBuffer();
            for (var i2 = 0; i2 < dataList.length; i2 += 1) {
              var data = dataList[i2];
              buffer.put(data.getMode(), 4);
              buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
              data.write(buffer);
            }
            var totalDataCount = 0;
            for (var i2 = 0; i2 < rsBlocks.length; i2 += 1) {
              totalDataCount += rsBlocks[i2].dataCount;
            }
            if (buffer.getLengthInBits() > totalDataCount * 8) {
              throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
            }
            if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
              buffer.put(0, 4);
            }
            while (buffer.getLengthInBits() % 8 != 0) {
              buffer.putBit(false);
            }
            while (true) {
              if (buffer.getLengthInBits() >= totalDataCount * 8) {
                break;
              }
              buffer.put(PAD0, 8);
              if (buffer.getLengthInBits() >= totalDataCount * 8) {
                break;
              }
              buffer.put(PAD1, 8);
            }
            return createBytes(buffer, rsBlocks);
          };
          _this.addData = function(data, mode) {
            mode = mode || "Byte";
            var newData = null;
            switch (mode) {
              case "Numeric":
                newData = qrNumber(data);
                break;
              case "Alphanumeric":
                newData = qrAlphaNum(data);
                break;
              case "Byte":
                newData = qr8BitByte(data);
                break;
              case "Kanji":
                newData = qrKanji(data);
                break;
              default:
                throw "mode:" + mode;
            }
            _dataList.push(newData);
            _dataCache = null;
          };
          _this.isDark = function(row, col) {
            if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
              throw row + "," + col;
            }
            return _modules[row][col];
          };
          _this.getModuleCount = function() {
            return _moduleCount;
          };
          _this.make = function() {
            if (_typeNumber < 1) {
              var typeNumber2 = 1;
              for (; typeNumber2 < 40; typeNumber2++) {
                var rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
                var buffer = qrBitBuffer();
                for (var i2 = 0; i2 < _dataList.length; i2++) {
                  var data = _dataList[i2];
                  buffer.put(data.getMode(), 4);
                  buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
                  data.write(buffer);
                }
                var totalDataCount = 0;
                for (var i2 = 0; i2 < rsBlocks.length; i2++) {
                  totalDataCount += rsBlocks[i2].dataCount;
                }
                if (buffer.getLengthInBits() <= totalDataCount * 8) {
                  break;
                }
              }
              _typeNumber = typeNumber2;
            }
            makeImpl(false, getBestMaskPattern());
          };
          _this.createTableTag = function(cellSize, margin) {
            cellSize = cellSize || 2;
            margin = typeof margin == "undefined" ? cellSize * 4 : margin;
            var qrHtml = "";
            qrHtml += '<table style="';
            qrHtml += " border-width: 0px; border-style: none;";
            qrHtml += " border-collapse: collapse;";
            qrHtml += " padding: 0px; margin: " + margin + "px;";
            qrHtml += '">';
            qrHtml += "<tbody>";
            for (var r = 0; r < _this.getModuleCount(); r += 1) {
              qrHtml += "<tr>";
              for (var c = 0; c < _this.getModuleCount(); c += 1) {
                qrHtml += '<td style="';
                qrHtml += " border-width: 0px; border-style: none;";
                qrHtml += " border-collapse: collapse;";
                qrHtml += " padding: 0px; margin: 0px;";
                qrHtml += " width: " + cellSize + "px;";
                qrHtml += " height: " + cellSize + "px;";
                qrHtml += " background-color: ";
                qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
                qrHtml += ";";
                qrHtml += '"/>';
              }
              qrHtml += "</tr>";
            }
            qrHtml += "</tbody>";
            qrHtml += "</table>";
            return qrHtml;
          };
          _this.createSvgTag = function(cellSize, margin, alt, title) {
            var opts = {};
            if (typeof arguments[0] == "object") {
              opts = arguments[0];
              cellSize = opts.cellSize;
              margin = opts.margin;
              alt = opts.alt;
              title = opts.title;
            }
            cellSize = cellSize || 2;
            margin = typeof margin == "undefined" ? cellSize * 4 : margin;
            alt = typeof alt === "string" ? { text: alt } : alt || {};
            alt.text = alt.text || null;
            alt.id = alt.text ? alt.id || "qrcode-description" : null;
            title = typeof title === "string" ? { text: title } : title || {};
            title.text = title.text || null;
            title.id = title.text ? title.id || "qrcode-title" : null;
            var size = _this.getModuleCount() * cellSize + margin * 2;
            var c, mc, r, mr, qrSvg = "", rect;
            rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
            qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
            qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
            qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
            qrSvg += ' preserveAspectRatio="xMinYMin meet"';
            qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
            qrSvg += ">";
            qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
            qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
            qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
            qrSvg += '<path d="';
            for (r = 0; r < _this.getModuleCount(); r += 1) {
              mr = r * cellSize + margin;
              for (c = 0; c < _this.getModuleCount(); c += 1) {
                if (_this.isDark(r, c)) {
                  mc = c * cellSize + margin;
                  qrSvg += "M" + mc + "," + mr + rect;
                }
              }
            }
            qrSvg += '" stroke="transparent" fill="black"/>';
            qrSvg += "</svg>";
            return qrSvg;
          };
          _this.createDataURL = function(cellSize, margin) {
            cellSize = cellSize || 2;
            margin = typeof margin == "undefined" ? cellSize * 4 : margin;
            var size = _this.getModuleCount() * cellSize + margin * 2;
            var min = margin;
            var max = size - margin;
            return createDataURL(size, size, function(x, y) {
              if (min <= x && x < max && min <= y && y < max) {
                var c = Math.floor((x - min) / cellSize);
                var r = Math.floor((y - min) / cellSize);
                return _this.isDark(r, c) ? 0 : 1;
              } else {
                return 1;
              }
            });
          };
          _this.createImgTag = function(cellSize, margin, alt) {
            cellSize = cellSize || 2;
            margin = typeof margin == "undefined" ? cellSize * 4 : margin;
            var size = _this.getModuleCount() * cellSize + margin * 2;
            var img = "";
            img += "<img";
            img += ' src="';
            img += _this.createDataURL(cellSize, margin);
            img += '"';
            img += ' width="';
            img += size;
            img += '"';
            img += ' height="';
            img += size;
            img += '"';
            if (alt) {
              img += ' alt="';
              img += escapeXml(alt);
              img += '"';
            }
            img += "/>";
            return img;
          };
          var escapeXml = function(s) {
            var escaped = "";
            for (var i2 = 0; i2 < s.length; i2 += 1) {
              var c = s.charAt(i2);
              switch (c) {
                case "<":
                  escaped += "&lt;";
                  break;
                case ">":
                  escaped += "&gt;";
                  break;
                case "&":
                  escaped += "&amp;";
                  break;
                case '"':
                  escaped += "&quot;";
                  break;
                default:
                  escaped += c;
                  break;
              }
            }
            return escaped;
          };
          var _createHalfASCII = function(margin) {
            var cellSize = 1;
            margin = typeof margin == "undefined" ? cellSize * 2 : margin;
            var size = _this.getModuleCount() * cellSize + margin * 2;
            var min = margin;
            var max = size - margin;
            var y, x, r1, r2, p;
            var blocks = {
              "\u2588\u2588": "\u2588",
              "\u2588 ": "\u2580",
              " \u2588": "\u2584",
              "  ": " "
            };
            var blocksLastLineNoMargin = {
              "\u2588\u2588": "\u2580",
              "\u2588 ": "\u2580",
              " \u2588": " ",
              "  ": " "
            };
            var ascii = "";
            for (y = 0; y < size; y += 2) {
              r1 = Math.floor((y - min) / cellSize);
              r2 = Math.floor((y + 1 - min) / cellSize);
              for (x = 0; x < size; x += 1) {
                p = "\u2588";
                if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
                  p = " ";
                }
                if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
                  p += " ";
                } else {
                  p += "\u2588";
                }
                ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
              }
              ascii += "\n";
            }
            if (size % 2 && margin > 0) {
              return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("\u2580");
            }
            return ascii.substring(0, ascii.length - 1);
          };
          _this.createASCII = function(cellSize, margin) {
            cellSize = cellSize || 1;
            if (cellSize < 2) {
              return _createHalfASCII(margin);
            }
            cellSize -= 1;
            margin = typeof margin == "undefined" ? cellSize * 2 : margin;
            var size = _this.getModuleCount() * cellSize + margin * 2;
            var min = margin;
            var max = size - margin;
            var y, x, r, p;
            var white = Array(cellSize + 1).join("\u2588\u2588");
            var black = Array(cellSize + 1).join("  ");
            var ascii = "";
            var line = "";
            for (y = 0; y < size; y += 1) {
              r = Math.floor((y - min) / cellSize);
              line = "";
              for (x = 0; x < size; x += 1) {
                p = 1;
                if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
                  p = 0;
                }
                line += p ? white : black;
              }
              for (r = 0; r < cellSize; r += 1) {
                ascii += line + "\n";
              }
            }
            return ascii.substring(0, ascii.length - 1);
          };
          _this.renderTo2dContext = function(context, cellSize) {
            cellSize = cellSize || 2;
            var length = _this.getModuleCount();
            for (var row = 0; row < length; row++) {
              for (var col = 0; col < length; col++) {
                context.fillStyle = _this.isDark(row, col) ? "black" : "white";
                context.fillRect(row * cellSize, col * cellSize, cellSize, cellSize);
              }
            }
          };
          return _this;
        };
        qrcode3.stringToBytesFuncs = {
          "default": function(s) {
            var bytes = [];
            for (var i2 = 0; i2 < s.length; i2 += 1) {
              var c = s.charCodeAt(i2);
              bytes.push(c & 255);
            }
            return bytes;
          }
        };
        qrcode3.stringToBytes = qrcode3.stringToBytesFuncs["default"];
        qrcode3.createStringToBytes = function(unicodeData, numChars) {
          var unicodeMap = (function() {
            var bin = base64DecodeInputStream(unicodeData);
            var read = function() {
              var b = bin.read();
              if (b == -1) throw "eof";
              return b;
            };
            var count = 0;
            var unicodeMap2 = {};
            while (true) {
              var b0 = bin.read();
              if (b0 == -1) break;
              var b1 = read();
              var b2 = read();
              var b3 = read();
              var k = String.fromCharCode(b0 << 8 | b1);
              var v = b2 << 8 | b3;
              unicodeMap2[k] = v;
              count += 1;
            }
            if (count != numChars) {
              throw count + " != " + numChars;
            }
            return unicodeMap2;
          })();
          var unknownChar = "?".charCodeAt(0);
          return function(s) {
            var bytes = [];
            for (var i2 = 0; i2 < s.length; i2 += 1) {
              var c = s.charCodeAt(i2);
              if (c < 128) {
                bytes.push(c);
              } else {
                var b = unicodeMap[s.charAt(i2)];
                if (typeof b == "number") {
                  if ((b & 255) == b) {
                    bytes.push(b);
                  } else {
                    bytes.push(b >>> 8);
                    bytes.push(b & 255);
                  }
                } else {
                  bytes.push(unknownChar);
                }
              }
            }
            return bytes;
          };
        };
        var QRMode = {
          MODE_NUMBER: 1 << 0,
          MODE_ALPHA_NUM: 1 << 1,
          MODE_8BIT_BYTE: 1 << 2,
          MODE_KANJI: 1 << 3
        };
        var QRErrorCorrectionLevel = {
          L: 1,
          M: 0,
          Q: 3,
          H: 2
        };
        var QRMaskPattern = {
          PATTERN000: 0,
          PATTERN001: 1,
          PATTERN010: 2,
          PATTERN011: 3,
          PATTERN100: 4,
          PATTERN101: 5,
          PATTERN110: 6,
          PATTERN111: 7
        };
        var QRUtil = (function() {
          var PATTERN_POSITION_TABLE = [
            [],
            [6, 18],
            [6, 22],
            [6, 26],
            [6, 30],
            [6, 34],
            [6, 22, 38],
            [6, 24, 42],
            [6, 26, 46],
            [6, 28, 50],
            [6, 30, 54],
            [6, 32, 58],
            [6, 34, 62],
            [6, 26, 46, 66],
            [6, 26, 48, 70],
            [6, 26, 50, 74],
            [6, 30, 54, 78],
            [6, 30, 56, 82],
            [6, 30, 58, 86],
            [6, 34, 62, 90],
            [6, 28, 50, 72, 94],
            [6, 26, 50, 74, 98],
            [6, 30, 54, 78, 102],
            [6, 28, 54, 80, 106],
            [6, 32, 58, 84, 110],
            [6, 30, 58, 86, 114],
            [6, 34, 62, 90, 118],
            [6, 26, 50, 74, 98, 122],
            [6, 30, 54, 78, 102, 126],
            [6, 26, 52, 78, 104, 130],
            [6, 30, 56, 82, 108, 134],
            [6, 34, 60, 86, 112, 138],
            [6, 30, 58, 86, 114, 142],
            [6, 34, 62, 90, 118, 146],
            [6, 30, 54, 78, 102, 126, 150],
            [6, 24, 50, 76, 102, 128, 154],
            [6, 28, 54, 80, 106, 132, 158],
            [6, 32, 58, 84, 110, 136, 162],
            [6, 26, 54, 82, 110, 138, 166],
            [6, 30, 58, 86, 114, 142, 170]
          ];
          var G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
          var G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
          var G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
          var _this = {};
          var getBCHDigit = function(data) {
            var digit = 0;
            while (data != 0) {
              digit += 1;
              data >>>= 1;
            }
            return digit;
          };
          _this.getBCHTypeInfo = function(data) {
            var d = data << 10;
            while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
              d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
            }
            return (data << 10 | d) ^ G15_MASK;
          };
          _this.getBCHTypeNumber = function(data) {
            var d = data << 12;
            while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
              d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
            }
            return data << 12 | d;
          };
          _this.getPatternPosition = function(typeNumber) {
            return PATTERN_POSITION_TABLE[typeNumber - 1];
          };
          _this.getMaskFunction = function(maskPattern) {
            switch (maskPattern) {
              case QRMaskPattern.PATTERN000:
                return function(i2, j) {
                  return (i2 + j) % 2 == 0;
                };
              case QRMaskPattern.PATTERN001:
                return function(i2, j) {
                  return i2 % 2 == 0;
                };
              case QRMaskPattern.PATTERN010:
                return function(i2, j) {
                  return j % 3 == 0;
                };
              case QRMaskPattern.PATTERN011:
                return function(i2, j) {
                  return (i2 + j) % 3 == 0;
                };
              case QRMaskPattern.PATTERN100:
                return function(i2, j) {
                  return (Math.floor(i2 / 2) + Math.floor(j / 3)) % 2 == 0;
                };
              case QRMaskPattern.PATTERN101:
                return function(i2, j) {
                  return i2 * j % 2 + i2 * j % 3 == 0;
                };
              case QRMaskPattern.PATTERN110:
                return function(i2, j) {
                  return (i2 * j % 2 + i2 * j % 3) % 2 == 0;
                };
              case QRMaskPattern.PATTERN111:
                return function(i2, j) {
                  return (i2 * j % 3 + (i2 + j) % 2) % 2 == 0;
                };
              default:
                throw "bad maskPattern:" + maskPattern;
            }
          };
          _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
            var a = qrPolynomial([1], 0);
            for (var i2 = 0; i2 < errorCorrectLength; i2 += 1) {
              a = a.multiply(qrPolynomial([1, QRMath.gexp(i2)], 0));
            }
            return a;
          };
          _this.getLengthInBits = function(mode, type) {
            if (1 <= type && type < 10) {
              switch (mode) {
                case QRMode.MODE_NUMBER:
                  return 10;
                case QRMode.MODE_ALPHA_NUM:
                  return 9;
                case QRMode.MODE_8BIT_BYTE:
                  return 8;
                case QRMode.MODE_KANJI:
                  return 8;
                default:
                  throw "mode:" + mode;
              }
            } else if (type < 27) {
              switch (mode) {
                case QRMode.MODE_NUMBER:
                  return 12;
                case QRMode.MODE_ALPHA_NUM:
                  return 11;
                case QRMode.MODE_8BIT_BYTE:
                  return 16;
                case QRMode.MODE_KANJI:
                  return 10;
                default:
                  throw "mode:" + mode;
              }
            } else if (type < 41) {
              switch (mode) {
                case QRMode.MODE_NUMBER:
                  return 14;
                case QRMode.MODE_ALPHA_NUM:
                  return 13;
                case QRMode.MODE_8BIT_BYTE:
                  return 16;
                case QRMode.MODE_KANJI:
                  return 12;
                default:
                  throw "mode:" + mode;
              }
            } else {
              throw "type:" + type;
            }
          };
          _this.getLostPoint = function(qrcode4) {
            var moduleCount = qrcode4.getModuleCount();
            var lostPoint = 0;
            for (var row = 0; row < moduleCount; row += 1) {
              for (var col = 0; col < moduleCount; col += 1) {
                var sameCount = 0;
                var dark = qrcode4.isDark(row, col);
                for (var r = -1; r <= 1; r += 1) {
                  if (row + r < 0 || moduleCount <= row + r) {
                    continue;
                  }
                  for (var c = -1; c <= 1; c += 1) {
                    if (col + c < 0 || moduleCount <= col + c) {
                      continue;
                    }
                    if (r == 0 && c == 0) {
                      continue;
                    }
                    if (dark == qrcode4.isDark(row + r, col + c)) {
                      sameCount += 1;
                    }
                  }
                }
                if (sameCount > 5) {
                  lostPoint += 3 + sameCount - 5;
                }
              }
            }
            ;
            for (var row = 0; row < moduleCount - 1; row += 1) {
              for (var col = 0; col < moduleCount - 1; col += 1) {
                var count = 0;
                if (qrcode4.isDark(row, col)) count += 1;
                if (qrcode4.isDark(row + 1, col)) count += 1;
                if (qrcode4.isDark(row, col + 1)) count += 1;
                if (qrcode4.isDark(row + 1, col + 1)) count += 1;
                if (count == 0 || count == 4) {
                  lostPoint += 3;
                }
              }
            }
            for (var row = 0; row < moduleCount; row += 1) {
              for (var col = 0; col < moduleCount - 6; col += 1) {
                if (qrcode4.isDark(row, col) && !qrcode4.isDark(row, col + 1) && qrcode4.isDark(row, col + 2) && qrcode4.isDark(row, col + 3) && qrcode4.isDark(row, col + 4) && !qrcode4.isDark(row, col + 5) && qrcode4.isDark(row, col + 6)) {
                  lostPoint += 40;
                }
              }
            }
            for (var col = 0; col < moduleCount; col += 1) {
              for (var row = 0; row < moduleCount - 6; row += 1) {
                if (qrcode4.isDark(row, col) && !qrcode4.isDark(row + 1, col) && qrcode4.isDark(row + 2, col) && qrcode4.isDark(row + 3, col) && qrcode4.isDark(row + 4, col) && !qrcode4.isDark(row + 5, col) && qrcode4.isDark(row + 6, col)) {
                  lostPoint += 40;
                }
              }
            }
            var darkCount = 0;
            for (var col = 0; col < moduleCount; col += 1) {
              for (var row = 0; row < moduleCount; row += 1) {
                if (qrcode4.isDark(row, col)) {
                  darkCount += 1;
                }
              }
            }
            var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
            lostPoint += ratio * 10;
            return lostPoint;
          };
          return _this;
        })();
        var QRMath = (function() {
          var EXP_TABLE = new Array(256);
          var LOG_TABLE = new Array(256);
          for (var i2 = 0; i2 < 8; i2 += 1) {
            EXP_TABLE[i2] = 1 << i2;
          }
          for (var i2 = 8; i2 < 256; i2 += 1) {
            EXP_TABLE[i2] = EXP_TABLE[i2 - 4] ^ EXP_TABLE[i2 - 5] ^ EXP_TABLE[i2 - 6] ^ EXP_TABLE[i2 - 8];
          }
          for (var i2 = 0; i2 < 255; i2 += 1) {
            LOG_TABLE[EXP_TABLE[i2]] = i2;
          }
          var _this = {};
          _this.glog = function(n) {
            if (n < 1) {
              throw "glog(" + n + ")";
            }
            return LOG_TABLE[n];
          };
          _this.gexp = function(n) {
            while (n < 0) {
              n += 255;
            }
            while (n >= 256) {
              n -= 255;
            }
            return EXP_TABLE[n];
          };
          return _this;
        })();
        function qrPolynomial(num2, shift) {
          if (typeof num2.length == "undefined") {
            throw num2.length + "/" + shift;
          }
          var _num = (function() {
            var offset = 0;
            while (offset < num2.length && num2[offset] == 0) {
              offset += 1;
            }
            var _num2 = new Array(num2.length - offset + shift);
            for (var i2 = 0; i2 < num2.length - offset; i2 += 1) {
              _num2[i2] = num2[i2 + offset];
            }
            return _num2;
          })();
          var _this = {};
          _this.getAt = function(index) {
            return _num[index];
          };
          _this.getLength = function() {
            return _num.length;
          };
          _this.multiply = function(e) {
            var num3 = new Array(_this.getLength() + e.getLength() - 1);
            for (var i2 = 0; i2 < _this.getLength(); i2 += 1) {
              for (var j = 0; j < e.getLength(); j += 1) {
                num3[i2 + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i2)) + QRMath.glog(e.getAt(j)));
              }
            }
            return qrPolynomial(num3, 0);
          };
          _this.mod = function(e) {
            if (_this.getLength() - e.getLength() < 0) {
              return _this;
            }
            var ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
            var num3 = new Array(_this.getLength());
            for (var i2 = 0; i2 < _this.getLength(); i2 += 1) {
              num3[i2] = _this.getAt(i2);
            }
            for (var i2 = 0; i2 < e.getLength(); i2 += 1) {
              num3[i2] ^= QRMath.gexp(QRMath.glog(e.getAt(i2)) + ratio);
            }
            return qrPolynomial(num3, 0).mod(e);
          };
          return _this;
        }
        ;
        var QRRSBlock = (function() {
          var RS_BLOCK_TABLE = [
            // L
            // M
            // Q
            // H
            // 1
            [1, 26, 19],
            [1, 26, 16],
            [1, 26, 13],
            [1, 26, 9],
            // 2
            [1, 44, 34],
            [1, 44, 28],
            [1, 44, 22],
            [1, 44, 16],
            // 3
            [1, 70, 55],
            [1, 70, 44],
            [2, 35, 17],
            [2, 35, 13],
            // 4
            [1, 100, 80],
            [2, 50, 32],
            [2, 50, 24],
            [4, 25, 9],
            // 5
            [1, 134, 108],
            [2, 67, 43],
            [2, 33, 15, 2, 34, 16],
            [2, 33, 11, 2, 34, 12],
            // 6
            [2, 86, 68],
            [4, 43, 27],
            [4, 43, 19],
            [4, 43, 15],
            // 7
            [2, 98, 78],
            [4, 49, 31],
            [2, 32, 14, 4, 33, 15],
            [4, 39, 13, 1, 40, 14],
            // 8
            [2, 121, 97],
            [2, 60, 38, 2, 61, 39],
            [4, 40, 18, 2, 41, 19],
            [4, 40, 14, 2, 41, 15],
            // 9
            [2, 146, 116],
            [3, 58, 36, 2, 59, 37],
            [4, 36, 16, 4, 37, 17],
            [4, 36, 12, 4, 37, 13],
            // 10
            [2, 86, 68, 2, 87, 69],
            [4, 69, 43, 1, 70, 44],
            [6, 43, 19, 2, 44, 20],
            [6, 43, 15, 2, 44, 16],
            // 11
            [4, 101, 81],
            [1, 80, 50, 4, 81, 51],
            [4, 50, 22, 4, 51, 23],
            [3, 36, 12, 8, 37, 13],
            // 12
            [2, 116, 92, 2, 117, 93],
            [6, 58, 36, 2, 59, 37],
            [4, 46, 20, 6, 47, 21],
            [7, 42, 14, 4, 43, 15],
            // 13
            [4, 133, 107],
            [8, 59, 37, 1, 60, 38],
            [8, 44, 20, 4, 45, 21],
            [12, 33, 11, 4, 34, 12],
            // 14
            [3, 145, 115, 1, 146, 116],
            [4, 64, 40, 5, 65, 41],
            [11, 36, 16, 5, 37, 17],
            [11, 36, 12, 5, 37, 13],
            // 15
            [5, 109, 87, 1, 110, 88],
            [5, 65, 41, 5, 66, 42],
            [5, 54, 24, 7, 55, 25],
            [11, 36, 12, 7, 37, 13],
            // 16
            [5, 122, 98, 1, 123, 99],
            [7, 73, 45, 3, 74, 46],
            [15, 43, 19, 2, 44, 20],
            [3, 45, 15, 13, 46, 16],
            // 17
            [1, 135, 107, 5, 136, 108],
            [10, 74, 46, 1, 75, 47],
            [1, 50, 22, 15, 51, 23],
            [2, 42, 14, 17, 43, 15],
            // 18
            [5, 150, 120, 1, 151, 121],
            [9, 69, 43, 4, 70, 44],
            [17, 50, 22, 1, 51, 23],
            [2, 42, 14, 19, 43, 15],
            // 19
            [3, 141, 113, 4, 142, 114],
            [3, 70, 44, 11, 71, 45],
            [17, 47, 21, 4, 48, 22],
            [9, 39, 13, 16, 40, 14],
            // 20
            [3, 135, 107, 5, 136, 108],
            [3, 67, 41, 13, 68, 42],
            [15, 54, 24, 5, 55, 25],
            [15, 43, 15, 10, 44, 16],
            // 21
            [4, 144, 116, 4, 145, 117],
            [17, 68, 42],
            [17, 50, 22, 6, 51, 23],
            [19, 46, 16, 6, 47, 17],
            // 22
            [2, 139, 111, 7, 140, 112],
            [17, 74, 46],
            [7, 54, 24, 16, 55, 25],
            [34, 37, 13],
            // 23
            [4, 151, 121, 5, 152, 122],
            [4, 75, 47, 14, 76, 48],
            [11, 54, 24, 14, 55, 25],
            [16, 45, 15, 14, 46, 16],
            // 24
            [6, 147, 117, 4, 148, 118],
            [6, 73, 45, 14, 74, 46],
            [11, 54, 24, 16, 55, 25],
            [30, 46, 16, 2, 47, 17],
            // 25
            [8, 132, 106, 4, 133, 107],
            [8, 75, 47, 13, 76, 48],
            [7, 54, 24, 22, 55, 25],
            [22, 45, 15, 13, 46, 16],
            // 26
            [10, 142, 114, 2, 143, 115],
            [19, 74, 46, 4, 75, 47],
            [28, 50, 22, 6, 51, 23],
            [33, 46, 16, 4, 47, 17],
            // 27
            [8, 152, 122, 4, 153, 123],
            [22, 73, 45, 3, 74, 46],
            [8, 53, 23, 26, 54, 24],
            [12, 45, 15, 28, 46, 16],
            // 28
            [3, 147, 117, 10, 148, 118],
            [3, 73, 45, 23, 74, 46],
            [4, 54, 24, 31, 55, 25],
            [11, 45, 15, 31, 46, 16],
            // 29
            [7, 146, 116, 7, 147, 117],
            [21, 73, 45, 7, 74, 46],
            [1, 53, 23, 37, 54, 24],
            [19, 45, 15, 26, 46, 16],
            // 30
            [5, 145, 115, 10, 146, 116],
            [19, 75, 47, 10, 76, 48],
            [15, 54, 24, 25, 55, 25],
            [23, 45, 15, 25, 46, 16],
            // 31
            [13, 145, 115, 3, 146, 116],
            [2, 74, 46, 29, 75, 47],
            [42, 54, 24, 1, 55, 25],
            [23, 45, 15, 28, 46, 16],
            // 32
            [17, 145, 115],
            [10, 74, 46, 23, 75, 47],
            [10, 54, 24, 35, 55, 25],
            [19, 45, 15, 35, 46, 16],
            // 33
            [17, 145, 115, 1, 146, 116],
            [14, 74, 46, 21, 75, 47],
            [29, 54, 24, 19, 55, 25],
            [11, 45, 15, 46, 46, 16],
            // 34
            [13, 145, 115, 6, 146, 116],
            [14, 74, 46, 23, 75, 47],
            [44, 54, 24, 7, 55, 25],
            [59, 46, 16, 1, 47, 17],
            // 35
            [12, 151, 121, 7, 152, 122],
            [12, 75, 47, 26, 76, 48],
            [39, 54, 24, 14, 55, 25],
            [22, 45, 15, 41, 46, 16],
            // 36
            [6, 151, 121, 14, 152, 122],
            [6, 75, 47, 34, 76, 48],
            [46, 54, 24, 10, 55, 25],
            [2, 45, 15, 64, 46, 16],
            // 37
            [17, 152, 122, 4, 153, 123],
            [29, 74, 46, 14, 75, 47],
            [49, 54, 24, 10, 55, 25],
            [24, 45, 15, 46, 46, 16],
            // 38
            [4, 152, 122, 18, 153, 123],
            [13, 74, 46, 32, 75, 47],
            [48, 54, 24, 14, 55, 25],
            [42, 45, 15, 32, 46, 16],
            // 39
            [20, 147, 117, 4, 148, 118],
            [40, 75, 47, 7, 76, 48],
            [43, 54, 24, 22, 55, 25],
            [10, 45, 15, 67, 46, 16],
            // 40
            [19, 148, 118, 6, 149, 119],
            [18, 75, 47, 31, 76, 48],
            [34, 54, 24, 34, 55, 25],
            [20, 45, 15, 61, 46, 16]
          ];
          var qrRSBlock = function(totalCount, dataCount) {
            var _this2 = {};
            _this2.totalCount = totalCount;
            _this2.dataCount = dataCount;
            return _this2;
          };
          var _this = {};
          var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
            switch (errorCorrectionLevel) {
              case QRErrorCorrectionLevel.L:
                return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
              case QRErrorCorrectionLevel.M:
                return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
              case QRErrorCorrectionLevel.Q:
                return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
              case QRErrorCorrectionLevel.H:
                return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
              default:
                return void 0;
            }
          };
          _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
            var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
            if (typeof rsBlock == "undefined") {
              throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
            }
            var length = rsBlock.length / 3;
            var list = [];
            for (var i2 = 0; i2 < length; i2 += 1) {
              var count = rsBlock[i2 * 3 + 0];
              var totalCount = rsBlock[i2 * 3 + 1];
              var dataCount = rsBlock[i2 * 3 + 2];
              for (var j = 0; j < count; j += 1) {
                list.push(qrRSBlock(totalCount, dataCount));
              }
            }
            return list;
          };
          return _this;
        })();
        var qrBitBuffer = function() {
          var _buffer = [];
          var _length = 0;
          var _this = {};
          _this.getBuffer = function() {
            return _buffer;
          };
          _this.getAt = function(index) {
            var bufIndex = Math.floor(index / 8);
            return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
          };
          _this.put = function(num2, length) {
            for (var i2 = 0; i2 < length; i2 += 1) {
              _this.putBit((num2 >>> length - i2 - 1 & 1) == 1);
            }
          };
          _this.getLengthInBits = function() {
            return _length;
          };
          _this.putBit = function(bit) {
            var bufIndex = Math.floor(_length / 8);
            if (_buffer.length <= bufIndex) {
              _buffer.push(0);
            }
            if (bit) {
              _buffer[bufIndex] |= 128 >>> _length % 8;
            }
            _length += 1;
          };
          return _this;
        };
        var qrNumber = function(data) {
          var _mode = QRMode.MODE_NUMBER;
          var _data = data;
          var _this = {};
          _this.getMode = function() {
            return _mode;
          };
          _this.getLength = function(buffer) {
            return _data.length;
          };
          _this.write = function(buffer) {
            var data2 = _data;
            var i2 = 0;
            while (i2 + 2 < data2.length) {
              buffer.put(strToNum(data2.substring(i2, i2 + 3)), 10);
              i2 += 3;
            }
            if (i2 < data2.length) {
              if (data2.length - i2 == 1) {
                buffer.put(strToNum(data2.substring(i2, i2 + 1)), 4);
              } else if (data2.length - i2 == 2) {
                buffer.put(strToNum(data2.substring(i2, i2 + 2)), 7);
              }
            }
          };
          var strToNum = function(s) {
            var num2 = 0;
            for (var i2 = 0; i2 < s.length; i2 += 1) {
              num2 = num2 * 10 + chatToNum(s.charAt(i2));
            }
            return num2;
          };
          var chatToNum = function(c) {
            if ("0" <= c && c <= "9") {
              return c.charCodeAt(0) - "0".charCodeAt(0);
            }
            throw "illegal char :" + c;
          };
          return _this;
        };
        var qrAlphaNum = function(data) {
          var _mode = QRMode.MODE_ALPHA_NUM;
          var _data = data;
          var _this = {};
          _this.getMode = function() {
            return _mode;
          };
          _this.getLength = function(buffer) {
            return _data.length;
          };
          _this.write = function(buffer) {
            var s = _data;
            var i2 = 0;
            while (i2 + 1 < s.length) {
              buffer.put(
                getCode(s.charAt(i2)) * 45 + getCode(s.charAt(i2 + 1)),
                11
              );
              i2 += 2;
            }
            if (i2 < s.length) {
              buffer.put(getCode(s.charAt(i2)), 6);
            }
          };
          var getCode = function(c) {
            if ("0" <= c && c <= "9") {
              return c.charCodeAt(0) - "0".charCodeAt(0);
            } else if ("A" <= c && c <= "Z") {
              return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
            } else {
              switch (c) {
                case " ":
                  return 36;
                case "$":
                  return 37;
                case "%":
                  return 38;
                case "*":
                  return 39;
                case "+":
                  return 40;
                case "-":
                  return 41;
                case ".":
                  return 42;
                case "/":
                  return 43;
                case ":":
                  return 44;
                default:
                  throw "illegal char :" + c;
              }
            }
          };
          return _this;
        };
        var qr8BitByte = function(data) {
          var _mode = QRMode.MODE_8BIT_BYTE;
          var _data = data;
          var _bytes = qrcode3.stringToBytes(data);
          var _this = {};
          _this.getMode = function() {
            return _mode;
          };
          _this.getLength = function(buffer) {
            return _bytes.length;
          };
          _this.write = function(buffer) {
            for (var i2 = 0; i2 < _bytes.length; i2 += 1) {
              buffer.put(_bytes[i2], 8);
            }
          };
          return _this;
        };
        var qrKanji = function(data) {
          var _mode = QRMode.MODE_KANJI;
          var _data = data;
          var stringToBytes = qrcode3.stringToBytesFuncs["SJIS"];
          if (!stringToBytes) {
            throw "sjis not supported.";
          }
          !(function(c, code) {
            var test = stringToBytes(c);
            if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
              throw "sjis not supported.";
            }
          })("\u53CB", 38726);
          var _bytes = stringToBytes(data);
          var _this = {};
          _this.getMode = function() {
            return _mode;
          };
          _this.getLength = function(buffer) {
            return ~~(_bytes.length / 2);
          };
          _this.write = function(buffer) {
            var data2 = _bytes;
            var i2 = 0;
            while (i2 + 1 < data2.length) {
              var c = (255 & data2[i2]) << 8 | 255 & data2[i2 + 1];
              if (33088 <= c && c <= 40956) {
                c -= 33088;
              } else if (57408 <= c && c <= 60351) {
                c -= 49472;
              } else {
                throw "illegal char at " + (i2 + 1) + "/" + c;
              }
              c = (c >>> 8 & 255) * 192 + (c & 255);
              buffer.put(c, 13);
              i2 += 2;
            }
            if (i2 < data2.length) {
              throw "illegal char at " + (i2 + 1);
            }
          };
          return _this;
        };
        var byteArrayOutputStream = function() {
          var _bytes = [];
          var _this = {};
          _this.writeByte = function(b) {
            _bytes.push(b & 255);
          };
          _this.writeShort = function(i2) {
            _this.writeByte(i2);
            _this.writeByte(i2 >>> 8);
          };
          _this.writeBytes = function(b, off, len) {
            off = off || 0;
            len = len || b.length;
            for (var i2 = 0; i2 < len; i2 += 1) {
              _this.writeByte(b[i2 + off]);
            }
          };
          _this.writeString = function(s) {
            for (var i2 = 0; i2 < s.length; i2 += 1) {
              _this.writeByte(s.charCodeAt(i2));
            }
          };
          _this.toByteArray = function() {
            return _bytes;
          };
          _this.toString = function() {
            var s = "";
            s += "[";
            for (var i2 = 0; i2 < _bytes.length; i2 += 1) {
              if (i2 > 0) {
                s += ",";
              }
              s += _bytes[i2];
            }
            s += "]";
            return s;
          };
          return _this;
        };
        var base64EncodeOutputStream = function() {
          var _buffer = 0;
          var _buflen = 0;
          var _length = 0;
          var _base64 = "";
          var _this = {};
          var writeEncoded = function(b) {
            _base64 += String.fromCharCode(encode2(b & 63));
          };
          var encode2 = function(n) {
            if (n < 0) {
            } else if (n < 26) {
              return 65 + n;
            } else if (n < 52) {
              return 97 + (n - 26);
            } else if (n < 62) {
              return 48 + (n - 52);
            } else if (n == 62) {
              return 43;
            } else if (n == 63) {
              return 47;
            }
            throw "n:" + n;
          };
          _this.writeByte = function(n) {
            _buffer = _buffer << 8 | n & 255;
            _buflen += 8;
            _length += 1;
            while (_buflen >= 6) {
              writeEncoded(_buffer >>> _buflen - 6);
              _buflen -= 6;
            }
          };
          _this.flush = function() {
            if (_buflen > 0) {
              writeEncoded(_buffer << 6 - _buflen);
              _buffer = 0;
              _buflen = 0;
            }
            if (_length % 3 != 0) {
              var padlen = 3 - _length % 3;
              for (var i2 = 0; i2 < padlen; i2 += 1) {
                _base64 += "=";
              }
            }
          };
          _this.toString = function() {
            return _base64;
          };
          return _this;
        };
        var base64DecodeInputStream = function(str) {
          var _str = str;
          var _pos = 0;
          var _buffer = 0;
          var _buflen = 0;
          var _this = {};
          _this.read = function() {
            while (_buflen < 8) {
              if (_pos >= _str.length) {
                if (_buflen == 0) {
                  return -1;
                }
                throw "unexpected end of file./" + _buflen;
              }
              var c = _str.charAt(_pos);
              _pos += 1;
              if (c == "=") {
                _buflen = 0;
                return -1;
              } else if (c.match(/^\s$/)) {
                continue;
              }
              _buffer = _buffer << 6 | decode2(c.charCodeAt(0));
              _buflen += 6;
            }
            var n = _buffer >>> _buflen - 8 & 255;
            _buflen -= 8;
            return n;
          };
          var decode2 = function(c) {
            if (65 <= c && c <= 90) {
              return c - 65;
            } else if (97 <= c && c <= 122) {
              return c - 97 + 26;
            } else if (48 <= c && c <= 57) {
              return c - 48 + 52;
            } else if (c == 43) {
              return 62;
            } else if (c == 47) {
              return 63;
            } else {
              throw "c:" + c;
            }
          };
          return _this;
        };
        var gifImage = function(width, height) {
          var _width = width;
          var _height = height;
          var _data = new Array(width * height);
          var _this = {};
          _this.setPixel = function(x, y, pixel) {
            _data[y * _width + x] = pixel;
          };
          _this.write = function(out) {
            out.writeString("GIF87a");
            out.writeShort(_width);
            out.writeShort(_height);
            out.writeByte(128);
            out.writeByte(0);
            out.writeByte(0);
            out.writeByte(0);
            out.writeByte(0);
            out.writeByte(0);
            out.writeByte(255);
            out.writeByte(255);
            out.writeByte(255);
            out.writeString(",");
            out.writeShort(0);
            out.writeShort(0);
            out.writeShort(_width);
            out.writeShort(_height);
            out.writeByte(0);
            var lzwMinCodeSize = 2;
            var raster = getLZWRaster(lzwMinCodeSize);
            out.writeByte(lzwMinCodeSize);
            var offset = 0;
            while (raster.length - offset > 255) {
              out.writeByte(255);
              out.writeBytes(raster, offset, 255);
              offset += 255;
            }
            out.writeByte(raster.length - offset);
            out.writeBytes(raster, offset, raster.length - offset);
            out.writeByte(0);
            out.writeString(";");
          };
          var bitOutputStream = function(out) {
            var _out = out;
            var _bitLength = 0;
            var _bitBuffer = 0;
            var _this2 = {};
            _this2.write = function(data, length) {
              if (data >>> length != 0) {
                throw "length over";
              }
              while (_bitLength + length >= 8) {
                _out.writeByte(255 & (data << _bitLength | _bitBuffer));
                length -= 8 - _bitLength;
                data >>>= 8 - _bitLength;
                _bitBuffer = 0;
                _bitLength = 0;
              }
              _bitBuffer = data << _bitLength | _bitBuffer;
              _bitLength = _bitLength + length;
            };
            _this2.flush = function() {
              if (_bitLength > 0) {
                _out.writeByte(_bitBuffer);
              }
            };
            return _this2;
          };
          var getLZWRaster = function(lzwMinCodeSize) {
            var clearCode = 1 << lzwMinCodeSize;
            var endCode = (1 << lzwMinCodeSize) + 1;
            var bitLength = lzwMinCodeSize + 1;
            var table = lzwTable();
            for (var i2 = 0; i2 < clearCode; i2 += 1) {
              table.add(String.fromCharCode(i2));
            }
            table.add(String.fromCharCode(clearCode));
            table.add(String.fromCharCode(endCode));
            var byteOut = byteArrayOutputStream();
            var bitOut = bitOutputStream(byteOut);
            bitOut.write(clearCode, bitLength);
            var dataIndex = 0;
            var s = String.fromCharCode(_data[dataIndex]);
            dataIndex += 1;
            while (dataIndex < _data.length) {
              var c = String.fromCharCode(_data[dataIndex]);
              dataIndex += 1;
              if (table.contains(s + c)) {
                s = s + c;
              } else {
                bitOut.write(table.indexOf(s), bitLength);
                if (table.size() < 4095) {
                  if (table.size() == 1 << bitLength) {
                    bitLength += 1;
                  }
                  table.add(s + c);
                }
                s = c;
              }
            }
            bitOut.write(table.indexOf(s), bitLength);
            bitOut.write(endCode, bitLength);
            bitOut.flush();
            return byteOut.toByteArray();
          };
          var lzwTable = function() {
            var _map = {};
            var _size = 0;
            var _this2 = {};
            _this2.add = function(key) {
              if (_this2.contains(key)) {
                throw "dup key:" + key;
              }
              _map[key] = _size;
              _size += 1;
            };
            _this2.size = function() {
              return _size;
            };
            _this2.indexOf = function(key) {
              return _map[key];
            };
            _this2.contains = function(key) {
              return typeof _map[key] != "undefined";
            };
            return _this2;
          };
          return _this;
        };
        var createDataURL = function(width, height, getPixel) {
          var gif = gifImage(width, height);
          for (var y = 0; y < height; y += 1) {
            for (var x = 0; x < width; x += 1) {
              gif.setPixel(x, y, getPixel(x, y));
            }
          }
          var b = byteArrayOutputStream();
          gif.write(b);
          var base64 = base64EncodeOutputStream();
          var bytes = b.toByteArray();
          for (var i2 = 0; i2 < bytes.length; i2 += 1) {
            base64.writeByte(bytes[i2]);
          }
          base64.flush();
          return "data:image/gif;base64," + base64;
        };
        return qrcode3;
      })();
      !(function() {
        qrcode2.stringToBytesFuncs["UTF-8"] = function(s) {
          function toUTF8Array(str) {
            var utf8 = [];
            for (var i2 = 0; i2 < str.length; i2++) {
              var charcode = str.charCodeAt(i2);
              if (charcode < 128) utf8.push(charcode);
              else if (charcode < 2048) {
                utf8.push(
                  192 | charcode >> 6,
                  128 | charcode & 63
                );
              } else if (charcode < 55296 || charcode >= 57344) {
                utf8.push(
                  224 | charcode >> 12,
                  128 | charcode >> 6 & 63,
                  128 | charcode & 63
                );
              } else {
                i2++;
                charcode = 65536 + ((charcode & 1023) << 10 | str.charCodeAt(i2) & 1023);
                utf8.push(
                  240 | charcode >> 18,
                  128 | charcode >> 12 & 63,
                  128 | charcode >> 6 & 63,
                  128 | charcode & 63
                );
              }
            }
            return utf8;
          }
          return toUTF8Array(s);
        };
      })();
      (function(factory) {
        if (typeof define === "function" && define.amd) {
          define([], factory);
        } else if (typeof exports === "object") {
          module.exports = factory();
        }
      })(function() {
        return qrcode2;
      });
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/node_modules/@capacitor/core/dist/index.js
  var createCapacitorPlatforms, initPlatforms, CapacitorPlatforms, addPlatform, setPlatform, ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, Plugins, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp;
  var init_dist = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/node_modules/@capacitor/core/dist/index.js"() {
      createCapacitorPlatforms = (win) => {
        const defaultPlatformMap = /* @__PURE__ */ new Map();
        defaultPlatformMap.set("web", { name: "web" });
        const capPlatforms = win.CapacitorPlatforms || {
          currentPlatform: { name: "web" },
          platforms: defaultPlatformMap
        };
        const addPlatform2 = (name, platform) => {
          capPlatforms.platforms.set(name, platform);
        };
        const setPlatform2 = (name) => {
          if (capPlatforms.platforms.has(name)) {
            capPlatforms.currentPlatform = capPlatforms.platforms.get(name);
          }
        };
        capPlatforms.addPlatform = addPlatform2;
        capPlatforms.setPlatform = setPlatform2;
        return capPlatforms;
      };
      initPlatforms = (win) => win.CapacitorPlatforms = createCapacitorPlatforms(win);
      CapacitorPlatforms = /* @__PURE__ */ initPlatforms(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      addPlatform = CapacitorPlatforms.addPlatform;
      setPlatform = CapacitorPlatforms.setPlatform;
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        var _a, _b, _c, _d, _e;
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins2 = cap.Plugins = cap.Plugins || {};
        const capPlatforms = win.CapacitorPlatforms;
        const defaultGetPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const getPlatform = ((_a = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _a === void 0 ? void 0 : _a.getPlatform) || defaultGetPlatform;
        const defaultIsNativePlatform = () => getPlatform() !== "web";
        const isNativePlatform = ((_b = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _b === void 0 ? void 0 : _b.isNativePlatform) || defaultIsNativePlatform;
        const defaultIsPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const isPluginAvailable = ((_c = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _c === void 0 ? void 0 : _c.isPluginAvailable) || defaultIsPluginAvailable;
        const defaultGetPluginHeader = (pluginName) => {
          var _a2;
          return (_a2 = cap.PluginHeaders) === null || _a2 === void 0 ? void 0 : _a2.find((h) => h.name === pluginName);
        };
        const getPluginHeader = ((_d = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _d === void 0 ? void 0 : _d.getPluginHeader) || defaultGetPluginHeader;
        const handleError = (err) => win.console.error(err);
        const pluginMethodNoop = (_target, prop, pluginName) => {
          return Promise.reject(`${pluginName} does not have an implementation of "${prop}".`);
        };
        const registeredPlugins = /* @__PURE__ */ new Map();
        const defaultRegisterPlugin = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a2, _b2;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a2 = impl[prop]) === null || _a2 === void 0 ? void 0 : _a2.bind(impl);
              }
            } else if (impl) {
              return (_b2 = impl[prop]) === null || _b2 === void 0 ? void 0 : _b2.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy2 = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins2[pluginName] = proxy2;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy: proxy2,
            platforms: /* @__PURE__ */ new Set([
              ...Object.keys(jsImplementations),
              ...pluginHeader ? [platform] : []
            ])
          });
          return proxy2;
        };
        const registerPlugin2 = ((_e = capPlatforms === null || capPlatforms === void 0 ? void 0 : capPlatforms.currentPlatform) === null || _e === void 0 ? void 0 : _e.registerPlugin) || defaultRegisterPlugin;
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.pluginMethodNoop = pluginMethodNoop;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        cap.platform = cap.getPlatform();
        cap.isNative = cap.isNativePlatform();
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      Plugins = Capacitor.Plugins;
      WebPlugin = class {
        constructor(config) {
          this.listeners = {};
          this.windowListeners = {};
          if (config) {
            console.warn(`Capacitor WebPlugin "${config.name}" config object was deprecated in v3 and will be removed in v4.`);
            this.config = config;
          }
        }
        addListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          Object.defineProperty(p, "remove", {
            value: async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            }
          });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data) {
          const listeners = this.listeners[eventName];
          if (listeners) {
            listeners.forEach((listener) => listener(data));
          }
        }
        hasListeners(eventName) {
          return !!this.listeners[eventName].length;
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          this.listeners[eventName].splice(index, 1);
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = `; expires=${(options.expires || "").replace("expires=", "")}`;
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/definitions.js
  var StorageErrorType, KeychainAccess, StorageError;
  var init_definitions = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/definitions.js"() {
      (function(StorageErrorType2) {
        StorageErrorType2["missingKey"] = "missingKey";
        StorageErrorType2["invalidData"] = "invalidData";
        StorageErrorType2["osError"] = "osError";
        StorageErrorType2["unknownError"] = "unknownError";
      })(StorageErrorType || (StorageErrorType = {}));
      (function(KeychainAccess2) {
        KeychainAccess2[KeychainAccess2["whenUnlocked"] = 0] = "whenUnlocked";
        KeychainAccess2[KeychainAccess2["whenUnlockedThisDeviceOnly"] = 1] = "whenUnlockedThisDeviceOnly";
        KeychainAccess2[KeychainAccess2["afterFirstUnlock"] = 2] = "afterFirstUnlock";
        KeychainAccess2[KeychainAccess2["afterFirstUnlockThisDeviceOnly"] = 3] = "afterFirstUnlockThisDeviceOnly";
        KeychainAccess2[KeychainAccess2["whenPasscodeSetThisDeviceOnly"] = 4] = "whenPasscodeSetThisDeviceOnly";
      })(KeychainAccess || (KeychainAccess = {}));
      StorageError = class extends Error {
        constructor(message, code) {
          super(message);
          this.name = this.constructor.name;
          this.code = code;
        }
      };
    }
  });

  // node_modules/async-mutex/index.mjs
  function insertSorted(a, v) {
    const i2 = findIndexFromEnd(a, (other) => v.priority <= other.priority);
    a.splice(i2 + 1, 0, v);
  }
  function findIndexFromEnd(a, predicate) {
    for (let i2 = a.length - 1; i2 >= 0; i2--) {
      if (predicate(a[i2])) {
        return i2;
      }
    }
    return -1;
  }
  var E_TIMEOUT, E_ALREADY_LOCKED, E_CANCELED, __awaiter$2, Semaphore, __awaiter$1, Mutex;
  var init_async_mutex = __esm({
    "node_modules/async-mutex/index.mjs"() {
      E_TIMEOUT = new Error("timeout while waiting for mutex to become available");
      E_ALREADY_LOCKED = new Error("mutex already locked");
      E_CANCELED = new Error("request for lock canceled");
      __awaiter$2 = function(thisArg, _arguments, P, generator) {
        function adopt(value) {
          return value instanceof P ? value : new P(function(resolve) {
            resolve(value);
          });
        }
        return new (P || (P = Promise))(function(resolve, reject) {
          function fulfilled(value) {
            try {
              step(generator.next(value));
            } catch (e) {
              reject(e);
            }
          }
          function rejected(value) {
            try {
              step(generator["throw"](value));
            } catch (e) {
              reject(e);
            }
          }
          function step(result) {
            result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
          }
          step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
      };
      Semaphore = class {
        constructor(_value, _cancelError = E_CANCELED) {
          this._value = _value;
          this._cancelError = _cancelError;
          this._queue = [];
          this._weightedWaiters = [];
        }
        acquire(weight = 1, priority = 0) {
          if (weight <= 0)
            throw new Error(`invalid weight ${weight}: must be positive`);
          return new Promise((resolve, reject) => {
            const task = { resolve, reject, weight, priority };
            const i2 = findIndexFromEnd(this._queue, (other) => priority <= other.priority);
            if (i2 === -1 && weight <= this._value) {
              this._dispatchItem(task);
            } else {
              this._queue.splice(i2 + 1, 0, task);
            }
          });
        }
        runExclusive(callback_1) {
          return __awaiter$2(this, arguments, void 0, function* (callback, weight = 1, priority = 0) {
            const [value, release] = yield this.acquire(weight, priority);
            try {
              return yield callback(value);
            } finally {
              release();
            }
          });
        }
        waitForUnlock(weight = 1, priority = 0) {
          if (weight <= 0)
            throw new Error(`invalid weight ${weight}: must be positive`);
          if (this._couldLockImmediately(weight, priority)) {
            return Promise.resolve();
          } else {
            return new Promise((resolve) => {
              if (!this._weightedWaiters[weight - 1])
                this._weightedWaiters[weight - 1] = [];
              insertSorted(this._weightedWaiters[weight - 1], { resolve, priority });
            });
          }
        }
        isLocked() {
          return this._value <= 0;
        }
        getValue() {
          return this._value;
        }
        setValue(value) {
          this._value = value;
          this._dispatchQueue();
        }
        release(weight = 1) {
          if (weight <= 0)
            throw new Error(`invalid weight ${weight}: must be positive`);
          this._value += weight;
          this._dispatchQueue();
        }
        cancel() {
          this._queue.forEach((entry) => entry.reject(this._cancelError));
          this._queue = [];
        }
        _dispatchQueue() {
          this._drainUnlockWaiters();
          while (this._queue.length > 0 && this._queue[0].weight <= this._value) {
            this._dispatchItem(this._queue.shift());
            this._drainUnlockWaiters();
          }
        }
        _dispatchItem(item) {
          const previousValue = this._value;
          this._value -= item.weight;
          item.resolve([previousValue, this._newReleaser(item.weight)]);
        }
        _newReleaser(weight) {
          let called = false;
          return () => {
            if (called)
              return;
            called = true;
            this.release(weight);
          };
        }
        _drainUnlockWaiters() {
          if (this._queue.length === 0) {
            for (let weight = this._value; weight > 0; weight--) {
              const waiters = this._weightedWaiters[weight - 1];
              if (!waiters)
                continue;
              waiters.forEach((waiter) => waiter.resolve());
              this._weightedWaiters[weight - 1] = [];
            }
          } else {
            const queuedPriority = this._queue[0].priority;
            for (let weight = this._value; weight > 0; weight--) {
              const waiters = this._weightedWaiters[weight - 1];
              if (!waiters)
                continue;
              const i2 = waiters.findIndex((waiter) => waiter.priority <= queuedPriority);
              (i2 === -1 ? waiters : waiters.splice(0, i2)).forEach(((waiter) => waiter.resolve()));
            }
          }
        }
        _couldLockImmediately(weight, priority) {
          return (this._queue.length === 0 || this._queue[0].priority < priority) && weight <= this._value;
        }
      };
      __awaiter$1 = function(thisArg, _arguments, P, generator) {
        function adopt(value) {
          return value instanceof P ? value : new P(function(resolve) {
            resolve(value);
          });
        }
        return new (P || (P = Promise))(function(resolve, reject) {
          function fulfilled(value) {
            try {
              step(generator.next(value));
            } catch (e) {
              reject(e);
            }
          }
          function rejected(value) {
            try {
              step(generator["throw"](value));
            } catch (e) {
              reject(e);
            }
          }
          function step(result) {
            result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
          }
          step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
      };
      Mutex = class {
        constructor(cancelError) {
          this._semaphore = new Semaphore(1, cancelError);
        }
        acquire() {
          return __awaiter$1(this, arguments, void 0, function* (priority = 0) {
            const [, releaser] = yield this._semaphore.acquire(1, priority);
            return releaser;
          });
        }
        runExclusive(callback, priority = 0) {
          return this._semaphore.runExclusive(() => callback(), 1, priority);
        }
        isLocked() {
          return this._semaphore.isLocked();
        }
        waitForUnlock(priority = 0) {
          return this._semaphore.waitForUnlock(1, priority);
        }
        release() {
          if (this._semaphore.isLocked())
            this._semaphore.release();
        }
        cancel() {
          return this._semaphore.cancel();
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js
  function isStorageErrorType(value) {
    return value !== void 0 && Object.keys(StorageErrorType).includes(value);
  }
  function parseISODate(isoDate) {
    const match = isoDateRE.exec(isoDate);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const hour = parseInt(match[4], 10);
      const minute = parseInt(match[5], 10);
      const second = parseInt(match[6], 10);
      const millis = parseInt(match[7], 10);
      const epochTime = Date.UTC(year, month, day, hour, minute, second, millis);
      return new Date(epochTime);
    }
    return null;
  }
  var mutex, SecureStorageBase, isoDateRE;
  var init_base = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/base.js"() {
      init_dist();
      init_async_mutex();
      init_definitions();
      mutex = new Mutex();
      SecureStorageBase = class _SecureStorageBase extends WebPlugin {
        constructor() {
          super(...arguments);
          this.prefix = "capacitor-storage_";
          this.sync = false;
          this.access = KeychainAccess.whenUnlocked;
        }
        async setSynchronize(sync) {
          return mutex.runExclusive(async () => {
            this.sync = sync;
            if (Capacitor.getPlatform() === "ios") {
              return this.setSynchronizeKeychain({ sync });
            }
            return Promise.resolve();
          });
        }
        async getSynchronize() {
          return Promise.resolve(this.sync);
        }
        async setDefaultKeychainAccess(access) {
          return mutex.runExclusive(() => {
            this.access = access;
          });
        }
        async tryOperation(operation) {
          try {
            return await mutex.runExclusive(async () => operation());
          } catch (e) {
            if (e instanceof CapacitorException && isStorageErrorType(e.code)) {
              throw new StorageError(e.message, e.code);
            }
            throw e;
          }
        }
        async get(key, convertDate = true, sync) {
          if (key) {
            const { data } = await this.tryOperation(async () => this.internalGetItem({
              prefixedKey: this.prefixedKey(key),
              sync: sync !== null && sync !== void 0 ? sync : this.sync
            }));
            if (data === null) {
              return null;
            }
            if (convertDate) {
              const date = parseISODate(data);
              if (date) {
                return date;
              }
            }
            try {
              return JSON.parse(data);
            } catch (e) {
              throw new StorageError("Invalid data", StorageErrorType.invalidData);
            }
          }
          return _SecureStorageBase.missingKey();
        }
        async getItem(key) {
          if (key) {
            const { data } = await this.tryOperation(async () => this.internalGetItem({
              prefixedKey: this.prefixedKey(key),
              sync: this.sync
            }));
            return data;
          }
          return null;
        }
        async set(key, data, convertDate = true, sync, access) {
          if (key) {
            let convertedData = data;
            if (convertDate && data instanceof Date) {
              convertedData = data.toISOString();
            }
            return this.tryOperation(async () => this.internalSetItem({
              prefixedKey: this.prefixedKey(key),
              data: JSON.stringify(convertedData),
              sync: sync !== null && sync !== void 0 ? sync : this.sync,
              access: access !== null && access !== void 0 ? access : this.access
            }));
          }
          return _SecureStorageBase.missingKey();
        }
        async setItem(key, value) {
          if (key) {
            return this.tryOperation(async () => this.internalSetItem({
              prefixedKey: this.prefixedKey(key),
              data: value,
              sync: this.sync,
              access: this.access
            }));
          }
          return _SecureStorageBase.missingKey();
        }
        async remove(key, sync) {
          if (key) {
            const { success } = await this.tryOperation(async () => this.internalRemoveItem({
              prefixedKey: this.prefixedKey(key),
              sync: sync !== null && sync !== void 0 ? sync : this.sync
            }));
            return success;
          }
          return _SecureStorageBase.missingKey();
        }
        async removeItem(key) {
          if (key) {
            await this.tryOperation(async () => this.internalRemoveItem({
              prefixedKey: this.prefixedKey(key),
              sync: this.sync
            }));
            return;
          }
          _SecureStorageBase.missingKey();
        }
        async keys(sync) {
          const { keys } = await this.tryOperation(async () => this.getPrefixedKeys({
            prefix: this.prefix,
            sync: sync !== null && sync !== void 0 ? sync : this.sync
          }));
          const prefixLength = this.prefix.length;
          return keys.map((key) => key.slice(prefixLength));
        }
        async getKeyPrefix() {
          return Promise.resolve(this.prefix);
        }
        async setKeyPrefix(prefix) {
          this.prefix = prefix;
          return Promise.resolve();
        }
        prefixedKey(key) {
          return this.prefix + key;
        }
        static missingKey() {
          throw new StorageError("No key provided", StorageErrorType.missingKey);
        }
      };
      isoDateRE = /^"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).(\d{3})Z"$/u;
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    SecureStorageWeb: () => SecureStorageWeb
  });
  var SecureStorageWeb;
  var init_web = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/web.js"() {
      init_base();
      SecureStorageWeb = class extends SecureStorageBase {
        // @native
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async setSynchronizeKeychain(options) {
          return Promise.resolve();
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await
        async internalGetItem(options) {
          return { data: localStorage.getItem(options.prefixedKey) };
        }
        // @native
        async internalSetItem(options) {
          localStorage.setItem(options.prefixedKey, options.data);
          return Promise.resolve();
        }
        // @native
        async internalRemoveItem(options) {
          const item = localStorage.getItem(options.prefixedKey);
          if (item !== null) {
            localStorage.removeItem(options.prefixedKey);
            return Promise.resolve({ success: true });
          }
          return Promise.resolve({ success: false });
        }
        async clear() {
          const { keys } = await this.getPrefixedKeys({ prefix: this.prefix });
          keys.forEach((key) => {
            localStorage.removeItem(key);
          });
          return Promise.resolve();
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/require-await,@typescript-eslint/no-unused-vars
        async clearItemsWithPrefix(options) {
          console.warn("clearItemsWithPrefix is native only");
        }
        // @native
        async getPrefixedKeys(options) {
          const keys = [];
          for (let i2 = 0; i2 < localStorage.length; i2++) {
            const key = localStorage.key(i2);
            if (key === null || key === void 0 ? void 0 : key.startsWith(options.prefix)) {
              keys.push(key);
            }
          }
          return Promise.resolve({ keys });
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/native.js
  var native_exports = {};
  __export(native_exports, {
    SecureStorageNative: () => SecureStorageNative
  });
  var SecureStorageNative;
  var init_native = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/native.js"() {
      init_base();
      SecureStorageNative = class extends SecureStorageBase {
        constructor(capProxy) {
          super();
          const proxy2 = capProxy;
          this.setSynchronizeKeychain = proxy2.setSynchronizeKeychain;
          this.internalGetItem = proxy2.internalGetItem;
          this.internalSetItem = proxy2.internalSetItem;
          this.internalRemoveItem = proxy2.internalRemoveItem;
          this.clearItemsWithPrefix = proxy2.clearItemsWithPrefix;
          this.getPrefixedKeys = proxy2.getPrefixedKeys;
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async setSynchronizeKeychain(options) {
          return Promise.resolve();
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async internalGetItem(options) {
          return Promise.resolve({ data: "" });
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async internalSetItem(options) {
          return Promise.resolve();
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async internalRemoveItem(options) {
          return Promise.resolve({ success: true });
        }
        async clear(sync) {
          return this.tryOperation(async () => this.clearItemsWithPrefix({
            prefix: this.prefix,
            sync: sync !== null && sync !== void 0 ? sync : this.sync
          }));
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async clearItemsWithPrefix(options) {
          return Promise.resolve();
        }
        // @native
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async getPrefixedKeys(options) {
          return Promise.resolve({ keys: [] });
        }
      };
    }
  });

  // node_modules/@aparajita/capacitor-secure-storage/dist/esm/index.js
  var esm_exports = {};
  __export(esm_exports, {
    KeychainAccess: () => KeychainAccess,
    SecureStorage: () => proxy,
    StorageError: () => StorageError,
    StorageErrorType: () => StorageErrorType
  });
  var proxy;
  var init_esm = __esm({
    "node_modules/@aparajita/capacitor-secure-storage/dist/esm/index.js"() {
      init_dist();
      init_definitions();
      proxy = registerPlugin("SecureStorage", {
        web: async () => Promise.resolve().then(() => (init_web(), web_exports)).then((module) => new module.SecureStorageWeb()),
        ios: async () => Promise.resolve().then(() => (init_native(), native_exports)).then((module) => new module.SecureStorageNative(proxy)),
        android: async () => Promise.resolve().then(() => (init_native(), native_exports)).then((module) => new module.SecureStorageNative(proxy))
      });
    }
  });

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
    for (let i2 = 0; i2 < arrays.length; i2++) {
      arrays[i2].fill(0);
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
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i2) => i2.toString(16).padStart(2, "0"));
  function bytesToHex(bytes) {
    abytes(bytes);
    if (hasHexBuiltin)
      return bytes.toHex();
    let hex = "";
    for (let i2 = 0; i2 < bytes.length; i2++) {
      hex += hexes[bytes[i2]];
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
    for (let i2 = 0; i2 < arrays.length; i2++) {
      const a = arrays[i2];
      abytes(a);
      sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i2 = 0, pad = 0; i2 < arrays.length; i2++) {
      const a = arrays[i2];
      res.set(a, pad);
      pad += a.length;
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

  // node_modules/nostr-tools/node_modules/@scure/bip39/wordlists/english.js
  var wordlist = `abandon
ability
able
about
above
absent
absorb
abstract
absurd
abuse
access
accident
account
accuse
achieve
acid
acoustic
acquire
across
act
action
actor
actress
actual
adapt
add
addict
address
adjust
admit
adult
advance
advice
aerobic
affair
afford
afraid
again
age
agent
agree
ahead
aim
air
airport
aisle
alarm
album
alcohol
alert
alien
all
alley
allow
almost
alone
alpha
already
also
alter
always
amateur
amazing
among
amount
amused
analyst
anchor
ancient
anger
angle
angry
animal
ankle
announce
annual
another
answer
antenna
antique
anxiety
any
apart
apology
appear
apple
approve
april
arch
arctic
area
arena
argue
arm
armed
armor
army
around
arrange
arrest
arrive
arrow
art
artefact
artist
artwork
ask
aspect
assault
asset
assist
assume
asthma
athlete
atom
attack
attend
attitude
attract
auction
audit
august
aunt
author
auto
autumn
average
avocado
avoid
awake
aware
away
awesome
awful
awkward
axis
baby
bachelor
bacon
badge
bag
balance
balcony
ball
bamboo
banana
banner
bar
barely
bargain
barrel
base
basic
basket
battle
beach
bean
beauty
because
become
beef
before
begin
behave
behind
believe
below
belt
bench
benefit
best
betray
better
between
beyond
bicycle
bid
bike
bind
biology
bird
birth
bitter
black
blade
blame
blanket
blast
bleak
bless
blind
blood
blossom
blouse
blue
blur
blush
board
boat
body
boil
bomb
bone
bonus
book
boost
border
boring
borrow
boss
bottom
bounce
box
boy
bracket
brain
brand
brass
brave
bread
breeze
brick
bridge
brief
bright
bring
brisk
broccoli
broken
bronze
broom
brother
brown
brush
bubble
buddy
budget
buffalo
build
bulb
bulk
bullet
bundle
bunker
burden
burger
burst
bus
business
busy
butter
buyer
buzz
cabbage
cabin
cable
cactus
cage
cake
call
calm
camera
camp
can
canal
cancel
candy
cannon
canoe
canvas
canyon
capable
capital
captain
car
carbon
card
cargo
carpet
carry
cart
case
cash
casino
castle
casual
cat
catalog
catch
category
cattle
caught
cause
caution
cave
ceiling
celery
cement
census
century
cereal
certain
chair
chalk
champion
change
chaos
chapter
charge
chase
chat
cheap
check
cheese
chef
cherry
chest
chicken
chief
child
chimney
choice
choose
chronic
chuckle
chunk
churn
cigar
cinnamon
circle
citizen
city
civil
claim
clap
clarify
claw
clay
clean
clerk
clever
click
client
cliff
climb
clinic
clip
clock
clog
close
cloth
cloud
clown
club
clump
cluster
clutch
coach
coast
coconut
code
coffee
coil
coin
collect
color
column
combine
come
comfort
comic
common
company
concert
conduct
confirm
congress
connect
consider
control
convince
cook
cool
copper
copy
coral
core
corn
correct
cost
cotton
couch
country
couple
course
cousin
cover
coyote
crack
cradle
craft
cram
crane
crash
crater
crawl
crazy
cream
credit
creek
crew
cricket
crime
crisp
critic
crop
cross
crouch
crowd
crucial
cruel
cruise
crumble
crunch
crush
cry
crystal
cube
culture
cup
cupboard
curious
current
curtain
curve
cushion
custom
cute
cycle
dad
damage
damp
dance
danger
daring
dash
daughter
dawn
day
deal
debate
debris
decade
december
decide
decline
decorate
decrease
deer
defense
define
defy
degree
delay
deliver
demand
demise
denial
dentist
deny
depart
depend
deposit
depth
deputy
derive
describe
desert
design
desk
despair
destroy
detail
detect
develop
device
devote
diagram
dial
diamond
diary
dice
diesel
diet
differ
digital
dignity
dilemma
dinner
dinosaur
direct
dirt
disagree
discover
disease
dish
dismiss
disorder
display
distance
divert
divide
divorce
dizzy
doctor
document
dog
doll
dolphin
domain
donate
donkey
donor
door
dose
double
dove
draft
dragon
drama
drastic
draw
dream
dress
drift
drill
drink
drip
drive
drop
drum
dry
duck
dumb
dune
during
dust
dutch
duty
dwarf
dynamic
eager
eagle
early
earn
earth
easily
east
easy
echo
ecology
economy
edge
edit
educate
effort
egg
eight
either
elbow
elder
electric
elegant
element
elephant
elevator
elite
else
embark
embody
embrace
emerge
emotion
employ
empower
empty
enable
enact
end
endless
endorse
enemy
energy
enforce
engage
engine
enhance
enjoy
enlist
enough
enrich
enroll
ensure
enter
entire
entry
envelope
episode
equal
equip
era
erase
erode
erosion
error
erupt
escape
essay
essence
estate
eternal
ethics
evidence
evil
evoke
evolve
exact
example
excess
exchange
excite
exclude
excuse
execute
exercise
exhaust
exhibit
exile
exist
exit
exotic
expand
expect
expire
explain
expose
express
extend
extra
eye
eyebrow
fabric
face
faculty
fade
faint
faith
fall
false
fame
family
famous
fan
fancy
fantasy
farm
fashion
fat
fatal
father
fatigue
fault
favorite
feature
february
federal
fee
feed
feel
female
fence
festival
fetch
fever
few
fiber
fiction
field
figure
file
film
filter
final
find
fine
finger
finish
fire
firm
first
fiscal
fish
fit
fitness
fix
flag
flame
flash
flat
flavor
flee
flight
flip
float
flock
floor
flower
fluid
flush
fly
foam
focus
fog
foil
fold
follow
food
foot
force
forest
forget
fork
fortune
forum
forward
fossil
foster
found
fox
fragile
frame
frequent
fresh
friend
fringe
frog
front
frost
frown
frozen
fruit
fuel
fun
funny
furnace
fury
future
gadget
gain
galaxy
gallery
game
gap
garage
garbage
garden
garlic
garment
gas
gasp
gate
gather
gauge
gaze
general
genius
genre
gentle
genuine
gesture
ghost
giant
gift
giggle
ginger
giraffe
girl
give
glad
glance
glare
glass
glide
glimpse
globe
gloom
glory
glove
glow
glue
goat
goddess
gold
good
goose
gorilla
gospel
gossip
govern
gown
grab
grace
grain
grant
grape
grass
gravity
great
green
grid
grief
grit
grocery
group
grow
grunt
guard
guess
guide
guilt
guitar
gun
gym
habit
hair
half
hammer
hamster
hand
happy
harbor
hard
harsh
harvest
hat
have
hawk
hazard
head
health
heart
heavy
hedgehog
height
hello
helmet
help
hen
hero
hidden
high
hill
hint
hip
hire
history
hobby
hockey
hold
hole
holiday
hollow
home
honey
hood
hope
horn
horror
horse
hospital
host
hotel
hour
hover
hub
huge
human
humble
humor
hundred
hungry
hunt
hurdle
hurry
hurt
husband
hybrid
ice
icon
idea
identify
idle
ignore
ill
illegal
illness
image
imitate
immense
immune
impact
impose
improve
impulse
inch
include
income
increase
index
indicate
indoor
industry
infant
inflict
inform
inhale
inherit
initial
inject
injury
inmate
inner
innocent
input
inquiry
insane
insect
inside
inspire
install
intact
interest
into
invest
invite
involve
iron
island
isolate
issue
item
ivory
jacket
jaguar
jar
jazz
jealous
jeans
jelly
jewel
job
join
joke
journey
joy
judge
juice
jump
jungle
junior
junk
just
kangaroo
keen
keep
ketchup
key
kick
kid
kidney
kind
kingdom
kiss
kit
kitchen
kite
kitten
kiwi
knee
knife
knock
know
lab
label
labor
ladder
lady
lake
lamp
language
laptop
large
later
latin
laugh
laundry
lava
law
lawn
lawsuit
layer
lazy
leader
leaf
learn
leave
lecture
left
leg
legal
legend
leisure
lemon
lend
length
lens
leopard
lesson
letter
level
liar
liberty
library
license
life
lift
light
like
limb
limit
link
lion
liquid
list
little
live
lizard
load
loan
lobster
local
lock
logic
lonely
long
loop
lottery
loud
lounge
love
loyal
lucky
luggage
lumber
lunar
lunch
luxury
lyrics
machine
mad
magic
magnet
maid
mail
main
major
make
mammal
man
manage
mandate
mango
mansion
manual
maple
marble
march
margin
marine
market
marriage
mask
mass
master
match
material
math
matrix
matter
maximum
maze
meadow
mean
measure
meat
mechanic
medal
media
melody
melt
member
memory
mention
menu
mercy
merge
merit
merry
mesh
message
metal
method
middle
midnight
milk
million
mimic
mind
minimum
minor
minute
miracle
mirror
misery
miss
mistake
mix
mixed
mixture
mobile
model
modify
mom
moment
monitor
monkey
monster
month
moon
moral
more
morning
mosquito
mother
motion
motor
mountain
mouse
move
movie
much
muffin
mule
multiply
muscle
museum
mushroom
music
must
mutual
myself
mystery
myth
naive
name
napkin
narrow
nasty
nation
nature
near
neck
need
negative
neglect
neither
nephew
nerve
nest
net
network
neutral
never
news
next
nice
night
noble
noise
nominee
noodle
normal
north
nose
notable
note
nothing
notice
novel
now
nuclear
number
nurse
nut
oak
obey
object
oblige
obscure
observe
obtain
obvious
occur
ocean
october
odor
off
offer
office
often
oil
okay
old
olive
olympic
omit
once
one
onion
online
only
open
opera
opinion
oppose
option
orange
orbit
orchard
order
ordinary
organ
orient
original
orphan
ostrich
other
outdoor
outer
output
outside
oval
oven
over
own
owner
oxygen
oyster
ozone
pact
paddle
page
pair
palace
palm
panda
panel
panic
panther
paper
parade
parent
park
parrot
party
pass
patch
path
patient
patrol
pattern
pause
pave
payment
peace
peanut
pear
peasant
pelican
pen
penalty
pencil
people
pepper
perfect
permit
person
pet
phone
photo
phrase
physical
piano
picnic
picture
piece
pig
pigeon
pill
pilot
pink
pioneer
pipe
pistol
pitch
pizza
place
planet
plastic
plate
play
please
pledge
pluck
plug
plunge
poem
poet
point
polar
pole
police
pond
pony
pool
popular
portion
position
possible
post
potato
pottery
poverty
powder
power
practice
praise
predict
prefer
prepare
present
pretty
prevent
price
pride
primary
print
priority
prison
private
prize
problem
process
produce
profit
program
project
promote
proof
property
prosper
protect
proud
provide
public
pudding
pull
pulp
pulse
pumpkin
punch
pupil
puppy
purchase
purity
purpose
purse
push
put
puzzle
pyramid
quality
quantum
quarter
question
quick
quit
quiz
quote
rabbit
raccoon
race
rack
radar
radio
rail
rain
raise
rally
ramp
ranch
random
range
rapid
rare
rate
rather
raven
raw
razor
ready
real
reason
rebel
rebuild
recall
receive
recipe
record
recycle
reduce
reflect
reform
refuse
region
regret
regular
reject
relax
release
relief
rely
remain
remember
remind
remove
render
renew
rent
reopen
repair
repeat
replace
report
require
rescue
resemble
resist
resource
response
result
retire
retreat
return
reunion
reveal
review
reward
rhythm
rib
ribbon
rice
rich
ride
ridge
rifle
right
rigid
ring
riot
ripple
risk
ritual
rival
river
road
roast
robot
robust
rocket
romance
roof
rookie
room
rose
rotate
rough
round
route
royal
rubber
rude
rug
rule
run
runway
rural
sad
saddle
sadness
safe
sail
salad
salmon
salon
salt
salute
same
sample
sand
satisfy
satoshi
sauce
sausage
save
say
scale
scan
scare
scatter
scene
scheme
school
science
scissors
scorpion
scout
scrap
screen
script
scrub
sea
search
season
seat
second
secret
section
security
seed
seek
segment
select
sell
seminar
senior
sense
sentence
series
service
session
settle
setup
seven
shadow
shaft
shallow
share
shed
shell
sheriff
shield
shift
shine
ship
shiver
shock
shoe
shoot
shop
short
shoulder
shove
shrimp
shrug
shuffle
shy
sibling
sick
side
siege
sight
sign
silent
silk
silly
silver
similar
simple
since
sing
siren
sister
situate
six
size
skate
sketch
ski
skill
skin
skirt
skull
slab
slam
sleep
slender
slice
slide
slight
slim
slogan
slot
slow
slush
small
smart
smile
smoke
smooth
snack
snake
snap
sniff
snow
soap
soccer
social
sock
soda
soft
solar
soldier
solid
solution
solve
someone
song
soon
sorry
sort
soul
sound
soup
source
south
space
spare
spatial
spawn
speak
special
speed
spell
spend
sphere
spice
spider
spike
spin
spirit
split
spoil
sponsor
spoon
sport
spot
spray
spread
spring
spy
square
squeeze
squirrel
stable
stadium
staff
stage
stairs
stamp
stand
start
state
stay
steak
steel
stem
step
stereo
stick
still
sting
stock
stomach
stone
stool
story
stove
strategy
street
strike
strong
struggle
student
stuff
stumble
style
subject
submit
subway
success
such
sudden
suffer
sugar
suggest
suit
summer
sun
sunny
sunset
super
supply
supreme
sure
surface
surge
surprise
surround
survey
suspect
sustain
swallow
swamp
swap
swarm
swear
sweet
swift
swim
swing
switch
sword
symbol
symptom
syrup
system
table
tackle
tag
tail
talent
talk
tank
tape
target
task
taste
tattoo
taxi
teach
team
tell
ten
tenant
tennis
tent
term
test
text
thank
that
theme
then
theory
there
they
thing
this
thought
three
thrive
throw
thumb
thunder
ticket
tide
tiger
tilt
timber
time
tiny
tip
tired
tissue
title
toast
tobacco
today
toddler
toe
together
toilet
token
tomato
tomorrow
tone
tongue
tonight
tool
tooth
top
topic
topple
torch
tornado
tortoise
toss
total
tourist
toward
tower
town
toy
track
trade
traffic
tragic
train
transfer
trap
trash
travel
tray
treat
tree
trend
trial
tribe
trick
trigger
trim
trip
trophy
trouble
truck
true
truly
trumpet
trust
truth
try
tube
tuition
tumble
tuna
tunnel
turkey
turn
turtle
twelve
twenty
twice
twin
twist
two
type
typical
ugly
umbrella
unable
unaware
uncle
uncover
under
undo
unfair
unfold
unhappy
uniform
unique
unit
universe
unknown
unlock
until
unusual
unveil
update
upgrade
uphold
upon
upper
upset
urban
urge
usage
use
used
useful
useless
usual
utility
vacant
vacuum
vague
valid
valley
valve
van
vanish
vapor
various
vast
vault
vehicle
velvet
vendor
venture
venue
verb
verify
version
very
vessel
veteran
viable
vibrant
vicious
victory
video
view
village
vintage
violin
virtual
virus
visa
visit
visual
vital
vivid
vocal
voice
void
volcano
volume
vote
voyage
wage
wagon
wait
walk
wall
walnut
want
warfare
warm
warrior
wash
wasp
waste
water
wave
way
wealth
weapon
wear
weasel
weather
web
wedding
weekend
weird
welcome
west
wet
whale
what
wheat
wheel
when
where
whip
whisper
wide
width
wife
wild
will
win
window
wine
wing
wink
winner
winter
wire
wisdom
wise
wish
witness
wolf
woman
wonder
wood
wool
word
work
world
worry
worth
wrap
wreck
wrestle
wrist
write
wrong
yard
year
yellow
you
young
youth
zebra
zero
zone
zoo`.split("\n");

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
      const pad = new Uint8Array(blockLen);
      pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i2 = 0; i2 < pad.length; i2++)
        pad[i2] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i2 = 0; i2 < pad.length; i2++)
        pad[i2] ^= 54 ^ 92;
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
        for (let i2 = 0; i2 < Ti.length; i2++)
          Ti[i2] ^= u[i2];
      }
    }
    return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
  }

  // node_modules/@noble/hashes/_md.js
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }
  var HashMD = class {
    constructor(blockLen, outputLen, padOffset, isLE) {
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
      for (let i2 = pos; i2 < blockLen; i2++)
        buffer[i2] = 0;
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
      for (let i2 = 0; i2 < outLen; i2++)
        oview.setUint32(4 * i2, state[i2], isLE);
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
    for (let i2 = 0; i2 < len; i2++) {
      const { h, l } = fromBig(lst[i2], le);
      [Ah[i2], Al[i2]] = [h, l];
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
      for (let i2 = 0; i2 < 16; i2++, offset += 4)
        SHA256_W[i2] = view.getUint32(offset, false);
      for (let i2 = 16; i2 < 64; i2++) {
        const W15 = SHA256_W[i2 - 15];
        const W2 = SHA256_W[i2 - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i2] = s1 + SHA256_W[i2 - 7] + s0 + SHA256_W[i2 - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i2 = 0; i2 < 64; i2++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i2] + SHA256_W[i2] | 0;
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
      for (let i2 = 0; i2 < 16; i2++, offset += 4) {
        SHA512_W_H[i2] = view.getUint32(offset);
        SHA512_W_L[i2] = view.getUint32(offset += 4);
      }
      for (let i2 = 16; i2 < 80; i2++) {
        const W15h = SHA512_W_H[i2 - 15] | 0;
        const W15l = SHA512_W_L[i2 - 15] | 0;
        const s0h = rotrSH(W15h, W15l, 1) ^ rotrSH(W15h, W15l, 8) ^ shrSH(W15h, W15l, 7);
        const s0l = rotrSL(W15h, W15l, 1) ^ rotrSL(W15h, W15l, 8) ^ shrSL(W15h, W15l, 7);
        const W2h = SHA512_W_H[i2 - 2] | 0;
        const W2l = SHA512_W_L[i2 - 2] | 0;
        const s1h = rotrSH(W2h, W2l, 19) ^ rotrBH(W2h, W2l, 61) ^ shrSH(W2h, W2l, 6);
        const s1l = rotrSL(W2h, W2l, 19) ^ rotrBL(W2h, W2l, 61) ^ shrSL(W2h, W2l, 6);
        const SUMl = add4L(s0l, s1l, SHA512_W_L[i2 - 7], SHA512_W_L[i2 - 16]);
        const SUMh = add4H(SUMl, s0h, s1h, SHA512_W_H[i2 - 7], SHA512_W_H[i2 - 16]);
        SHA512_W_H[i2] = SUMh | 0;
        SHA512_W_L[i2] = SUMl | 0;
      }
      let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
      for (let i2 = 0; i2 < 80; i2++) {
        const sigma1h = rotrSH(Eh, El, 14) ^ rotrSH(Eh, El, 18) ^ rotrBH(Eh, El, 41);
        const sigma1l = rotrSL(Eh, El, 14) ^ rotrSL(Eh, El, 18) ^ rotrBL(Eh, El, 41);
        const CHIh = Eh & Fh ^ ~Eh & Gh;
        const CHIl = El & Fl ^ ~El & Gl;
        const T1ll = add5L(Hl, sigma1l, CHIl, SHA512_Kl[i2], SHA512_W_L[i2]);
        const T1h = add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i2], SHA512_W_H[i2]);
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

  // node_modules/@scure/base/index.js
  function isBytes2(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
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
  function anumber2(n) {
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
    const encode2 = args.map((x) => x.encode).reduceRight(wrap, id);
    const decode2 = args.map((x) => x.decode).reduce(wrap, id);
    return { encode: encode2, decode: decode2 };
  }
  // @__NO_SIDE_EFFECTS__
  function alphabet(letters) {
    const lettersA = typeof letters === "string" ? letters.split("") : letters;
    const len = lettersA.length;
    astrArr("alphabet", lettersA);
    const indexes = new Map(lettersA.map((l, i2) => [l, i2]));
    return {
      encode: (digits) => {
        aArr(digits);
        return digits.map((i2) => {
          if (!Number.isSafeInteger(i2) || i2 < 0 || i2 >= len)
            throw new Error(`alphabet.encode: digit index outside alphabet "${i2}". Allowed: ${letters}`);
          return lettersA[i2];
        });
      },
      decode: (input) => {
        aArr(input);
        return input.map((letter) => {
          astr("alphabet.decode", letter);
          const i2 = indexes.get(letter);
          if (i2 === void 0)
            throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
          return i2;
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
    anumber2(bits);
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
      anumber2(d);
      if (d < 0 || d >= from)
        throw new Error(`invalid integer: ${d}`);
      return d;
    });
    const dlen = digits.length;
    while (true) {
      let carry = 0;
      let done = true;
      for (let i2 = pos; i2 < dlen; i2++) {
        const digit = digits[i2];
        const fromCarry = from * carry;
        const digitBase = fromCarry + digit;
        if (!Number.isSafeInteger(digitBase) || fromCarry / from !== carry || digitBase - digit !== fromCarry) {
          throw new Error("convertRadix: carry overflow");
        }
        const div = digitBase / to;
        carry = digitBase % to;
        const rounded = Math.floor(div);
        digits[i2] = rounded;
        if (!Number.isSafeInteger(rounded) || rounded * to + carry !== digitBase)
          throw new Error("convertRadix: carry overflow");
        if (!done)
          continue;
        else if (!rounded)
          pos = i2;
        else
          done = false;
      }
      res.push(carry);
      if (done)
        break;
    }
    for (let i2 = 0; i2 < data.length - 1 && data[i2] === 0; i2++)
      res.push(0);
    return res.reverse();
  }
  var gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
  var radix2carry = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd(from, to));
  var powers = /* @__PURE__ */ (() => {
    let res = [];
    for (let i2 = 0; i2 < 40; i2++)
      res.push(2 ** i2);
    return res;
  })();
  function convertRadix2(data, from, to, padding3) {
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
      anumber2(n);
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
    if (!padding3 && pos >= from)
      throw new Error("Excess padding");
    if (!padding3 && carry > 0)
      throw new Error(`Non-zero padding: ${carry}`);
    if (padding3 && pos > 0)
      res.push(carry >>> 0);
    return res;
  }
  // @__NO_SIDE_EFFECTS__
  function radix(num2) {
    anumber2(num2);
    const _256 = 2 ** 8;
    return {
      encode: (bytes) => {
        if (!isBytes2(bytes))
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
    anumber2(bits);
    if (bits <= 0 || bits > 32)
      throw new Error("radix2: bits should be in (0..32]");
    if (/* @__PURE__ */ radix2carry(8, bits) > 32 || /* @__PURE__ */ radix2carry(bits, 8) > 32)
      throw new Error("radix2: carry overflow");
    return {
      encode: (bytes) => {
        if (!isBytes2(bytes))
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
    anumber2(len);
    afn(fn);
    return {
      encode(data) {
        if (!isBytes2(data))
          throw new Error("checksum.encode: input should be Uint8Array");
        const sum = fn(data).slice(0, len);
        const res = new Uint8Array(data.length + len);
        res.set(data);
        res.set(sum, data.length);
        return res;
      },
      decode(data) {
        if (!isBytes2(data))
          throw new Error("checksum.decode: input should be Uint8Array");
        const payload = data.slice(0, -len);
        const oldChecksum = data.slice(-len);
        const newChecksum = fn(payload).slice(0, len);
        for (let i2 = 0; i2 < len; i2++)
          if (newChecksum[i2] !== oldChecksum[i2])
            throw new Error("Invalid checksum");
        return payload;
      }
    };
  }
  var utils = {
    alphabet,
    chain,
    checksum,
    convertRadix,
    convertRadix2,
    radix,
    radix2,
    join,
    padding
  };
  var genBase58 = /* @__NO_SIDE_EFFECTS__ */ (abc) => /* @__PURE__ */ chain(/* @__PURE__ */ radix(58), /* @__PURE__ */ alphabet(abc), /* @__PURE__ */ join(""));
  var base58 = /* @__PURE__ */ genBase58("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");
  var createBase58check = (sha2563) => /* @__PURE__ */ chain(checksum(4, (data) => sha2563(sha2563(data))), base58);
  var BECH_ALPHABET = /* @__PURE__ */ chain(/* @__PURE__ */ alphabet("qpzry9x8gf2tvdw0s3jn54khce6mua7l"), /* @__PURE__ */ join(""));
  var POLYMOD_GENERATORS = [996825010, 642813549, 513874426, 1027748829, 705979059];
  function bech32Polymod(pre) {
    const b = pre >> 25;
    let chk = (pre & 33554431) << 5;
    for (let i2 = 0; i2 < POLYMOD_GENERATORS.length; i2++) {
      if ((b >> i2 & 1) === 1)
        chk ^= POLYMOD_GENERATORS[i2];
    }
    return chk;
  }
  function bechChecksum(prefix, words, encodingConst = 1) {
    const len = prefix.length;
    let chk = 1;
    for (let i2 = 0; i2 < len; i2++) {
      const c = prefix.charCodeAt(i2);
      if (c < 33 || c > 126)
        throw new Error(`Invalid prefix (${prefix})`);
      chk = bech32Polymod(chk) ^ c >> 5;
    }
    chk = bech32Polymod(chk);
    for (let i2 = 0; i2 < len; i2++)
      chk = bech32Polymod(chk) ^ prefix.charCodeAt(i2) & 31;
    for (let v of words)
      chk = bech32Polymod(chk) ^ v;
    for (let i2 = 0; i2 < 6; i2++)
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
    function encode2(prefix, words, limit = 90) {
      astr("bech32.encode prefix", prefix);
      if (isBytes2(words))
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
      return encode2(prefix, toWords(bytes));
    }
    return {
      encode: encode2,
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

  // node_modules/nostr-tools/node_modules/@scure/bip39/index.js
  var isJapanese = (wordlist3) => wordlist3[0] === "\u3042\u3044\u3053\u304F\u3057\u3093";
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
  function aentropy(ent) {
    abytes(ent);
    if (![16, 20, 24, 28, 32].includes(ent.length))
      throw new Error("invalid entropy length");
  }
  function generateMnemonic(wordlist3, strength = 128) {
    anumber(strength);
    if (strength % 32 !== 0 || strength > 256)
      throw new TypeError("Invalid entropy");
    return entropyToMnemonic(randomBytes(strength / 8), wordlist3);
  }
  var calcChecksum = (entropy) => {
    const bitsLeft = 8 - entropy.length / 4;
    return new Uint8Array([sha256(entropy)[0] >> bitsLeft << bitsLeft]);
  };
  function getCoder(wordlist3) {
    if (!Array.isArray(wordlist3) || wordlist3.length !== 2048 || typeof wordlist3[0] !== "string")
      throw new Error("Wordlist: expected array of 2048 strings");
    wordlist3.forEach((i2) => {
      if (typeof i2 !== "string")
        throw new Error("wordlist: non-string element: " + i2);
    });
    return utils.chain(utils.checksum(1, calcChecksum), utils.radix2(11, true), utils.alphabet(wordlist3));
  }
  function entropyToMnemonic(entropy, wordlist3) {
    aentropy(entropy);
    const words = getCoder(wordlist3).encode(entropy);
    return words.join(isJapanese(wordlist3) ? "\u3000" : " ");
  }
  var psalt = (passphrase) => nfkd("mnemonic" + passphrase);
  function mnemonicToSeedSync(mnemonic, passphrase = "") {
    return pbkdf2(sha512, normalize(mnemonic).nfkd, psalt(passphrase), { c: 2048, dkLen: 64 });
  }

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
    return Uint8Array.from(ascii, (c, i2) => {
      const charCode = c.charCodeAt(0);
      if (c.length !== 1 || charCode > 127) {
        throw new Error(`string contains non-ASCII character "${ascii[i2]}" with code ${charCode} at position ${i2}`);
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
    let i2 = 0;
    const reset = () => {
      v.fill(1);
      k.fill(0);
      i2 = 0;
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
      if (i2++ >= _maxDrbgIters)
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
    const gcd3 = b;
    if (gcd3 !== _1n2)
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
    const i2 = Fp.mul(Fp.mul(nv, _2n), v);
    const root = Fp.mul(nv, Fp.sub(i2, Fp.ONE));
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
        let i2 = 1;
        let t_tmp = Fp.sqr(t);
        while (!Fp.eql(t_tmp, Fp.ONE)) {
          i2++;
          t_tmp = Fp.sqr(t_tmp);
          if (i2 === M)
            throw new Error("Cannot find square root");
        }
        const exponent = _1n2 << BigInt(M - i2 - 1);
        const b = Fp.pow(c, exponent);
        M = i2;
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
    const multipliedAcc = nums.reduce((acc, num2, i2) => {
      if (Fp.is0(num2))
        return acc;
      inverted[i2] = acc;
      return Fp.mul(acc, num2);
    }, Fp.ONE);
    const invertedAcc = Fp.inv(multipliedAcc);
    nums.reduceRight((acc, num2, i2) => {
      if (Fp.is0(num2))
        return acc;
      inverted[i2] = Fp.mul(acc, inverted[i2]);
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
      const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
      if (allowedLengths) {
        if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
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
  function mapHashToField(key, fieldOrder, isLE = false) {
    abytes(key);
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = getMinHashLength(fieldOrder);
    if (len < 16 || len < minLen || len > 1024)
      throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
    const num2 = isLE ? bytesToNumberLE(key) : bytesToNumberBE(key);
    const reduced = mod(num2, fieldOrder - _1n2) + _1n2;
    return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
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
    return points.map((p, i2) => c.fromAffine(p.toAffine(invertedZs[i2])));
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
        for (let i2 = 1; i2 < windowSize; i2++) {
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
  function createKeygen(randomSecretKey, getPublicKey2) {
    return function keygen(seed) {
      const secretKey = randomSecretKey(seed);
      return { secretKey, publicKey: getPublicKey2(secretKey) };
    };
  }

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
    function getPublicKey2(secretKey, isCompressed = true) {
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
    const utils3 = {
      isValidSecretKey,
      isValidPublicKey,
      randomSecretKey
    };
    const keygen = createKeygen(randomSecretKey, getPublicKey2);
    return Object.freeze({ getPublicKey: getPublicKey2, getSharedSecret, keygen, Point: Point2, utils: utils3, lengths });
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
    const { keygen, getPublicKey: getPublicKey2, getSharedSecret, utils: utils3, lengths } = ecdh(Point2, ecdsaOpts);
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
      getPublicKey: getPublicKey2,
      getSharedSecret,
      utils: utils3,
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
    const pub = abytes(publicKey, 32, "publicKey");
    try {
      const P = lift_x(num(pub));
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
  var Id160 = /* @__PURE__ */ (() => Uint8Array.from(new Array(16).fill(0).map((_, i2) => i2)))();
  var Pi160 = /* @__PURE__ */ (() => Id160.map((i2) => (9 * i2 + 5) % 16))();
  var idxLR = /* @__PURE__ */ (() => {
    const L = [Id160];
    const R = [Pi160];
    const res = [L, R];
    for (let i2 = 0; i2 < 4; i2++)
      for (let j of res)
        j.push(j[i2].map((k) => Rho160[k]));
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
  ].map((i2) => Uint8Array.from(i2));
  var shiftsL160 = /* @__PURE__ */ idxL.map((idx, i2) => idx.map((j) => shifts160[i2][j]));
  var shiftsR160 = /* @__PURE__ */ idxR.map((idx, i2) => idx.map((j) => shifts160[i2][j]));
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
      for (let i2 = 0; i2 < 16; i2++, offset += 4)
        BUF_160[i2] = view.getUint32(offset, true);
      let al = this.h0 | 0, ar = al, bl = this.h1 | 0, br = bl, cl = this.h2 | 0, cr = cl, dl = this.h3 | 0, dr = dl, el = this.h4 | 0, er = el;
      for (let group = 0; group < 5; group++) {
        const rGroup = 4 - group;
        const hbl = Kl160[group], hbr = Kr160[group];
        const rl = idxL[group], rr = idxR[group];
        const sl = shiftsL160[group], sr = shiftsR160[group];
        for (let i2 = 0; i2 < 16; i2++) {
          const tl = rotl(al + ripemd_f(group, bl, cl, dl) + BUF_160[rl[i2]] + hbl, sl[i2]) + el | 0;
          al = el, el = dl, dl = rotl(cl, 10) | 0, cl = bl, bl = tl;
        }
        for (let i2 = 0; i2 < 16; i2++) {
          const tr = rotl(ar + ripemd_f(rGroup, br, cr, dr) + BUF_160[rr[i2]] + hbr, sr[i2]) + er | 0;
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
  function generateSeedWords() {
    return generateMnemonic(wordlist);
  }

  // node_modules/nostr-tools/lib/esm/pure.js
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
    for (let i2 = 0; i2 < event.tags.length; i2++) {
      let tag = event.tags[i2];
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

  // node_modules/nostr-tools/lib/esm/nip19.js
  var utf8Decoder2 = new TextDecoder("utf-8");
  var utf8Encoder2 = new TextEncoder();
  var Bech32MaxSize = 5e3;
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

  // node_modules/@scure/bip39/node_modules/@noble/hashes/utils.js
  function isBytes3(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  function abytes2(value, length, title = "") {
    const bytes = isBytes3(value);
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
  function aexists2(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput2(out, instance) {
    abytes2(out, void 0, "digestInto() output");
    const min = instance.outputLen;
    if (out.length < min) {
      throw new RangeError('"digestInto() output" expected to be of length >=' + min);
    }
  }
  function clean2(...arrays) {
    for (let i2 = 0; i2 < arrays.length; i2++) {
      arrays[i2].fill(0);
    }
  }
  function createView2(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr2(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  function createHasher2(hashCons, info = {}) {
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.canXOF = tmp.canXOF;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  var oidNist2 = (suffix) => ({
    // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
    // Larger suffix values would need base-128 OID encoding and a different length byte.
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
  });

  // node_modules/@scure/bip39/node_modules/@noble/hashes/_md.js
  function Chi2(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj2(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }
  var HashMD2 = class {
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
      this.view = createView2(this.buffer);
    }
    update(data) {
      aexists2(this);
      abytes2(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView2(data);
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
      aexists2(this);
      aoutput2(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      clean2(this.buffer.subarray(pos));
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i2 = pos; i2 < blockLen; i2++)
        buffer[i2] = 0;
      view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
      this.process(view, 0);
      const oview = createView2(out);
      const len = this.outputLen;
      if (len % 4)
        throw new Error("_sha2: outputLen must be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i2 = 0; i2 < outLen; i2++)
        oview.setUint32(4 * i2, state[i2], isLE);
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
  var SHA256_IV2 = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);

  // node_modules/@scure/bip39/node_modules/@noble/hashes/sha2.js
  var SHA256_K2 = /* @__PURE__ */ Uint32Array.from([
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
  var SHA256_W2 = /* @__PURE__ */ new Uint32Array(64);
  var SHA2_32B2 = class extends HashMD2 {
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
      for (let i2 = 0; i2 < 16; i2++, offset += 4)
        SHA256_W2[i2] = view.getUint32(offset, false);
      for (let i2 = 16; i2 < 64; i2++) {
        const W15 = SHA256_W2[i2 - 15];
        const W2 = SHA256_W2[i2 - 2];
        const s0 = rotr2(W15, 7) ^ rotr2(W15, 18) ^ W15 >>> 3;
        const s1 = rotr2(W2, 17) ^ rotr2(W2, 19) ^ W2 >>> 10;
        SHA256_W2[i2] = s1 + SHA256_W2[i2 - 7] + s0 + SHA256_W2[i2 - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i2 = 0; i2 < 64; i2++) {
        const sigma1 = rotr2(E, 6) ^ rotr2(E, 11) ^ rotr2(E, 25);
        const T1 = H + sigma1 + Chi2(E, F, G) + SHA256_K2[i2] + SHA256_W2[i2] | 0;
        const sigma0 = rotr2(A, 2) ^ rotr2(A, 13) ^ rotr2(A, 22);
        const T2 = sigma0 + Maj2(A, B, C) | 0;
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
      clean2(SHA256_W2);
    }
    destroy() {
      this.destroyed = true;
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      clean2(this.buffer);
    }
  };
  var _SHA2562 = class extends SHA2_32B2 {
    constructor() {
      super(32);
      // We cannot use array here since array allows indexing by variable
      // which means optimizer/compiler cannot use registers.
      __publicField(this, "A", SHA256_IV2[0] | 0);
      __publicField(this, "B", SHA256_IV2[1] | 0);
      __publicField(this, "C", SHA256_IV2[2] | 0);
      __publicField(this, "D", SHA256_IV2[3] | 0);
      __publicField(this, "E", SHA256_IV2[4] | 0);
      __publicField(this, "F", SHA256_IV2[5] | 0);
      __publicField(this, "G", SHA256_IV2[6] | 0);
      __publicField(this, "H", SHA256_IV2[7] | 0);
    }
  };
  var sha2562 = /* @__PURE__ */ createHasher2(
    () => new _SHA2562(),
    /* @__PURE__ */ oidNist2(1)
  );

  // node_modules/@scure/bip39/node_modules/@scure/base/index.js
  function isBytes4(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  function isArrayOf2(isString, arr) {
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
  function afn2(input) {
    if (typeof input !== "function")
      throw new TypeError("function expected");
    return true;
  }
  function astr2(label, input) {
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
  function aArr2(input) {
    if (!Array.isArray(input))
      throw new TypeError("array expected");
  }
  function astrArr2(label, input) {
    if (!isArrayOf2(true, input))
      throw new TypeError(`${label}: array of strings expected`);
  }
  function anumArr2(label, input) {
    if (!isArrayOf2(false, input))
      throw new TypeError(`${label}: array of numbers expected`);
  }
  // @__NO_SIDE_EFFECTS__
  function chain2(...args) {
    const id = (a) => a;
    const wrap = (a, b) => (c) => a(b(c));
    const encode2 = args.map((x) => x.encode).reduceRight(wrap, id);
    const decode2 = args.map((x) => x.decode).reduce(wrap, id);
    return { encode: encode2, decode: decode2 };
  }
  // @__NO_SIDE_EFFECTS__
  function alphabet2(letters) {
    const lettersA = typeof letters === "string" ? letters.split("") : letters;
    const len = lettersA.length;
    astrArr2("alphabet", lettersA);
    const indexes = new Map(lettersA.map((l, i2) => [l, i2]));
    return {
      encode: (digits) => {
        aArr2(digits);
        return digits.map((i2) => {
          if (!Number.isSafeInteger(i2) || i2 < 0 || i2 >= len)
            throw new Error(`alphabet.encode: digit index outside alphabet "${i2}". Allowed: ${letters}`);
          return lettersA[i2];
        });
      },
      decode: (input) => {
        aArr2(input);
        return input.map((letter) => {
          astr2("alphabet.decode", letter);
          const i2 = indexes.get(letter);
          if (i2 === void 0)
            throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
          return i2;
        });
      }
    };
  }
  // @__NO_SIDE_EFFECTS__
  function join2(separator = "") {
    astr2("join", separator);
    return {
      encode: (from) => {
        astrArr2("join.decode", from);
        return from.join(separator);
      },
      decode: (to) => {
        astr2("join.decode", to);
        return to.split(separator);
      }
    };
  }
  // @__NO_SIDE_EFFECTS__
  function padding2(bits, chr = "=") {
    anumber3(bits);
    astr2("padding", chr);
    return {
      encode(data) {
        astrArr2("padding.encode", data);
        while (data.length * bits % 8)
          data.push(chr);
        return data;
      },
      decode(input) {
        astrArr2("padding.decode", input);
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
  function convertRadix3(data, from, to) {
    if (from < 2)
      throw new RangeError(`convertRadix: invalid from=${from}, base cannot be less than 2`);
    if (to < 2)
      throw new RangeError(`convertRadix: invalid to=${to}, base cannot be less than 2`);
    aArr2(data);
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
      for (let i2 = pos; i2 < dlen; i2++) {
        const digit = digits[i2];
        const fromCarry = from * carry;
        const digitBase = fromCarry + digit;
        if (!Number.isSafeInteger(digitBase) || fromCarry / from !== carry || digitBase - digit !== fromCarry) {
          throw new Error("convertRadix: carry overflow");
        }
        const div = digitBase / to;
        carry = digitBase % to;
        const rounded = Math.floor(div);
        digits[i2] = rounded;
        if (!Number.isSafeInteger(rounded) || rounded * to + carry !== digitBase)
          throw new Error("convertRadix: carry overflow");
        if (!done)
          continue;
        else if (!rounded)
          pos = i2;
        else
          done = false;
      }
      res.push(carry);
      if (done)
        break;
    }
    for (let i2 = 0; i2 < data.length - 1 && data[i2] === 0; i2++)
      res.push(0);
    return res.reverse();
  }
  var gcd2 = (a, b) => b === 0 ? a : gcd2(b, a % b);
  var radix2carry2 = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd2(from, to));
  var powers2 = /* @__PURE__ */ (() => {
    let res = [];
    for (let i2 = 0; i2 < 40; i2++)
      res.push(2 ** i2);
    return res;
  })();
  function convertRadix22(data, from, to, padding3) {
    aArr2(data);
    if (from <= 0 || from > 32)
      throw new RangeError(`convertRadix2: wrong from=${from}`);
    if (to <= 0 || to > 32)
      throw new RangeError(`convertRadix2: wrong to=${to}`);
    if (/* @__PURE__ */ radix2carry2(from, to) > 32) {
      throw new Error(`convertRadix2: carry overflow from=${from} to=${to} carryBits=${/* @__PURE__ */ radix2carry2(from, to)}`);
    }
    let carry = 0;
    let pos = 0;
    const max = powers2[from];
    const mask = powers2[to] - 1;
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
      const pow = powers2[pos];
      if (pow === void 0)
        throw new Error("invalid carry");
      carry &= pow - 1;
    }
    carry = carry << to - pos & mask;
    if (!padding3 && pos >= from)
      throw new Error("Excess padding");
    if (!padding3 && carry > 0)
      throw new Error(`Non-zero padding: ${carry}`);
    if (padding3 && pos > 0)
      res.push(carry >>> 0);
    return res;
  }
  // @__NO_SIDE_EFFECTS__
  function radix3(num2) {
    anumber3(num2);
    const _256 = 2 ** 8;
    return {
      encode: (bytes) => {
        if (!isBytes4(bytes))
          throw new TypeError("radix.encode input should be Uint8Array");
        return convertRadix3(Array.from(bytes), _256, num2);
      },
      decode: (digits) => {
        anumArr2("radix.decode", digits);
        return Uint8Array.from(convertRadix3(digits, num2, _256));
      }
    };
  }
  // @__NO_SIDE_EFFECTS__
  function radix22(bits, revPadding = false) {
    anumber3(bits);
    if (bits <= 0 || bits > 32)
      throw new RangeError("radix2: bits should be in (0..32]");
    if (/* @__PURE__ */ radix2carry2(8, bits) > 32 || /* @__PURE__ */ radix2carry2(bits, 8) > 32)
      throw new RangeError("radix2: carry overflow");
    return {
      encode: (bytes) => {
        if (!isBytes4(bytes))
          throw new TypeError("radix2.encode input should be Uint8Array");
        return convertRadix22(Array.from(bytes), 8, bits, !revPadding);
      },
      decode: (digits) => {
        anumArr2("radix2.decode", digits);
        return Uint8Array.from(convertRadix22(digits, bits, 8, revPadding));
      }
    };
  }
  function checksum2(len, fn) {
    anumber3(len);
    if (len <= 0)
      throw new RangeError(`checksum length must be positive: ${len}`);
    afn2(fn);
    const _fn = fn;
    return {
      encode(data) {
        if (!isBytes4(data))
          throw new TypeError("checksum.encode: input should be Uint8Array");
        const sum = _fn(data).slice(0, len);
        const res = new Uint8Array(data.length + len);
        res.set(data);
        res.set(sum, data.length);
        return res;
      },
      decode(data) {
        if (!isBytes4(data))
          throw new TypeError("checksum.decode: input should be Uint8Array");
        const payload = data.slice(0, -len);
        const oldChecksum = data.slice(-len);
        const newChecksum = _fn(payload).slice(0, len);
        for (let i2 = 0; i2 < len; i2++)
          if (newChecksum[i2] !== oldChecksum[i2])
            throw new Error("Invalid checksum");
        return payload;
      }
    };
  }
  var utils2 = /* @__PURE__ */ Object.freeze({
    alphabet: alphabet2,
    chain: chain2,
    checksum: checksum2,
    convertRadix: convertRadix3,
    convertRadix2: convertRadix22,
    radix: radix3,
    radix2: radix22,
    join: join2,
    padding: padding2
  });

  // node_modules/@scure/bip39/index.js
  function nfkd2(str) {
    if (typeof str !== "string")
      throw new TypeError("invalid mnemonic type: " + typeof str);
    return str.normalize("NFKD");
  }
  function normalize2(str) {
    const norm = nfkd2(str);
    const words = norm.split(" ");
    if (![12, 15, 18, 21, 24].includes(words.length))
      throw new Error("Invalid mnemonic");
    return { nfkd: norm, words };
  }
  function aentropy2(ent) {
    abytes2(ent);
    if (![16, 20, 24, 28, 32].includes(ent.length))
      throw new RangeError("invalid entropy length");
  }
  var calcChecksum2 = (entropy) => {
    const bitsLeft = 8 - entropy.length / 4;
    return new Uint8Array([sha2562(entropy)[0] >> bitsLeft << bitsLeft]);
  };
  function getCoder2(wordlist3) {
    if (!Array.isArray(wordlist3) || wordlist3.length !== 2048 || typeof wordlist3[0] !== "string")
      throw new TypeError("Wordlist: expected array of 2048 strings");
    wordlist3.forEach((i2) => {
      if (typeof i2 !== "string")
        throw new TypeError("wordlist: non-string element: " + i2);
    });
    return utils2.chain(utils2.checksum(1, calcChecksum2), utils2.radix2(11, true), utils2.alphabet(wordlist3));
  }
  function mnemonicToEntropy(mnemonic, wordlist3) {
    const { words } = normalize2(mnemonic);
    const entropy = getCoder2(wordlist3).decode(words);
    aentropy2(entropy);
    return entropy;
  }
  function validateMnemonic2(mnemonic, wordlist3) {
    try {
      mnemonicToEntropy(mnemonic, wordlist3);
    } catch (e) {
      return false;
    }
    return true;
  }

  // node_modules/@scure/bip39/wordlists/english.js
  var wordlist2 = /* @__PURE__ */ Object.freeze(`abandon
ability
able
about
above
absent
absorb
abstract
absurd
abuse
access
accident
account
accuse
achieve
acid
acoustic
acquire
across
act
action
actor
actress
actual
adapt
add
addict
address
adjust
admit
adult
advance
advice
aerobic
affair
afford
afraid
again
age
agent
agree
ahead
aim
air
airport
aisle
alarm
album
alcohol
alert
alien
all
alley
allow
almost
alone
alpha
already
also
alter
always
amateur
amazing
among
amount
amused
analyst
anchor
ancient
anger
angle
angry
animal
ankle
announce
annual
another
answer
antenna
antique
anxiety
any
apart
apology
appear
apple
approve
april
arch
arctic
area
arena
argue
arm
armed
armor
army
around
arrange
arrest
arrive
arrow
art
artefact
artist
artwork
ask
aspect
assault
asset
assist
assume
asthma
athlete
atom
attack
attend
attitude
attract
auction
audit
august
aunt
author
auto
autumn
average
avocado
avoid
awake
aware
away
awesome
awful
awkward
axis
baby
bachelor
bacon
badge
bag
balance
balcony
ball
bamboo
banana
banner
bar
barely
bargain
barrel
base
basic
basket
battle
beach
bean
beauty
because
become
beef
before
begin
behave
behind
believe
below
belt
bench
benefit
best
betray
better
between
beyond
bicycle
bid
bike
bind
biology
bird
birth
bitter
black
blade
blame
blanket
blast
bleak
bless
blind
blood
blossom
blouse
blue
blur
blush
board
boat
body
boil
bomb
bone
bonus
book
boost
border
boring
borrow
boss
bottom
bounce
box
boy
bracket
brain
brand
brass
brave
bread
breeze
brick
bridge
brief
bright
bring
brisk
broccoli
broken
bronze
broom
brother
brown
brush
bubble
buddy
budget
buffalo
build
bulb
bulk
bullet
bundle
bunker
burden
burger
burst
bus
business
busy
butter
buyer
buzz
cabbage
cabin
cable
cactus
cage
cake
call
calm
camera
camp
can
canal
cancel
candy
cannon
canoe
canvas
canyon
capable
capital
captain
car
carbon
card
cargo
carpet
carry
cart
case
cash
casino
castle
casual
cat
catalog
catch
category
cattle
caught
cause
caution
cave
ceiling
celery
cement
census
century
cereal
certain
chair
chalk
champion
change
chaos
chapter
charge
chase
chat
cheap
check
cheese
chef
cherry
chest
chicken
chief
child
chimney
choice
choose
chronic
chuckle
chunk
churn
cigar
cinnamon
circle
citizen
city
civil
claim
clap
clarify
claw
clay
clean
clerk
clever
click
client
cliff
climb
clinic
clip
clock
clog
close
cloth
cloud
clown
club
clump
cluster
clutch
coach
coast
coconut
code
coffee
coil
coin
collect
color
column
combine
come
comfort
comic
common
company
concert
conduct
confirm
congress
connect
consider
control
convince
cook
cool
copper
copy
coral
core
corn
correct
cost
cotton
couch
country
couple
course
cousin
cover
coyote
crack
cradle
craft
cram
crane
crash
crater
crawl
crazy
cream
credit
creek
crew
cricket
crime
crisp
critic
crop
cross
crouch
crowd
crucial
cruel
cruise
crumble
crunch
crush
cry
crystal
cube
culture
cup
cupboard
curious
current
curtain
curve
cushion
custom
cute
cycle
dad
damage
damp
dance
danger
daring
dash
daughter
dawn
day
deal
debate
debris
decade
december
decide
decline
decorate
decrease
deer
defense
define
defy
degree
delay
deliver
demand
demise
denial
dentist
deny
depart
depend
deposit
depth
deputy
derive
describe
desert
design
desk
despair
destroy
detail
detect
develop
device
devote
diagram
dial
diamond
diary
dice
diesel
diet
differ
digital
dignity
dilemma
dinner
dinosaur
direct
dirt
disagree
discover
disease
dish
dismiss
disorder
display
distance
divert
divide
divorce
dizzy
doctor
document
dog
doll
dolphin
domain
donate
donkey
donor
door
dose
double
dove
draft
dragon
drama
drastic
draw
dream
dress
drift
drill
drink
drip
drive
drop
drum
dry
duck
dumb
dune
during
dust
dutch
duty
dwarf
dynamic
eager
eagle
early
earn
earth
easily
east
easy
echo
ecology
economy
edge
edit
educate
effort
egg
eight
either
elbow
elder
electric
elegant
element
elephant
elevator
elite
else
embark
embody
embrace
emerge
emotion
employ
empower
empty
enable
enact
end
endless
endorse
enemy
energy
enforce
engage
engine
enhance
enjoy
enlist
enough
enrich
enroll
ensure
enter
entire
entry
envelope
episode
equal
equip
era
erase
erode
erosion
error
erupt
escape
essay
essence
estate
eternal
ethics
evidence
evil
evoke
evolve
exact
example
excess
exchange
excite
exclude
excuse
execute
exercise
exhaust
exhibit
exile
exist
exit
exotic
expand
expect
expire
explain
expose
express
extend
extra
eye
eyebrow
fabric
face
faculty
fade
faint
faith
fall
false
fame
family
famous
fan
fancy
fantasy
farm
fashion
fat
fatal
father
fatigue
fault
favorite
feature
february
federal
fee
feed
feel
female
fence
festival
fetch
fever
few
fiber
fiction
field
figure
file
film
filter
final
find
fine
finger
finish
fire
firm
first
fiscal
fish
fit
fitness
fix
flag
flame
flash
flat
flavor
flee
flight
flip
float
flock
floor
flower
fluid
flush
fly
foam
focus
fog
foil
fold
follow
food
foot
force
forest
forget
fork
fortune
forum
forward
fossil
foster
found
fox
fragile
frame
frequent
fresh
friend
fringe
frog
front
frost
frown
frozen
fruit
fuel
fun
funny
furnace
fury
future
gadget
gain
galaxy
gallery
game
gap
garage
garbage
garden
garlic
garment
gas
gasp
gate
gather
gauge
gaze
general
genius
genre
gentle
genuine
gesture
ghost
giant
gift
giggle
ginger
giraffe
girl
give
glad
glance
glare
glass
glide
glimpse
globe
gloom
glory
glove
glow
glue
goat
goddess
gold
good
goose
gorilla
gospel
gossip
govern
gown
grab
grace
grain
grant
grape
grass
gravity
great
green
grid
grief
grit
grocery
group
grow
grunt
guard
guess
guide
guilt
guitar
gun
gym
habit
hair
half
hammer
hamster
hand
happy
harbor
hard
harsh
harvest
hat
have
hawk
hazard
head
health
heart
heavy
hedgehog
height
hello
helmet
help
hen
hero
hidden
high
hill
hint
hip
hire
history
hobby
hockey
hold
hole
holiday
hollow
home
honey
hood
hope
horn
horror
horse
hospital
host
hotel
hour
hover
hub
huge
human
humble
humor
hundred
hungry
hunt
hurdle
hurry
hurt
husband
hybrid
ice
icon
idea
identify
idle
ignore
ill
illegal
illness
image
imitate
immense
immune
impact
impose
improve
impulse
inch
include
income
increase
index
indicate
indoor
industry
infant
inflict
inform
inhale
inherit
initial
inject
injury
inmate
inner
innocent
input
inquiry
insane
insect
inside
inspire
install
intact
interest
into
invest
invite
involve
iron
island
isolate
issue
item
ivory
jacket
jaguar
jar
jazz
jealous
jeans
jelly
jewel
job
join
joke
journey
joy
judge
juice
jump
jungle
junior
junk
just
kangaroo
keen
keep
ketchup
key
kick
kid
kidney
kind
kingdom
kiss
kit
kitchen
kite
kitten
kiwi
knee
knife
knock
know
lab
label
labor
ladder
lady
lake
lamp
language
laptop
large
later
latin
laugh
laundry
lava
law
lawn
lawsuit
layer
lazy
leader
leaf
learn
leave
lecture
left
leg
legal
legend
leisure
lemon
lend
length
lens
leopard
lesson
letter
level
liar
liberty
library
license
life
lift
light
like
limb
limit
link
lion
liquid
list
little
live
lizard
load
loan
lobster
local
lock
logic
lonely
long
loop
lottery
loud
lounge
love
loyal
lucky
luggage
lumber
lunar
lunch
luxury
lyrics
machine
mad
magic
magnet
maid
mail
main
major
make
mammal
man
manage
mandate
mango
mansion
manual
maple
marble
march
margin
marine
market
marriage
mask
mass
master
match
material
math
matrix
matter
maximum
maze
meadow
mean
measure
meat
mechanic
medal
media
melody
melt
member
memory
mention
menu
mercy
merge
merit
merry
mesh
message
metal
method
middle
midnight
milk
million
mimic
mind
minimum
minor
minute
miracle
mirror
misery
miss
mistake
mix
mixed
mixture
mobile
model
modify
mom
moment
monitor
monkey
monster
month
moon
moral
more
morning
mosquito
mother
motion
motor
mountain
mouse
move
movie
much
muffin
mule
multiply
muscle
museum
mushroom
music
must
mutual
myself
mystery
myth
naive
name
napkin
narrow
nasty
nation
nature
near
neck
need
negative
neglect
neither
nephew
nerve
nest
net
network
neutral
never
news
next
nice
night
noble
noise
nominee
noodle
normal
north
nose
notable
note
nothing
notice
novel
now
nuclear
number
nurse
nut
oak
obey
object
oblige
obscure
observe
obtain
obvious
occur
ocean
october
odor
off
offer
office
often
oil
okay
old
olive
olympic
omit
once
one
onion
online
only
open
opera
opinion
oppose
option
orange
orbit
orchard
order
ordinary
organ
orient
original
orphan
ostrich
other
outdoor
outer
output
outside
oval
oven
over
own
owner
oxygen
oyster
ozone
pact
paddle
page
pair
palace
palm
panda
panel
panic
panther
paper
parade
parent
park
parrot
party
pass
patch
path
patient
patrol
pattern
pause
pave
payment
peace
peanut
pear
peasant
pelican
pen
penalty
pencil
people
pepper
perfect
permit
person
pet
phone
photo
phrase
physical
piano
picnic
picture
piece
pig
pigeon
pill
pilot
pink
pioneer
pipe
pistol
pitch
pizza
place
planet
plastic
plate
play
please
pledge
pluck
plug
plunge
poem
poet
point
polar
pole
police
pond
pony
pool
popular
portion
position
possible
post
potato
pottery
poverty
powder
power
practice
praise
predict
prefer
prepare
present
pretty
prevent
price
pride
primary
print
priority
prison
private
prize
problem
process
produce
profit
program
project
promote
proof
property
prosper
protect
proud
provide
public
pudding
pull
pulp
pulse
pumpkin
punch
pupil
puppy
purchase
purity
purpose
purse
push
put
puzzle
pyramid
quality
quantum
quarter
question
quick
quit
quiz
quote
rabbit
raccoon
race
rack
radar
radio
rail
rain
raise
rally
ramp
ranch
random
range
rapid
rare
rate
rather
raven
raw
razor
ready
real
reason
rebel
rebuild
recall
receive
recipe
record
recycle
reduce
reflect
reform
refuse
region
regret
regular
reject
relax
release
relief
rely
remain
remember
remind
remove
render
renew
rent
reopen
repair
repeat
replace
report
require
rescue
resemble
resist
resource
response
result
retire
retreat
return
reunion
reveal
review
reward
rhythm
rib
ribbon
rice
rich
ride
ridge
rifle
right
rigid
ring
riot
ripple
risk
ritual
rival
river
road
roast
robot
robust
rocket
romance
roof
rookie
room
rose
rotate
rough
round
route
royal
rubber
rude
rug
rule
run
runway
rural
sad
saddle
sadness
safe
sail
salad
salmon
salon
salt
salute
same
sample
sand
satisfy
satoshi
sauce
sausage
save
say
scale
scan
scare
scatter
scene
scheme
school
science
scissors
scorpion
scout
scrap
screen
script
scrub
sea
search
season
seat
second
secret
section
security
seed
seek
segment
select
sell
seminar
senior
sense
sentence
series
service
session
settle
setup
seven
shadow
shaft
shallow
share
shed
shell
sheriff
shield
shift
shine
ship
shiver
shock
shoe
shoot
shop
short
shoulder
shove
shrimp
shrug
shuffle
shy
sibling
sick
side
siege
sight
sign
silent
silk
silly
silver
similar
simple
since
sing
siren
sister
situate
six
size
skate
sketch
ski
skill
skin
skirt
skull
slab
slam
sleep
slender
slice
slide
slight
slim
slogan
slot
slow
slush
small
smart
smile
smoke
smooth
snack
snake
snap
sniff
snow
soap
soccer
social
sock
soda
soft
solar
soldier
solid
solution
solve
someone
song
soon
sorry
sort
soul
sound
soup
source
south
space
spare
spatial
spawn
speak
special
speed
spell
spend
sphere
spice
spider
spike
spin
spirit
split
spoil
sponsor
spoon
sport
spot
spray
spread
spring
spy
square
squeeze
squirrel
stable
stadium
staff
stage
stairs
stamp
stand
start
state
stay
steak
steel
stem
step
stereo
stick
still
sting
stock
stomach
stone
stool
story
stove
strategy
street
strike
strong
struggle
student
stuff
stumble
style
subject
submit
subway
success
such
sudden
suffer
sugar
suggest
suit
summer
sun
sunny
sunset
super
supply
supreme
sure
surface
surge
surprise
surround
survey
suspect
sustain
swallow
swamp
swap
swarm
swear
sweet
swift
swim
swing
switch
sword
symbol
symptom
syrup
system
table
tackle
tag
tail
talent
talk
tank
tape
target
task
taste
tattoo
taxi
teach
team
tell
ten
tenant
tennis
tent
term
test
text
thank
that
theme
then
theory
there
they
thing
this
thought
three
thrive
throw
thumb
thunder
ticket
tide
tiger
tilt
timber
time
tiny
tip
tired
tissue
title
toast
tobacco
today
toddler
toe
together
toilet
token
tomato
tomorrow
tone
tongue
tonight
tool
tooth
top
topic
topple
torch
tornado
tortoise
toss
total
tourist
toward
tower
town
toy
track
trade
traffic
tragic
train
transfer
trap
trash
travel
tray
treat
tree
trend
trial
tribe
trick
trigger
trim
trip
trophy
trouble
truck
true
truly
trumpet
trust
truth
try
tube
tuition
tumble
tuna
tunnel
turkey
turn
turtle
twelve
twenty
twice
twin
twist
two
type
typical
ugly
umbrella
unable
unaware
uncle
uncover
under
undo
unfair
unfold
unhappy
uniform
unique
unit
universe
unknown
unlock
until
unusual
unveil
update
upgrade
uphold
upon
upper
upset
urban
urge
usage
use
used
useful
useless
usual
utility
vacant
vacuum
vague
valid
valley
valve
van
vanish
vapor
various
vast
vault
vehicle
velvet
vendor
venture
venue
verb
verify
version
very
vessel
veteran
viable
vibrant
vicious
victory
video
view
village
vintage
violin
virtual
virus
visa
visit
visual
vital
vivid
vocal
voice
void
volcano
volume
vote
voyage
wage
wagon
wait
walk
wall
walnut
want
warfare
warm
warrior
wash
wasp
waste
water
wave
way
wealth
weapon
wear
weasel
weather
web
wedding
weekend
weird
welcome
west
wet
whale
what
wheat
wheel
when
where
whip
whisper
wide
width
wife
wild
will
win
window
wine
wing
wink
winner
winter
wire
wisdom
wise
wish
witness
wolf
woman
wonder
wood
wool
word
work
world
worry
worth
wrap
wreck
wrestle
wrist
write
wrong
yard
year
yellow
you
young
youth
zebra
zero
zone
zoo`.split("\n"));

  // src/identity.src.js
  var import_qrcode_generator = __toESM(require_qrcode());
  var STORE_KEY = "trinityone.nostr.mnemonic";
  var HANDLE_POOL = ["Cedar", "River", "Sparrow", "Olive", "Wren", "Maple", "Reed", "Dove", "Ash", "Linden", "Heron", "Bramble"];
  var COLORS = ["#5E8C6A", "#C2913A", "#C25A38", "#5360D6", "#1F9488", "#C24B7A"];
  var memMnemonic = null;
  var webPersisted = false;
  function hashStr(s) {
    let h = 0;
    for (let i2 = 0; i2 < s.length; i2++) h = h * 31 + s.charCodeAt(i2) >>> 0;
    return h;
  }
  function profileFromPub(pubHex) {
    const h = hashStr(pubHex);
    return {
      pubkey: pubHex,
      npub: npubEncode(pubHex),
      handle: "Anonymous " + HANDLE_POOL[h % HANDLE_POOL.length],
      color: COLORS[(h >>> 8) % COLORS.length]
    };
  }
  function isNative() {
    const c = window.Capacitor;
    return !!(c && typeof c.isNativePlatform === "function" && c.isNativePlatform());
  }
  function isEphemeral() {
    return !isNative() && !webPersisted;
  }
  async function secureGet() {
    if (!isNative()) {
      try {
        const v = localStorage.getItem(STORE_KEY);
        if (typeof v === "string" && v) {
          webPersisted = true;
          return v;
        }
      } catch (e) {
      }
      return memMnemonic;
    }
    try {
      const { SecureStorage } = await Promise.resolve().then(() => (init_esm(), esm_exports));
      const v = await SecureStorage.get(STORE_KEY);
      return typeof v === "string" ? v : null;
    } catch (e) {
      console.warn("[identity] secure get failed", e);
      return null;
    }
  }
  async function secureSet(mnemonic) {
    if (!isNative()) {
      memMnemonic = mnemonic;
      try {
        localStorage.setItem(STORE_KEY, mnemonic);
        webPersisted = true;
      } catch (e) {
        webPersisted = false;
      }
      return;
    }
    try {
      const { SecureStorage } = await Promise.resolve().then(() => (init_esm(), esm_exports));
      await SecureStorage.set(STORE_KEY, mnemonic);
    } catch (e) {
      console.warn("[identity] secure set failed", e);
    }
  }
  function deriveProfile(mnemonic) {
    const sk = privateKeyFromSeedWords(mnemonic);
    const pub = getPublicKey(sk);
    return profileFromPub(pub);
  }
  async function init() {
    let mnemonic = await secureGet();
    if (!mnemonic) {
      mnemonic = generateSeedWords();
      await secureSet(mnemonic);
    }
    apply(deriveProfile(mnemonic), { ephemeral: isEphemeral() });
  }
  function apply(profile, meta) {
    window.TrinityIdentity.current = profile;
    window.TrinityIdentity.ephemeral = !!(meta && meta.ephemeral);
    window.dispatchEvent(new CustomEvent("trinity-identity", { detail: profile }));
  }
  window.TrinityIdentity = {
    current: null,
    ephemeral: false,
    ready: null,
    async regenerate() {
      const mnemonic = generateSeedWords();
      await secureSet(mnemonic);
      apply(deriveProfile(mnemonic), { ephemeral: isEphemeral() });
      return window.TrinityIdentity.current;
    },
    copyNpub() {
      const np = window.TrinityIdentity.current && window.TrinityIdentity.current.npub;
      if (np && navigator.clipboard) navigator.clipboard.writeText(np).catch(() => {
      });
      return np;
    },
    // the current identity's 12-word recovery phrase (native: secure store; web: ephemeral)
    async exportMnemonic() {
      return secureGet();
    },
    // restore an identity from a pasted 12-word BIP-39 phrase
    async importMnemonic(words) {
      const m = String(words || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (!validateMnemonic2(m, wordlist2)) throw new Error("That doesn\u2019t look like a valid 12-word recovery phrase.");
      await secureSet(m);
      apply(deriveProfile(m), { ephemeral: isEphemeral() });
      return window.TrinityIdentity.current;
    },
    // steward onboarding: mint a NEW identity to hand to a member (does NOT touch yours)
    makeInvite() {
      const mnemonic = generateSeedWords();
      return { mnemonic, profile: deriveProfile(mnemonic) };
    },
    // render any string as a QR (SVG markup) — used for the steward invite
    qrSVG(text) {
      const qr = (0, import_qrcode_generator.default)(0, "M");
      qr.addData(String(text || ""));
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    }
  };
  window.TrinityIdentity.ready = init().catch((e) => console.error("[identity] init failed", e));
})();
