(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __commonJS = (cb, mod2) => function __require() {
    return mod2 || (0, cb[__getOwnPropNames(cb)[0]])((mod2 = { exports: {} }).exports, mod2), mod2.exports;
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
            for (var i3 = 0; i3 < 8; i3 += 1) {
              makeImpl(true, i3);
              var lostPoint = QRUtil.getLostPoint(_this);
              if (i3 == 0 || minLostPoint > lostPoint) {
                minLostPoint = lostPoint;
                pattern = i3;
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
            for (var i3 = 0; i3 < pos.length; i3 += 1) {
              for (var j = 0; j < pos.length; j += 1) {
                var row = pos[i3];
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
            for (var i3 = 0; i3 < 18; i3 += 1) {
              var mod2 = !test && (bits >> i3 & 1) == 1;
              _modules[Math.floor(i3 / 3)][i3 % 3 + _moduleCount - 8 - 3] = mod2;
            }
            for (var i3 = 0; i3 < 18; i3 += 1) {
              var mod2 = !test && (bits >> i3 & 1) == 1;
              _modules[i3 % 3 + _moduleCount - 8 - 3][Math.floor(i3 / 3)] = mod2;
            }
          };
          var setupTypeInfo = function(test, maskPattern) {
            var data = _errorCorrectionLevel << 3 | maskPattern;
            var bits = QRUtil.getBCHTypeInfo(data);
            for (var i3 = 0; i3 < 15; i3 += 1) {
              var mod2 = !test && (bits >> i3 & 1) == 1;
              if (i3 < 6) {
                _modules[i3][8] = mod2;
              } else if (i3 < 8) {
                _modules[i3 + 1][8] = mod2;
              } else {
                _modules[_moduleCount - 15 + i3][8] = mod2;
              }
            }
            for (var i3 = 0; i3 < 15; i3 += 1) {
              var mod2 = !test && (bits >> i3 & 1) == 1;
              if (i3 < 8) {
                _modules[8][_moduleCount - i3 - 1] = mod2;
              } else if (i3 < 9) {
                _modules[8][15 - i3 - 1 + 1] = mod2;
              } else {
                _modules[8][15 - i3 - 1] = mod2;
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
              for (var i3 = 0; i3 < dcdata[r].length; i3 += 1) {
                dcdata[r][i3] = 255 & buffer.getBuffer()[i3 + offset];
              }
              offset += dcCount;
              var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
              var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
              var modPoly = rawPoly.mod(rsPoly);
              ecdata[r] = new Array(rsPoly.getLength() - 1);
              for (var i3 = 0; i3 < ecdata[r].length; i3 += 1) {
                var modIndex = i3 + modPoly.getLength() - ecdata[r].length;
                ecdata[r][i3] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
              }
            }
            var totalCodeCount = 0;
            for (var i3 = 0; i3 < rsBlocks.length; i3 += 1) {
              totalCodeCount += rsBlocks[i3].totalCount;
            }
            var data = new Array(totalCodeCount);
            var index = 0;
            for (var i3 = 0; i3 < maxDcCount; i3 += 1) {
              for (var r = 0; r < rsBlocks.length; r += 1) {
                if (i3 < dcdata[r].length) {
                  data[index] = dcdata[r][i3];
                  index += 1;
                }
              }
            }
            for (var i3 = 0; i3 < maxEcCount; i3 += 1) {
              for (var r = 0; r < rsBlocks.length; r += 1) {
                if (i3 < ecdata[r].length) {
                  data[index] = ecdata[r][i3];
                  index += 1;
                }
              }
            }
            return data;
          };
          var createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
            var rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
            var buffer = qrBitBuffer();
            for (var i3 = 0; i3 < dataList.length; i3 += 1) {
              var data = dataList[i3];
              buffer.put(data.getMode(), 4);
              buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
              data.write(buffer);
            }
            var totalDataCount = 0;
            for (var i3 = 0; i3 < rsBlocks.length; i3 += 1) {
              totalDataCount += rsBlocks[i3].dataCount;
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
                for (var i3 = 0; i3 < _dataList.length; i3++) {
                  var data = _dataList[i3];
                  buffer.put(data.getMode(), 4);
                  buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
                  data.write(buffer);
                }
                var totalDataCount = 0;
                for (var i3 = 0; i3 < rsBlocks.length; i3++) {
                  totalDataCount += rsBlocks[i3].dataCount;
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
            for (var i3 = 0; i3 < s.length; i3 += 1) {
              var c = s.charAt(i3);
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
            for (var i3 = 0; i3 < s.length; i3 += 1) {
              var c = s.charCodeAt(i3);
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
            for (var i3 = 0; i3 < s.length; i3 += 1) {
              var c = s.charCodeAt(i3);
              if (c < 128) {
                bytes.push(c);
              } else {
                var b = unicodeMap[s.charAt(i3)];
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
                return function(i3, j) {
                  return (i3 + j) % 2 == 0;
                };
              case QRMaskPattern.PATTERN001:
                return function(i3, j) {
                  return i3 % 2 == 0;
                };
              case QRMaskPattern.PATTERN010:
                return function(i3, j) {
                  return j % 3 == 0;
                };
              case QRMaskPattern.PATTERN011:
                return function(i3, j) {
                  return (i3 + j) % 3 == 0;
                };
              case QRMaskPattern.PATTERN100:
                return function(i3, j) {
                  return (Math.floor(i3 / 2) + Math.floor(j / 3)) % 2 == 0;
                };
              case QRMaskPattern.PATTERN101:
                return function(i3, j) {
                  return i3 * j % 2 + i3 * j % 3 == 0;
                };
              case QRMaskPattern.PATTERN110:
                return function(i3, j) {
                  return (i3 * j % 2 + i3 * j % 3) % 2 == 0;
                };
              case QRMaskPattern.PATTERN111:
                return function(i3, j) {
                  return (i3 * j % 3 + (i3 + j) % 2) % 2 == 0;
                };
              default:
                throw "bad maskPattern:" + maskPattern;
            }
          };
          _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
            var a = qrPolynomial([1], 0);
            for (var i3 = 0; i3 < errorCorrectLength; i3 += 1) {
              a = a.multiply(qrPolynomial([1, QRMath.gexp(i3)], 0));
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
          for (var i3 = 0; i3 < 8; i3 += 1) {
            EXP_TABLE[i3] = 1 << i3;
          }
          for (var i3 = 8; i3 < 256; i3 += 1) {
            EXP_TABLE[i3] = EXP_TABLE[i3 - 4] ^ EXP_TABLE[i3 - 5] ^ EXP_TABLE[i3 - 6] ^ EXP_TABLE[i3 - 8];
          }
          for (var i3 = 0; i3 < 255; i3 += 1) {
            LOG_TABLE[EXP_TABLE[i3]] = i3;
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
            for (var i3 = 0; i3 < num2.length - offset; i3 += 1) {
              _num2[i3] = num2[i3 + offset];
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
            for (var i3 = 0; i3 < _this.getLength(); i3 += 1) {
              for (var j = 0; j < e.getLength(); j += 1) {
                num3[i3 + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i3)) + QRMath.glog(e.getAt(j)));
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
            for (var i3 = 0; i3 < _this.getLength(); i3 += 1) {
              num3[i3] = _this.getAt(i3);
            }
            for (var i3 = 0; i3 < e.getLength(); i3 += 1) {
              num3[i3] ^= QRMath.gexp(QRMath.glog(e.getAt(i3)) + ratio);
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
            for (var i3 = 0; i3 < length; i3 += 1) {
              var count = rsBlock[i3 * 3 + 0];
              var totalCount = rsBlock[i3 * 3 + 1];
              var dataCount = rsBlock[i3 * 3 + 2];
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
            for (var i3 = 0; i3 < length; i3 += 1) {
              _this.putBit((num2 >>> length - i3 - 1 & 1) == 1);
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
            var i3 = 0;
            while (i3 + 2 < data2.length) {
              buffer.put(strToNum(data2.substring(i3, i3 + 3)), 10);
              i3 += 3;
            }
            if (i3 < data2.length) {
              if (data2.length - i3 == 1) {
                buffer.put(strToNum(data2.substring(i3, i3 + 1)), 4);
              } else if (data2.length - i3 == 2) {
                buffer.put(strToNum(data2.substring(i3, i3 + 2)), 7);
              }
            }
          };
          var strToNum = function(s) {
            var num2 = 0;
            for (var i3 = 0; i3 < s.length; i3 += 1) {
              num2 = num2 * 10 + chatToNum(s.charAt(i3));
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
            var i3 = 0;
            while (i3 + 1 < s.length) {
              buffer.put(
                getCode(s.charAt(i3)) * 45 + getCode(s.charAt(i3 + 1)),
                11
              );
              i3 += 2;
            }
            if (i3 < s.length) {
              buffer.put(getCode(s.charAt(i3)), 6);
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
            for (var i3 = 0; i3 < _bytes.length; i3 += 1) {
              buffer.put(_bytes[i3], 8);
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
            var i3 = 0;
            while (i3 + 1 < data2.length) {
              var c = (255 & data2[i3]) << 8 | 255 & data2[i3 + 1];
              if (33088 <= c && c <= 40956) {
                c -= 33088;
              } else if (57408 <= c && c <= 60351) {
                c -= 49472;
              } else {
                throw "illegal char at " + (i3 + 1) + "/" + c;
              }
              c = (c >>> 8 & 255) * 192 + (c & 255);
              buffer.put(c, 13);
              i3 += 2;
            }
            if (i3 < data2.length) {
              throw "illegal char at " + (i3 + 1);
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
          _this.writeShort = function(i3) {
            _this.writeByte(i3);
            _this.writeByte(i3 >>> 8);
          };
          _this.writeBytes = function(b, off, len) {
            off = off || 0;
            len = len || b.length;
            for (var i3 = 0; i3 < len; i3 += 1) {
              _this.writeByte(b[i3 + off]);
            }
          };
          _this.writeString = function(s) {
            for (var i3 = 0; i3 < s.length; i3 += 1) {
              _this.writeByte(s.charCodeAt(i3));
            }
          };
          _this.toByteArray = function() {
            return _bytes;
          };
          _this.toString = function() {
            var s = "";
            s += "[";
            for (var i3 = 0; i3 < _bytes.length; i3 += 1) {
              if (i3 > 0) {
                s += ",";
              }
              s += _bytes[i3];
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
            _base64 += String.fromCharCode(encode(b & 63));
          };
          var encode = function(n) {
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
              for (var i3 = 0; i3 < padlen; i3 += 1) {
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
            for (var i3 = 0; i3 < clearCode; i3 += 1) {
              table.add(String.fromCharCode(i3));
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
          var base642 = base64EncodeOutputStream();
          var bytes = b.toByteArray();
          for (var i3 = 0; i3 < bytes.length; i3 += 1) {
            base642.writeByte(bytes[i3]);
          }
          base642.flush();
          return "data:image/gif;base64," + base642;
        };
        return qrcode3;
      })();
      !(function() {
        qrcode2.stringToBytesFuncs["UTF-8"] = function(s) {
          function toUTF8Array(str) {
            var utf8 = [];
            for (var i3 = 0; i3 < str.length; i3++) {
              var charcode = str.charCodeAt(i3);
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
                i3++;
                charcode = 65536 + ((charcode & 1023) << 10 | str.charCodeAt(i3) & 1023);
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
    const utils2 = {
      isValidSecretKey,
      isValidPublicKey,
      randomSecretKey
    };
    const keygen = createKeygen(randomSecretKey, getPublicKey3);
    return Object.freeze({ getPublicKey: getPublicKey3, getSharedSecret, keygen, Point: Point2, utils: utils2, lengths });
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
    const { keygen, getPublicKey: getPublicKey3, getSharedSecret, utils: utils2, lengths } = ecdh(Point2, ecdsaOpts);
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
      utils: utils2,
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
    close(relays2) {
      relays2.map(normalizeURL).forEach((url) => {
        this.relays.get(url)?.close();
        this.relays.delete(url);
      });
    }
    subscribe(relays2, filter, params) {
      const request = [];
      const uniqUrls = [];
      for (let i22 = 0; i22 < relays2.length; i22++) {
        const url = normalizeURL(relays2[i22]);
        if (!request.find((r) => r.url === url)) {
          if (uniqUrls.indexOf(url) === -1) {
            uniqUrls.push(url);
            request.push({ url, filter });
          }
        }
      }
      return this.subscribeMap(request, params);
    }
    subscribeMany(relays2, filter, params) {
      return this.subscribe(relays2, filter, params);
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
    subscribeEose(relays2, filter, params) {
      let subcloser;
      subcloser = this.subscribe(relays2, filter, {
        ...params,
        oneose() {
          const reason = "closed automatically on eose";
          if (subcloser)
            subcloser.close(reason);
          else
            params.onclose?.(relays2.map((_) => reason));
        }
      });
      return subcloser;
    }
    subscribeManyEose(relays2, filter, params) {
      return this.subscribeEose(relays2, filter, params);
    }
    async querySync(relays2, filter, params) {
      return new Promise(async (resolve) => {
        const events = [];
        this.subscribeEose(relays2, filter, {
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
    async get(relays2, filter, params) {
      filter.limit = 1;
      const events = await this.querySync(relays2, filter, params);
      events.sort((a, b) => b.created_at - a.created_at);
      return events[0] || null;
    }
    publish(relays2, event, params) {
      return relays2.map(normalizeURL).map(async (url, i22, arr) => {
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

  // node_modules/@scure/base/index.js
  function isBytes2(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function abytes2(b) {
    if (!isBytes2(b))
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
        for (let i3 = 0; i3 < len; i3++)
          if (newChecksum[i3] !== oldChecksum[i3])
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
      abytes2(b);
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

  // node_modules/nostr-tools/node_modules/@scure/bip39/index.js
  var isJapanese = (wordlist2) => wordlist2[0] === "\u3042\u3044\u3053\u304F\u3057\u3093";
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
  function generateMnemonic(wordlist2, strength = 128) {
    anumber(strength);
    if (strength % 32 !== 0 || strength > 256)
      throw new TypeError("Invalid entropy");
    return entropyToMnemonic(randomBytes(strength / 8), wordlist2);
  }
  var calcChecksum = (entropy) => {
    const bitsLeft = 8 - entropy.length / 4;
    return new Uint8Array([sha256(entropy)[0] >> bitsLeft << bitsLeft]);
  };
  function getCoder(wordlist2) {
    if (!Array.isArray(wordlist2) || wordlist2.length !== 2048 || typeof wordlist2[0] !== "string")
      throw new Error("Wordlist: expected array of 2048 strings");
    wordlist2.forEach((i3) => {
      if (typeof i3 !== "string")
        throw new Error("wordlist: non-string element: " + i3);
    });
    return utils.chain(utils.checksum(1, calcChecksum), utils.radix2(11, true), utils.alphabet(wordlist2));
  }
  function entropyToMnemonic(entropy, wordlist2) {
    aentropy(entropy);
    const words = getCoder(wordlist2).encode(entropy);
    return words.join(isJapanese(wordlist2) ? "\u3000" : " ");
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
  function generateSeedWords() {
    return generateMnemonic(wordlist);
  }

  // node_modules/nostr-tools/lib/esm/nip19.js
  var utf8Decoder3 = new TextDecoder("utf-8");
  var utf8Encoder3 = new TextEncoder();
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
            relays: tlv[1] ? tlv[1].map((d) => utf8Decoder3.decode(d)) : []
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
            relays: tlv[1] ? tlv[1].map((d) => utf8Decoder3.decode(d)) : [],
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
            identifier: utf8Decoder3.decode(tlv[0][0]),
            pubkey: bytesToHex(tlv[2][0]),
            kind: parseInt(bytesToHex(tlv[3][0]), 16),
            relays: tlv[1] ? tlv[1].map((d) => utf8Decoder3.decode(d)) : []
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

  // node_modules/@noble/ciphers/utils.js
  function isBytes3(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function abool2(b) {
    if (typeof b !== "boolean")
      throw new Error(`boolean expected, not ${b}`);
  }
  function anumber3(n) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("positive integer expected, got " + n);
  }
  function abytes3(value, length, title = "") {
    const bytes = isBytes3(value);
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
    abytes3(out, void 0, "output");
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
      abytes3(key, void 0, "key");
      if (!isLE)
        throw new Error("Non little-endian hardware is not yet supported");
      if (params.nonceLength !== void 0) {
        const nonce = args[0];
        abytes3(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
      }
      const tagl = params.tagLength;
      if (tagl && args[1] !== void 0)
        abytes3(args[1], void 0, "AAD");
      const cipher = constructor(key, ...args);
      const checkOutput = (fnLength, output) => {
        if (output !== void 0) {
          if (fnLength !== 2)
            throw new Error("cipher output not supported");
          abytes3(output, void 0, "output");
        }
      };
      let called = false;
      const wrCipher = {
        encrypt(data, output) {
          if (called)
            throw new Error("cannot encrypt() twice with same key + nonce");
          called = true;
          abytes3(data);
          checkOutput(cipher.encrypt.length, output);
          return cipher.encrypt(data, output);
        },
        decrypt(data, output) {
          abytes3(data);
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
    abytes3(key);
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
  function encrypt(xk, s0, s1, s2, s3) {
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
  function decrypt(xk, s0, s1, s2, s3) {
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
    abytes3(data);
    if (data.length % BLOCK_SIZE !== 0) {
      throw new Error("aes-(cbc/ecb).decrypt ciphertext should consist of blocks with size " + BLOCK_SIZE);
    }
  }
  function validateBlockEncrypt(plaintext, pcks5, dst) {
    abytes3(plaintext);
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
          ({ s0, s1, s2, s3 } = encrypt(xk, s0, s1, s2, s3));
          o[i3++] = s0, o[i3++] = s1, o[i3++] = s2, o[i3++] = s3;
        }
        if (pcks5) {
          const tmp32 = padPCKS(plaintext.subarray(i3 * 4));
          s0 ^= tmp32[0], s1 ^= tmp32[1], s2 ^= tmp32[2], s3 ^= tmp32[3];
          ({ s0, s1, s2, s3 } = encrypt(xk, s0, s1, s2, s3));
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
          const { s0: o0, s1: o1, s2: o2, s3: o3 } = decrypt(xk, s0, s1, s2, s3);
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
    abytes3(block, 16, "block");
    if (!isBytes32(xk))
      throw new Error("_encryptBlock accepts result of expandKeyLE");
    const b32 = u32(block);
    let { s0, s1, s2, s3 } = encrypt(xk, b32[0], b32[1], b32[2], b32[3]);
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
      abytes3(key);
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
      abytes3(data);
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
  var utf8Decoder4 = new TextDecoder("utf-8");
  var utf8Encoder4 = new TextEncoder();
  function encrypt2(secretKey, pubkey, text) {
    const privkey = secretKey instanceof Uint8Array ? secretKey : hexToBytes(secretKey);
    const key = secp256k1.getSharedSecret(privkey, hexToBytes("02" + pubkey));
    const normalizedKey = getNormalizedX(key);
    let iv = Uint8Array.from(randomBytes(16));
    let plaintext = utf8Encoder4.encode(text);
    let ciphertext = cbc(normalizedKey, iv).encrypt(plaintext);
    let ctb64 = base64.encode(new Uint8Array(ciphertext));
    let ivb64 = base64.encode(new Uint8Array(iv.buffer));
    return `${ctb64}?iv=${ivb64}`;
  }
  function decrypt2(secretKey, pubkey, data) {
    const privkey = secretKey instanceof Uint8Array ? secretKey : hexToBytes(secretKey);
    let [ctb64, ivb64] = data.split("?iv=");
    let key = secp256k1.getSharedSecret(privkey, hexToBytes("02" + pubkey));
    let normalizedKey = getNormalizedX(key);
    let iv = base64.decode(ivb64);
    let ciphertext = base64.decode(ctb64);
    let plaintext = cbc(normalizedKey, iv).decrypt(ciphertext);
    return utf8Decoder4.decode(plaintext);
  }
  function getNormalizedX(key) {
    return key.slice(1, 33);
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
    anumber3(counterLength);
    anumber3(rounds);
    abool2(counterRight);
    abool2(allowShortKeys);
    return (key, nonce, data, output, counter = 0) => {
      abytes3(key, void 0, "key");
      abytes3(nonce, void 0, "nonce");
      abytes3(data, void 0, "data");
      const len = data.length;
      if (output === void 0)
        output = new Uint8Array(len);
      abytes3(output, void 0, "output");
      anumber3(counter);
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
        abytes3(key, 32, "arx key");
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
      key = copyBytes2(abytes3(key, 32, "key"));
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
      abytes3(data);
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
      abytes3(AAD, void 0, "AAD");
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

  // node_modules/nostr-tools/lib/esm/nip44.js
  var utf8Decoder5 = new TextDecoder("utf-8");
  var utf8Encoder5 = new TextEncoder();
  var minPlaintextSize = 1;
  var maxPlaintextSize = 4294967295;
  var extendedPrefixThreshold = 65536;
  function getConversationKey(privkeyA, pubkeyB) {
    const sharedX = secp256k1.getSharedSecret(privkeyA, hexToBytes("02" + pubkeyB)).subarray(1, 33);
    return extract(sha256, sharedX, utf8Encoder5.encode("nip44-v2"));
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
    const unpadded = utf8Encoder5.encode(plaintext);
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
    return utf8Decoder5.decode(unpadded);
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
  function encrypt3(plaintext, conversationKey, nonce = randomBytes(32)) {
    const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
    const padded = pad(plaintext);
    const ciphertext = chacha20(chacha_key, chacha_nonce, padded);
    const mac = hmacAad(hmac_key, ciphertext, nonce);
    return base64.encode(concatBytes(new Uint8Array([2]), nonce, ciphertext, mac));
  }
  function decrypt3(payload, conversationKey) {
    const { nonce, ciphertext, mac } = decodePayload(payload);
    const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
    const calculatedMac = hmacAad(hmac_key, ciphertext, nonce);
    if (!equalBytes(calculatedMac, mac))
      throw new Error("invalid MAC");
    const padded = chacha20(chacha_key, chacha_nonce, ciphertext);
    return unpad(padded);
  }

  // src/steward.src.js
  var import_qrcode_generator = __toESM(require_qrcode());
  var NET = "trinityone";
  var KEY_LS = "trinityone.steward.church-key";
  var FUND_D = "trinityone/fund:";
  var GROUP_D = "trinityone/group:";
  var CATEGORY_D = "trinityone/category:";
  var PLAN_D = "trinityone/plan:";
  var DEVO_D = "trinityone/devotional:";
  var ROSTER_D = "trinityone/roster:";
  var SERVICE_D = "trinityone/service:";
  var RUNSHEET_D = "trinityone/runsheet:";
  var ROTA_D = "trinityone/rota:";
  var EVENT_D = "trinityone/event:";
  var ROOM_D = "trinityone/room:";
  var BOOKING_D = "trinityone/booking:";
  var REQUEST_D = "trinityone/request:";
  var REQREPLY_D = "trinityone/reqreply:";
  var NETWORK_D = "trinityone/network:";
  var BLOCKED_D = "trinityone/blocked:";
  var MINORS_D = "trinityone/minors:";
  var APPROVED_D = "trinityone/approved:";
  var NOPHOTO_D = "trinityone/nophoto:";
  var GUARDREQ_D = "trinityone/guardreq:";
  var GUARDIANS_D = "trinityone/guardians:";
  var JOINPOLICY_D = "trinityone/joinpolicy:";
  var ADMITTED_D = "trinityone/admitted:";
  var STEWARDS_D = "trinityone/stewards:";
  var STEWARDREQ_D = "trinityone/stewardreq:";
  var PIN_D = "trinityone/pin:";
  var HIDE_D = "trinityone/hidden:";
  var GROUPKEY_D = "trinityone/groupkey:";
  var _skeys = {};
  var _srev = {};
  var _senvTs = {};
  var _hex = (u) => Array.from(u).map((b) => b.toString(16).padStart(2, "0")).join("");
  var _unhex = (h) => new Uint8Array((String(h).match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)));
  function stewIngestKey(e) {
    const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
    if (!d.startsWith(GROUPKEY_D)) return;
    const gid = d.slice(GROUPKEY_D.length);
    if ((_senvTs[gid] || 0) > (e.created_at || 0)) return;
    _senvTs[gid] = e.created_at || 0;
    try {
      const env = JSON.parse(e.content || "{}");
      _srev[gid] = env.rev || 1;
      const mine = env.keys && churchPub && env.keys[churchPub];
      if (mine && churchSk) _skeys[gid] = _unhex(decrypt3(mine, getConversationKey(churchSk, e.pubkey)));
    } catch {
    }
  }
  var now = () => Math.floor(Date.now() / 1e3);
  function toPubHex(npubOrHex) {
    try {
      if (/^[0-9a-f]{64}$/i.test(npubOrHex)) return npubOrHex.toLowerCase();
      const d = decode(npubOrHex);
      return d && d.type === "npub" ? d.data : null;
    } catch {
      return null;
    }
  }
  var RELAYS_LS = "trinityone.steward.extra-relays";
  var NETKEYS_LS = "trinityone.steward.network-keys";
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {
    }
  }
  function netKeys() {
    try {
      const a = JSON.parse(lsGet(NETKEYS_LS) || "[]");
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  }
  function saveNetKey(rec) {
    const a = netKeys().filter((x) => x.pub !== rec.pub);
    a.push(rec);
    lsSet(NETKEYS_LS, JSON.stringify(a));
  }
  var CANONICAL_RELAYS = ["wss://trinityone-master-01.tailbeaac0.ts.net/relay", "wss://trinityone.tailbeaac0.ts.net/relay"];
  var CANONICAL_RELAY = CANONICAL_RELAYS[0];
  function ownRelay() {
    if (typeof window !== "undefined" && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return CANONICAL_RELAY;
    const l = typeof location !== "undefined" ? location : null;
    if (!l || !l.host) return CANONICAL_RELAY;
    if (/\.(github\.io|pages\.dev|netlify\.app)$/i.test(l.host)) return CANONICAL_RELAY;
    return (l.protocol === "https:" ? "wss://" : "ws://") + l.host + "/relay";
  }
  function extraRelays() {
    try {
      const a = JSON.parse(lsGet(RELAYS_LS) || "[]");
      return Array.isArray(a) ? a.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  function normRelay(input) {
    let v = String(input || "").trim();
    if (!v) return "";
    if (!/^wss?:\/\//i.test(v)) v = "wss://" + v.replace(/^\/+/, "");
    return v.replace(/\/+$/, "");
  }
  function cleanNip05(raw, name) {
    let s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    if (!s) return "";
    if (s.includes("@")) {
      const [l, d] = s.split("@");
      const local = l.replace(/[^a-z0-9._-]/g, ""), domain = d.replace(/^www\./, "");
      return local && /\./.test(domain) ? local + "@" + domain : "";
    }
    if (!/\./.test(s)) return "";
    const slug = String(name || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "").slice(0, 30);
    return slug ? slug + "@" + s : "";
  }
  function relays() {
    const own = ownRelay();
    const out = [own];
    if (own === CANONICAL_RELAY) {
      for (const r of CANONICAL_RELAYS) {
        if (r && !out.includes(r)) out.push(r);
      }
    }
    for (const r of extraRelays()) {
      if (r && r !== own && !out.includes(r)) out.push(r);
    }
    return out;
  }
  var pool = new SimplePool();
  function _b64ToU8(base642) {
    const pad2 = "=".repeat((4 - base642.length % 4) % 4);
    const s = (base642 + pad2).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i3 = 0; i3 < raw.length; i3++) out[i3] = raw.charCodeAt(i3);
    return out;
  }
  var sk = null;
  var pub = null;
  pool.automaticallyAuth = () => async (authEvent) => {
    if (!sk) throw new Error("no key");
    return finalizeEvent2(authEvent, sk);
  };
  var churchSk = null;
  var churchPub = null;
  var lastProfile = {};
  var actingChurch = "";
  var stewardedChurches = /* @__PURE__ */ new Map();
  function feChurch(tmpl, signer) {
    if (actingChurch && !(tmpl.tags || []).some((t) => t[0] === "church")) {
      tmpl = { ...tmpl, tags: [...tmpl.tags || [], ["church", actingChurch]] };
    }
    return finalizeEvent2(tmpl, signer || sk);
  }
  var _PET_ADJ = ["Quiet", "Bright", "Gentle", "Steady", "Faithful", "Humble", "Joyful", "Kind", "Patient", "Bold", "Gracious", "Calm", "Glad", "Warm", "True", "Sure"];
  var _PET_NOUN = ["Olive", "Cedar", "Dove", "Anchor", "Lamp", "Vine", "Shepherd", "Harbor", "Beacon", "Reed", "Sparrow", "Willow", "Spring", "Haven", "Ember", "Brook"];
  function _petHash(s) {
    let h = 0;
    for (let i3 = 0; i3 < s.length; i3++) h = h * 31 + s.charCodeAt(i3) >>> 0;
    return h;
  }
  function stewardNameFor(hexPub) {
    if (!hexPub) return "";
    const h = _petHash(hexPub);
    return _PET_ADJ[h % _PET_ADJ.length] + " " + _PET_NOUN[(h >>> 4) % _PET_NOUN.length] + " " + (10 + (h >>> 9) % 90);
  }
  var currentMnemonic = null;
  function setKey(mnemonic) {
    sk = privateKeyFromSeedWords(mnemonic);
    pub = getPublicKey2(sk);
    churchSk = sk;
    churchPub = pub;
    currentMnemonic = mnemonic;
    window.Steward.pubkey = pub;
    window.Steward.npub = npubEncode(pub);
    window.Steward.churchPub = pub;
    window.Steward.activePub = pub;
    window.Steward.hasKey = true;
  }
  var ENC_LS = "trinityone.steward.church-key.enc";
  var needsPin = false;
  function _setNeedsPin(v) {
    v = !!v;
    if (needsPin === v) return;
    needsPin = v;
    if (typeof window !== "undefined" && window.Steward) window.Steward.needsPin = v;
    try {
      window.dispatchEvent(new CustomEvent("steward-needs-pin", { detail: { needs: v } }));
    } catch (e) {
    }
  }
  var b64e = (u82) => btoa(String.fromCharCode(...u82));
  var b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function deriveAes(pin, salt) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 21e4, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function publish(evt) {
    try {
      await Promise.any(pool.publish(relays(), evt));
    } catch (e) {
      console.warn("[steward] publish failed", e);
      let reason = "";
      try {
        const errs = e && e.errors || [];
        reason = errs[0] && (errs[0].message || String(errs[0])) || "";
      } catch (x) {
      }
      try {
        window.dispatchEvent(new CustomEvent("steward-publish-error", { detail: { reason, evt } }));
      } catch (x) {
      }
    }
    return evt;
  }
  function skFor(asPub) {
    if (!asPub || asPub === pub) return sk;
    const rec = netKeys().find((x) => x.pub === asPub);
    if (rec) {
      try {
        return privateKeyFromSeedWords(rec.mnemonic);
      } catch {
        return null;
      }
    }
    return null;
  }
  function _publishSigned(tmpl) {
    if (!sk) return Promise.resolve(null);
    return publish(feChurch(tmpl));
  }
  function _subscribeMany(filters, handlers) {
    return pool.subscribeMany(relays(), filters, handlers);
  }
  window.Steward = {
    pubkey: null,
    npub: null,
    hasKey: false,
    // ---- primitives for optional modules (Meals, Finance, Manna plugins) ----
    // Modules call publishSigned/subscribeMany; they never see `pool`, `relays()`, or `feChurch`.
    publishSigned: _publishSigned,
    subscribeMany: _subscribeMany,
    relayList() {
      return relays();
    },
    // ---- key (pilot: self-custodial in localStorage; later: a signer) ----
    locked: false,
    // true when an encrypted key exists and isn't unlocked yet
    // SECURITY-AUDIT-2026-06-25 Critical-2: true when the seed exists in memory but is NOT persisted
    // as an encrypted blob — i.e. either freshly created (no setPin yet) or a legacy plaintext seed
    // was found in localStorage that needs migrating. The UI gates the console behind a forced
    // PIN-setup modal whenever this is true.
    needsPin: false,
    init(mnemonicOverride) {
      if (mnemonicOverride) {
        lsSet(KEY_LS, mnemonicOverride);
        setKey(mnemonicOverride);
        _setNeedsPin(true);
        window.Steward.locked = false;
        return true;
      }
      const m = lsGet(KEY_LS);
      if (m) {
        setKey(m);
        _setNeedsPin(true);
        window.Steward.locked = false;
        return true;
      }
      if (lsGet(ENC_LS)) {
        window.Steward.locked = true;
        return false;
      }
      return false;
    },
    // ---- PIN lock API ----
    hasPinLock() {
      return !!lsGet(ENC_LS);
    },
    async setPin(pin) {
      const seed = currentMnemonic || lsGet(KEY_LS);
      if (!seed || !pin) return false;
      const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveAes(pin, salt), new TextEncoder().encode(seed)));
      lsSet(ENC_LS, JSON.stringify({ v: 1, salt: b64e(salt), iv: b64e(iv), ct: b64e(ct) }));
      try {
        localStorage.removeItem(KEY_LS);
      } catch {
      }
      _setNeedsPin(false);
      return true;
    },
    async unlock(pin) {
      const raw = lsGet(ENC_LS);
      if (!raw) return true;
      try {
        const o = JSON.parse(raw);
        const seed = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt)), b64d(o.ct)));
        setKey(seed);
        window.Steward.locked = false;
        window.dispatchEvent(new CustomEvent("steward-key", { detail: { npub: window.Steward.npub } }));
        return true;
      } catch {
        return false;
      }
    },
    lock() {
      sk = null;
      pub = null;
      currentMnemonic = null;
      window.Steward.pubkey = null;
      window.Steward.npub = null;
      window.Steward.hasKey = false;
      window.Steward.locked = !!lsGet(ENC_LS);
      window.dispatchEvent(new CustomEvent("steward-key", { detail: { npub: null } }));
    },
    // verify a PIN against the encrypted seed at rest, with NO side effects (gates removing the lock).
    async verifyPin(pin) {
      const raw = lsGet(ENC_LS);
      if (!raw) return false;
      try {
        const o = JSON.parse(raw);
        await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(o.iv) }, await deriveAes(pin, b64d(o.salt)), b64d(o.ct));
        return true;
      } catch {
        return false;
      }
    },
    // drop the PIN. SECURITY-AUDIT-2026-06-25 Critical-2: NO LONGER writes the plaintext seed back to
    // localStorage — instead removes the encrypted form and sets needsPin=true. The seed stays in
    // memory (currentMnemonic); the UI immediately renders the forced PIN modal, requiring the
    // steward to set a new PIN before any further action. Net effect: there is NO post-removeLock
    // state where a plaintext seed exists on disk, even transiently.
    async removeLock(pin) {
      if (!currentMnemonic) return false;
      if (lsGet(ENC_LS) && !await window.Steward.verifyPin(pin)) return false;
      try {
        localStorage.removeItem(ENC_LS);
      } catch {
      }
      window.Steward.locked = false;
      _setNeedsPin(true);
      return true;
    },
    createKey() {
      const m = generateSeedWords();
      setKey(m);
      _setNeedsPin(true);
      window.dispatchEvent(new CustomEvent("steward-key", { detail: { npub: window.Steward.npub } }));
      return { npub: window.Steward.npub };
    },
    // like createKey but WITHOUT firing steward-key — so the welcome screen can stay up to show the new
    // identity's "become a steward" code before the caller continues into the console (which fires it then).
    createKeyQuiet() {
      const m = generateSeedWords();
      setKey(m);
      _setNeedsPin(true);
      return { npub: window.Steward.npub, code: window.Steward.becomeStewardPayload() };
    },
    enterConsole() {
      window.dispatchEvent(new CustomEvent("steward-key", { detail: { npub: window.Steward.npub } }));
    },
    // load the persisted church key if there is one; only generate a NEW key when none exists.
    // (Bug fix: previously this always created+OVERWROTE the stored key on a normal load, so the church
    // identity changed on every reload — members vanished because they're tagged to the old pubkey.)
    ensureKey() {
      if (window.Steward.hasKey) return { npub: window.Steward.npub };
      if (window.Steward.init()) return { npub: window.Steward.npub };
      return window.Steward.createKey();
    },
    exportMnemonic() {
      return currentMnemonic || lsGet(KEY_LS);
    },
    // restore/import a church key from its 12-word recovery phrase (replaces the current key on this device)
    restoreKey(mnemonic) {
      const m = (mnemonic || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (m.split(" ").length < 12) throw new Error("Enter the full 12-word recovery phrase.");
      setKey(m);
      try {
        localStorage.removeItem(KEY_LS);
        localStorage.removeItem(ENC_LS);
      } catch (e) {
      }
      _setNeedsPin(true);
      window.dispatchEvent(new CustomEvent("steward-key", { detail: { npub: window.Steward.npub } }));
      return { npub: window.Steward.npub };
    },
    // ---- QR handoff: the old steward shows a code; the new steward scans it to adopt the church ----
    // The payload carries the church's 12-word seed (same trust model as revealing the phrase — anyone
    // who reads it controls the church), tagged so the scanner knows it's a church handoff.
    handoffPayload() {
      const m = currentMnemonic || lsGet(KEY_LS);
      return m ? "trinityone-church:" + m : "";
    },
    // adopt a church from a scanned QR / pasted code / link → restore its key on THIS device.
    adoptChurch(payload) {
      let m = (payload || "").trim();
      const q = m.match(/[?&#](?:adopt|church)=([^&#\s]+)/);
      if (q) {
        try {
          m = decodeURIComponent(q[1]);
        } catch {
        }
      }
      m = m.replace(/^trinityone-church:/i, "").trim();
      return window.Steward.restoreKey(m);
    },
    // ---- "Become a steward" handshake: a would-be steward shows this code to a church owner, who scans/pastes
    // it under Delegated stewards to add them. Unlike the church handoff this carries ONLY the public npub of
    // the would-be steward's OWN identity — no secret — so it's safe to share over any channel. ----
    becomeStewardPayload() {
      return churchPub ? "trinityone-steward:" + npubEncode(churchPub) : "";
    },
    // friendly, deterministic name for a key (npub or hex) — a human cross-check when sharing a steward code.
    stewardName(npubOrHex) {
      return stewardNameFor(toPubHex(npubOrHex) || (typeof npubOrHex === "string" && /^[0-9a-f]{64}$/i.test(npubOrHex) ? npubOrHex.toLowerCase() : ""));
    },
    // owner side: parse a steward code / npub / link → hex pubkey to put on the roster (null if not valid).
    stewardCodeToPub(payload) {
      let s = (payload || "").trim();
      const q = s.match(/[?&#]steward=([^&#\s]+)/);
      if (q) {
        try {
          s = decodeURIComponent(q[1]);
        } catch {
        }
      }
      s = s.replace(/^trinityone-steward:/i, "").trim();
      return toPubHex(s);
    },
    // ---- invite-to-steward handshake: the OWNER shows an invite QR (their church id, public); a would-be
    // steward SCANS it and sends a request; the owner sees it pending and approves it into the roster. ----
    stewardInvitePayload() {
      return churchPub ? "trinityone-stewardinvite:" + npubEncode(churchPub) : "";
    },
    parseStewardInvite(payload) {
      let s = (payload || "").trim();
      const q = s.match(/[?&#](?:stewardinvite|church)=([^&#\s]+)/);
      if (q) {
        try {
          s = decodeURIComponent(q[1]);
        } catch {
        }
      }
      s = s.replace(/^trinityone-stewardinvite:/i, "").trim();
      return toPubHex(s);
    },
    // requester side: scan/paste a church's invite → publish a steward request (signed by OUR key, naming the church)
    requestSteward(payload) {
      const cp = window.Steward.parseStewardInvite(payload);
      if (!cp) return Promise.resolve({ ok: false, error: "That doesn\u2019t look like a church invite." });
      if (cp === churchPub) return Promise.resolve({ ok: false, error: "That\u2019s your own church." });
      const content = JSON.stringify({ name: lastProfile && lastProfile.name || "" });
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", STEWARDREQ_D + cp], ["t", NET], ["p", cp]], content }, sk)).then(() => ({ ok: true, church: cp, npub: npubEncode(cp) }));
    },
    // owner side: pending steward requests for THIS church → [{ pubkey, npub, name }] (excludes current stewards)
    subscribeStewardRequests(onReqs) {
      const byPub = /* @__PURE__ */ new Map();
      let roster = /* @__PURE__ */ new Set();
      const emit = () => onReqs([...byPub.values()].filter((r) => !roster.has(r.pubkey)));
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d === STEWARDS_D + pub) {
            try {
              roster = new Set(JSON.parse(e.content).pubkeys || []);
            } catch {
            }
            emit();
            return;
          }
          if (d !== STEWARDREQ_D + pub || e.pubkey === pub) return;
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byPub.delete(e.pubkey);
            emit();
            return;
          }
          let name = "";
          try {
            name = JSON.parse(e.content).name || "";
          } catch {
          }
          byPub.set(e.pubkey, { pubkey: e.pubkey, npub: npubEncode(e.pubkey), name, ts: e.created_at });
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
    // remove the church key from THIS device (completing a handoff, or stepping away). The church lives on
    // wherever its phrase is held — this only forgets it locally; it does not delete/rotate the key.
    removeKey() {
      try {
        localStorage.removeItem(KEY_LS);
        localStorage.removeItem(ENC_LS);
      } catch {
      }
      sk = null;
      pub = null;
      currentMnemonic = null;
      window.Steward.pubkey = null;
      window.Steward.npub = null;
      window.Steward.hasKey = false;
      window.Steward.locked = false;
      window.dispatchEvent(new CustomEvent("steward-key", { detail: { npub: null } }));
      return true;
    },
    // ---- web push: notify the steward's phone when someone joins (PWA only; Capacitor → local notifs) ----
    // The subscription is filed under the CHURCH key, so the gateway pushes church-targeted alerts (joins)
    // to whichever devices proved that key. Returns a status string the UI can reflect.
    async registerPush() {
      try {
        if (!churchPub || !churchSk) return "no-key";
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return "native";
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          const ok = await Notification.requestPermission();
          if (ok !== "granted") return "denied";
        }
        if (typeof Notification !== "undefined" && Notification.permission !== "granted") return "denied";
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const vapid = await fetch("/push/vapid").then((r2) => r2.json()).catch(() => null);
          if (!vapid || !vapid.publicKey) return "no-vapid";
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: _b64ToU8(vapid.publicKey) });
        }
        const auth = finalizeEvent2({ kind: 27235, created_at: now(), tags: [["u", sub.endpoint], ["method", "POST"]], content: "" }, churchSk);
        const r = await fetch("/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub, auth }) });
        return r.ok ? "on" : "error";
      } catch {
        return "error";
      }
    },
    // ---- publish (signed by the church) ----
    publishProfile(meta) {
      if (!sk) return Promise.resolve(null);
      lastProfile = { ...lastProfile, ...meta };
      const m = lastProfile;
      let nip05 = cleanNip05(m.nip05, m.name);
      if (!nip05 && m.name) {
        const local = String(m.name).toLowerCase().replace(/[^a-z0-9._-]+/g, "").slice(0, 30);
        const host = (CANONICAL_RELAY || "").replace(/^wss?:\/\//i, "").replace(/\/relay\/?$/i, "");
        if (local && host) nip05 = local + "@" + host;
      }
      const content = JSON.stringify({ name: m.name || "", about: m.about || "", nip05, picture: m.picture || "", banner: m.banner || "", accent: m.accent || "", channel: m.channel || "", audioFeed: m.audioFeed || "", lud16: (m.lud16 || "").trim(), giving: !!m.giving, features: m.features && typeof m.features === "object" ? m.features : {}, rules: m.rules && typeof m.rules === "object" ? m.rules : {} });
      return publish(finalizeEvent2({ kind: 0, created_at: now(), tags: [], content }, sk));
    },
    publishFund(fund) {
      if (!sk) return Promise.resolve(null);
      const id = fund.id || "fund" + Date.now();
      const content = JSON.stringify({
        name: fund.name || "Fund",
        sub: fund.sub || "",
        icon: fund.icon || "gift",
        lnaddr: (fund.lnaddr || "").trim(),
        address: fund.address || "",
        custody: fund.custody || "Self-custody \xB7 Lightning"
      });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", FUND_D + id], ["t", NET]], content })).then((e) => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
    },
    removeFund(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", FUND_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    // Post a kind-1 message into a group as the church. MUST carry ['p', churchPub] — the member's
    // subscribeGroup scopes by it, so without it the post is invisible to members (was the bug).
    publishPost(content, group) {
      if (!sk) return Promise.resolve(null);
      let body = content || "", encTag = [];
      const gkey = group && _skeys[group];
      if (gkey) {
        try {
          body = encrypt3(content || "", gkey);
          encTag = [["enc", "1"]];
        } catch (e) {
        }
      }
      return publish(feChurch({ kind: 1, created_at: now(), tags: [["t", NET], ["t", group || "announce"], ["p", pub], ...encTag], content: body }));
    },
    // read a group/team's chat (kind-1 tagged with the group id, scoped to this church) — for the console chat view.
    // Folds in kind-7 reactions (same shape the member app posts) so the console shows + sets reactions too.
    subscribeGroupChat(groupId, onMsgs) {
      const byId = /* @__PURE__ */ new Map();
      const rx = /* @__PURE__ */ new Map();
      const names = /* @__PURE__ */ new Map();
      const seen = /* @__PURE__ */ new Set();
      const nameSubs = [];
      let pending = [], batchTimer = null;
      let hidden = /* @__PURE__ */ new Set();
      const attach = () => [...byId.values()].filter((m) => !hidden.has(m.id)).sort((a, b) => (a.ts || 0) - (b.ts || 0)).map((m) => {
        const r = rx.get(m.id);
        return { ...m, name: names.get(m.by) || "", reactions: r ? [...r.values()].filter(Boolean) : [], myReaction: r ? r.get(pub) || "" : "" };
      });
      const emit = () => onMsgs(attach());
      const resolveName = (pk) => {
        if (!pk || seen.has(pk)) return;
        seen.add(pk);
        pending.push(pk);
        clearTimeout(batchTimer);
        batchTimer = setTimeout(() => {
          const authors = pending.splice(0);
          if (!authors.length) return;
          const s2 = pool.subscribeMany(relays(), [{ kinds: [0], authors }], {
            onevent(ev) {
              try {
                const p = JSON.parse(ev.content);
                const nm = p && (p.name || p.display_name);
                if (nm) {
                  names.set(ev.pubkey, nm);
                  emit();
                }
              } catch {
              }
            },
            oneose() {
            }
          });
          nameSubs.push(s2);
        }, 200);
      };
      const sub = pool.subscribeMany(relays(), [{ kinds: [1], "#t": [groupId], limit: 300 }, { kinds: [7], "#t": [groupId], limit: 500 }], {
        onevent(e) {
          if (e.kind === 7) {
            const tid = (e.tags.find((t) => t[0] === "e") || [])[1];
            if (!tid) return;
            let m = rx.get(tid);
            if (!m) {
              m = /* @__PURE__ */ new Map();
              rx.set(tid, m);
            }
            if (e.content === "-" || e.content === "") m.delete(e.pubkey);
            else m.set(e.pubkey, e.content);
            emit();
            return;
          }
          if (!e.tags.some((t) => t[0] === "t" && t[1] === groupId)) return;
          if (!e.tags.some((t) => t[0] === "p" && t[1] === pub)) return;
          let text = e.content;
          if (e.tags.some((t) => t[0] === "enc")) {
            const k = _skeys[groupId];
            if (!k) return;
            try {
              text = decrypt3(e.content, k);
            } catch {
              return;
            }
          }
          byId.set(e.id, { id: e.id, by: e.pubkey, mine: e.pubkey === pub, text, ts: e.created_at, kind: (e.tags.find((t) => t[0] === "k") || [])[1] || "" });
          resolveName(e.pubkey);
          emit();
        },
        oneose() {
          emit();
        }
      });
      const hideSub = window.Steward.subscribeHidden((set) => {
        hidden = set;
        emit();
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
        try {
          hideSub();
        } catch {
        }
        clearTimeout(batchTimer);
        nameSubs.forEach((s) => {
          try {
            s.close();
          } catch {
          }
        });
      };
    },
    // react to a group message (NIP-25 kind-7), interoperable with the member app. emoji '' or '-' retracts.
    reactGroup(groupId, msgId, targetPub, emoji) {
      if (!sk || !groupId || !msgId) return Promise.resolve(null);
      return publish(finalizeEvent2({ kind: 7, created_at: now(), tags: [["e", msgId], ["p", targetPub || ""], ["t", NET], ["t", groupId]], content: emoji || "-" }, sk));
    },
    // ---- direct messages: the church <-> a member (NIP-04 encrypted kind-4) ----
    async sendDM(peerHex, content) {
      if (!sk || !peerHex) return null;
      let enc = "";
      try {
        enc = await encrypt2(sk, peerHex, content);
      } catch {
        return null;
      }
      const evt = finalizeEvent2({ kind: 4, created_at: now(), tags: [["p", peerHex], ["t", NET]], content: enc }, sk);
      return publish(evt);
    },
    // the 1:1 thread with one member (decrypts both directions; carries kind-7 reactions per message)
    subscribeDMThread(peerHex, onMsgs) {
      const byId = /* @__PURE__ */ new Map();
      const rx = /* @__PURE__ */ new Map();
      const attach = () => [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)).map((m) => {
        const r = rx.get(m.id);
        const reactions = r ? [...r.values()].filter(Boolean) : [];
        return { ...m, reactions, myReaction: r ? r.get(pub) || "" : "" };
      });
      const emit = () => onMsgs(attach());
      const take = async (e) => {
        if (byId.has(e.id)) return;
        const mine = e.pubkey === pub;
        const other = mine ? peerHex : e.pubkey;
        let text = "";
        try {
          text = await decrypt2(sk, other, e.content);
        } catch {
          return;
        }
        byId.set(e.id, { id: e.id, mine, text, ts: e.created_at });
        emit();
      };
      const takeRx = (e) => {
        const tid = (e.tags.find((t) => t[0] === "e") || [])[1];
        if (!tid) return;
        let m = rx.get(tid);
        if (!m) {
          m = /* @__PURE__ */ new Map();
          rx.set(tid, m);
        }
        if (e.content === "-" || e.content === "") m.delete(e.pubkey);
        else m.set(e.pubkey, e.content);
        emit();
      };
      const sub = pool.subscribeMany(relays(), [
        { kinds: [4], authors: [pub], "#p": [peerHex] },
        { kinds: [4], authors: [peerHex], "#p": [pub] },
        { kinds: [7], authors: [pub], "#p": [peerHex] },
        { kinds: [7], authors: [peerHex], "#p": [pub] }
      ], {
        onevent(e) {
          if (e.kind === 7) takeRx(e);
          else take(e);
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
    // react to a member's DM (NIP-25 kind-7). emoji '' or '-' retracts.
    async reactDM(peerHex, msgId, emoji) {
      if (!sk || !peerHex || !msgId) return null;
      const evt = finalizeEvent2({ kind: 7, created_at: now(), tags: [["e", msgId], ["p", peerHex], ["t", NET], ["k", "4"]], content: emoji || "-" }, sk);
      return publish(evt);
    },
    // list of members who have a DM thread with the church (most recent first)
    subscribeDMConvos(onConvos) {
      const byPeer = /* @__PURE__ */ new Map();
      const emit = () => onConvos([...byPeer.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      const sub = pool.subscribeMany(relays(), [{ kinds: [4], authors: [pub] }, { kinds: [4], "#p": [pub] }], {
        onevent(e) {
          const mine = e.pubkey === pub;
          const peer = mine ? (e.tags.find((t) => t[0] === "p") || [])[1] : e.pubkey;
          if (!peer || peer === pub) return;
          const prev = byPeer.get(peer);
          if (!prev || e.created_at > prev.ts) {
            byPeer.set(peer, { peer, npub: npubEncode(peer), ts: e.created_at });
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
    },
    // ---- read the church's own data (live) ----
    // onFunds(fundsArray) fires whenever the fund set changes; returns an unsubscribe fn.
    subscribeFunds(onFunds) {
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onFunds([...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0)));
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(FUND_D)) return;
          const id = d.slice(FUND_D.length);
          const deleted = e.tags.some((t) => t[0] === "deleted") || !e.content;
          if (deleted) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at });
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
    // ---- categories (named containers that group the church's groups, e.g. "Lifegroups") ----
    publishCategory(cat) {
      if (!sk) return Promise.resolve(null);
      const id = cat.id || "cat" + Date.now();
      const content = JSON.stringify({ name: cat.name || "Category", order: typeof cat.order === "number" ? cat.order : void 0 });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", CATEGORY_D + id], ["t", NET]], content })).then((e) => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
    },
    removeCategory(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", CATEGORY_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    subscribeCategories(onCats) {
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onCats([...byId.values()].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0)));
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(CATEGORY_D)) return;
          const id = d.slice(CATEGORY_D.length);
          const deleted = e.tags.some((t) => t[0] === "deleted") || !e.content;
          if (deleted) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at });
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
    // ---- groups (the church's chat rooms) ----
    publishGroup(group) {
      if (!sk) return Promise.resolve(null);
      const id = group.id || "grp" + Date.now();
      const inviteOnly = group.visibility === "invite";
      const content = JSON.stringify({ name: group.name || "Group", kind: group.kind || "group", sub: group.sub || "", icon: group.icon || "", accent: group.accent || "", leaders: Array.isArray(group.leaders) ? group.leaders : [], order: typeof group.order === "number" ? group.order : void 0, category: group.category || void 0, visibility: inviteOnly ? "invite" : void 0, members: inviteOnly && Array.isArray(group.members) ? group.members : void 0, encrypted: group.encrypted ? true : void 0, childsafe: group.childsafe ? true : void 0 });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", GROUP_D + id], ["t", NET]], content })).then((e) => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
    },
    // set which members can post events for a group (re-publishes the group def, preserving its fields)
    setGroupLeaders(group, leaderPubs) {
      return window.Steward.publishGroup({ ...group, leaders: (leaderPubs || []).filter(Boolean) });
    },
    removeGroup(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", GROUP_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    // ---- encrypted groups: publish/refresh the key envelope (the group key wrapped per-member via NIP-44).
    //
    // Contract callers MUST honour (SECURITY-AUDIT-2026-06-24 N2):
    //   • Adding a member without rotation → reuse the existing key so new members can read history.
    //     This is the normal case; pass NO opts (or only `reuseOnly`).
    //   • REMOVING a member from an encrypted group → you MUST pass `{rotate: true}` so a fresh key
    //     is minted. Without rotation, the removed member's CACHED key continues to decrypt every
    //     future message they can scrape from any relay — the gateway's allowlist only stops the
    //     RELAY from delivering future messages, it can't unsee bytes the member already cached, and
    //     it can't stop the same member subscribing from a non-enforcing relay. Verified call site:
    //     EditGroupMembersModal in stew-dashboard.jsx passes `{rotate: removed}`.
    //   • Background re-key (`reuseOnly: true`) → must NOT mint a new key (would orphan history).
    //
    // The church key is always wrapped to itself (so the church can later add members without needing
    // the original opaque key material from disk). ----
    publishGroupKey(groupId, memberPubs, opts = {}) {
      if (!churchSk || !churchPub) return Promise.resolve(null);
      if (opts.reuseOnly && !_skeys[groupId]) return Promise.resolve(null);
      const recips = [.../* @__PURE__ */ new Set([churchPub, ...(memberPubs || []).map((p) => toPubHex(p) || p).filter(Boolean)])];
      let key = _skeys[groupId];
      if (opts.rotate || !key) {
        key = crypto.getRandomValues(new Uint8Array(32));
        _srev[groupId] = (_srev[groupId] || 0) + 1;
      }
      _skeys[groupId] = key;
      const rev = _srev[groupId] || 1;
      _srev[groupId] = rev;
      const keys = {};
      for (const pk of recips) {
        try {
          keys[pk] = encrypt3(_hex(key), getConversationKey(churchSk, pk));
        } catch (e) {
        }
      }
      _senvTs[groupId] = now();
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", GROUPKEY_D + groupId], ["t", NET]], content: JSON.stringify({ rev, keys }) }, churchSk));
    },
    // ---- moderation: the church's blocklist (banned member pubkeys). The relay rejects their writes
    // and withholds their existing events. Replaceable doc d=blocked:<churchpub>. ----
    subscribeBlocked(onBlocked) {
      let cur = [];
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d !== BLOCKED_D + pub) return;
          try {
            cur = JSON.parse(e.content).pubkeys || [];
          } catch {
            cur = [];
          }
          onBlocked(cur);
        },
        oneose() {
          onBlocked(cur);
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    setBlocked(pubkeys) {
      if (!sk) return Promise.resolve(null);
      const list = [...new Set((pubkeys || []).filter(Boolean))];
      const content = JSON.stringify({ pubkeys: list });
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", BLOCKED_D + pub], ["t", NET]], content }, sk));
    },
    // ---- safeguarding: two church-signed lists the relay reads to enforce child protection ----
    // minors:<churchpub> = members marked as children; approved:<churchpub> = adults cleared to contact youth
    // (should mirror the church's real DBS/cleared list). The relay rejects a kind-4 DM where one party is
    // a minor and the other isn't on the approved list. The member app uses minors to show a child only
    // child-safe groups. Replaceable docs, church-only writes. ----
    subscribeSafeguard(onLists) {
      let minors = [], approved = [], nophoto = [];
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d === MINORS_D + pub) {
            try {
              minors = JSON.parse(e.content).pubkeys || [];
            } catch {
              minors = [];
            }
            onLists({ minors, approved, nophoto });
          } else if (d === APPROVED_D + pub) {
            try {
              approved = JSON.parse(e.content).pubkeys || [];
            } catch {
              approved = [];
            }
            onLists({ minors, approved, nophoto });
          } else if (d === NOPHOTO_D + pub) {
            try {
              nophoto = JSON.parse(e.content).pubkeys || [];
            } catch {
              nophoto = [];
            }
            onLists({ minors, approved, nophoto });
          }
        },
        oneose() {
          onLists({ minors, approved, nophoto });
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    setNoPhoto(pubkeys) {
      if (!sk) return Promise.resolve(null);
      const list = [...new Set((pubkeys || []).filter(Boolean))];
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", NOPHOTO_D + pub], ["t", NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
    },
    setMinors(pubkeys) {
      if (!sk) return Promise.resolve(null);
      const list = [...new Set((pubkeys || []).filter(Boolean))];
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", MINORS_D + pub], ["t", NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
    },
    setApproved(pubkeys) {
      if (!sk) return Promise.resolve(null);
      const list = [...new Set((pubkeys || []).filter(Boolean))];
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", APPROVED_D + pub], ["t", NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
    },
    // ---- safeguarding v2: parent↔child links. Parents publish a guardian-link REQUEST (guardreq:<childpub>,
    // p-tagged to us); the steward confirms it into the church-signed GUARDIANS map (guardians:<churchpub>),
    // which the relay reads so a parent may always DM their own child. ----
    subscribeGuardianRequests(onReqs) {
      const byChild = /* @__PURE__ */ new Map();
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#p": [pub] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(GUARDREQ_D)) return;
          const child = d.slice(GUARDREQ_D.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byChild.delete(child);
          } else {
            try {
              const c = JSON.parse(e.content);
              byChild.set(child, { child, parent: c.parent || e.pubkey, parentName: c.parentName || "", childName: c.childName || "", ts: e.created_at });
            } catch {
            }
          }
          onReqs([...byChild.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
        },
        oneose() {
          onReqs([...byChild.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    subscribeGuardians(onMap) {
      let cur = {};
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d !== GUARDIANS_D + pub) return;
          try {
            cur = JSON.parse(e.content).links || {};
          } catch {
            cur = {};
          }
          onMap(cur);
        },
        oneose() {
          onMap(cur);
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    setGuardians(links) {
      if (!sk) return Promise.resolve(null);
      const clean3 = {};
      for (const [c, ps] of Object.entries(links || {})) {
        const arr = [...new Set((ps || []).filter(Boolean))];
        if (c && arr.length) clean3[c] = arr;
      }
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", GUARDIANS_D + pub], ["t", NET]], content: JSON.stringify({ links: clean3 }) }, sk));
    },
    // ---- joining: by default anyone with the invite/QR joins instantly. A steward can switch on
    // "require approval", and then a new member is held as a pending request until admitted. The relay
    // reads joinpolicy:<churchpub> + the admitted:<churchpub> allowlist and withholds posting until then. ----
    subscribeJoinPolicy(onPolicy) {
      let approval = false;
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d !== JOINPOLICY_D + pub) return;
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) approval = false;
          else {
            try {
              approval = !!JSON.parse(e.content).approval;
            } catch {
              approval = false;
            }
          }
          onPolicy(approval);
        },
        oneose() {
          onPolicy(approval);
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    setJoinPolicy(approval) {
      if (!sk) return Promise.resolve(null);
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", JOINPOLICY_D + pub], ["t", NET]], content: JSON.stringify({ approval: !!approval }) }, sk));
    },
    subscribeAdmitted(onList) {
      let cur = [];
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d !== ADMITTED_D + pub) return;
          try {
            cur = JSON.parse(e.content).pubkeys || [];
          } catch {
            cur = [];
          }
          onList(cur);
        },
        oneose() {
          onList(cur);
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    setAdmitted(pubkeys) {
      if (!sk) return Promise.resolve(null);
      const list = [...new Set((pubkeys || []).filter(Boolean))];
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", ADMITTED_D + pub], ["t", NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
    },
    // ---- delegated stewards: the OWNER (this church key) signs a roster of co-steward pubkeys. The relay
    // grants those keys day-to-day church powers (but never the roster/blocklist/relay-policy — owner-only),
    // and revocation = re-publish the roster without them. See STEWARD-ROSTER-DESIGN.md. ----
    subscribeStewards(onList) {
      let cur = [];
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d !== STEWARDS_D + pub) return;
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) cur = [];
          else {
            try {
              cur = JSON.parse(e.content).pubkeys || [];
            } catch {
              cur = [];
            }
          }
          onList(cur);
        },
        oneose() {
          onList(cur);
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    setStewards(pubkeys) {
      if (!sk) return Promise.resolve(null);
      const list = [...new Set((pubkeys || []).filter(Boolean))];
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", STEWARDS_D + pub], ["t", NET]], content: JSON.stringify({ pubkeys: list }) }, sk));
    },
    // ---- encrypted church docs: NIP-44 self-encryption to the CHURCH key. Used by the optional Finance
    // module so sensitive donor PII + ledger never hit the relay in plaintext — only the church key (held
    // in Keykeeper on the steward's device) can read them. The finance module talks only to these
    // primitives, never to the raw key. ----
    encSelf(obj) {
      if (!churchSk || !churchPub) return null;
      try {
        return encrypt3(JSON.stringify(obj), getConversationKey(churchSk, churchPub));
      } catch (e) {
        return null;
      }
    },
    decSelf(str) {
      if (!churchSk || !churchPub || !str) return null;
      try {
        return JSON.parse(decrypt3(str, getConversationKey(churchSk, churchPub)));
      } catch (e) {
        return null;
      }
    },
    // publish an encrypted addressable church doc (kind-30078, signed by the church key)
    encPublish(dtag, obj) {
      if (!churchSk) return Promise.resolve(null);
      const content = window.Steward.encSelf(obj);
      if (content == null) return Promise.resolve(null);
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", dtag], ["t", NET], ["enc", "1"]], content }, churchSk));
    },
    encRemove(dtag) {
      if (!churchSk) return Promise.resolve(null);
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", dtag], ["t", NET], ["deleted", "1"]], content: "" }, churchSk));
    },
    // subscribe to all encrypted church docs whose d-tag starts with `prefix`; decrypts each and emits a
    // live array of { id (the d-tag suffix after prefix), ...decrypted, ts }. Returns an unsubscribe fn.
    encSubscribe(prefix, cb) {
      if (!churchPub) {
        cb([]);
        return () => {
        };
      }
      const byId = /* @__PURE__ */ new Map();
      const emit = () => cb([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [churchPub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(prefix)) return;
          const id = d.slice(prefix.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          const obj = window.Steward.decSelf(e.content);
          if (obj == null) return;
          byId.set(id, { id, ...obj, ts: e.created_at });
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
    // ---- moderation: pin a message at the top of a group's chat ----
    // One addressable doc per group (d=pin:<groupId>), scoped to the group's 't' tag so a group leader
    // could publish it too (the relay accepts pin docs from a group's leaders, like events). Content
    // carries the pinned message snapshot so both apps render the banner without re-fetching the message.
    pinPost(groupId, msg) {
      if (!sk || !groupId || !msg || !msg.id) return Promise.resolve(null);
      const content = JSON.stringify({ msgId: msg.id, text: msg.text || "", by: msg.by || "", ts: msg.ts || now() });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", PIN_D + groupId], ["t", NET], ["t", groupId], ["p", pub]], content }));
    },
    unpin(groupId) {
      if (!sk || !groupId) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", PIN_D + groupId], ["t", NET], ["t", groupId], ["p", pub], ["deleted", "1"]], content: "" }));
    },
    // the current pin for one group → cb({ msgId, text, by, ts }) or cb(null) when unpinned. Unsub fn.
    subscribeGroupPin(groupId, cb) {
      let latest = 0;
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#d": [PIN_D + groupId] }], {
        onevent(e) {
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
    // ---- moderation: hide (remove) a specific member's message from a group's chat ----
    // One addressable doc per message (d=hidden:<msgId>), scoped to the group's 't' tag so a group leader
    // can also remove a message (relay accepts hide docs from the group's leaders). This is a CLIENT-SIDE
    // hide — the kind-1 event still exists on the relay; both chat views filter out hidden ids. A relay-side
    // drop is a possible stronger follow-on (mirrors the existing blocklist's hide-vs-purge model).
    hideMessage(groupId, msgId) {
      if (!sk || !msgId) return Promise.resolve(null);
      const tags = [["d", HIDE_D + msgId], ["t", NET], ["p", pub]];
      if (groupId) tags.push(["t", groupId]);
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags, content: JSON.stringify({ groupId: groupId || "" }) }, sk));
    },
    unhideMessage(groupId, msgId) {
      if (!sk || !msgId) return Promise.resolve(null);
      const tags = [["d", HIDE_D + msgId], ["t", NET], ["p", pub], ["deleted", "1"]];
      if (groupId) tags.push(["t", groupId]);
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags, content: "" }, sk));
    },
    // the set of hidden message ids → cb(Set<msgId>) on every change. Unsub fn.
    subscribeHidden(cb) {
      const hidden = /* @__PURE__ */ new Map();
      const emit = () => cb(new Set([...hidden.entries()].filter(([, h]) => h).map(([id]) => id)));
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#p": [pub] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(HIDE_D)) return;
          const msgId = d.slice(HIDE_D.length);
          hidden.set(msgId, !(e.tags.some((t) => t[0] === "deleted") || !e.content));
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
    subscribeGroups(onGroups) {
      const CACHE_KEY = "trinityone.steward.groups." + (pub || "");
      const byId = /* @__PURE__ */ new Map();
      const emit = () => {
        const arr = [...byId.values()].sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || (a.ts || 0) - (b.ts || 0));
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
        } catch {
        }
        onGroups(arr);
      };
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
        if (Array.isArray(cached)) {
          cached.forEach((g) => {
            if (g && g.id != null) byId.set(g.id, g);
          });
          if (cached.length) onGroups(cached);
        }
      } catch {
      }
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (d.startsWith(GROUPKEY_D)) {
            stewIngestKey(e);
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
            byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at });
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
    // ---- reading plans the church shares with the congregation ----
    // Published as a signed kind-30078 (d=plan:<id>) with the full plan (days included) so member apps
    // render it without needing the plan built in. Members then start/track it locally.
    // asPub (optional) publishes the plan AS an owned network instead of the church — network-wide reading plan.
    publishPlan(plan, asPub) {
      const signer = skFor(asPub);
      if (!signer) return Promise.resolve(null);
      const id = plan.id || "plan" + Date.now();
      const pubAt = plan.publishAt && plan.publishAt > now() ? Math.floor(plan.publishAt) : 0;
      const content = JSON.stringify({ id, title: plan.title || "Plan", sub: plan.sub || "", tag: plan.tag || "", accent: plan.accent || "var(--clay)", blurb: plan.blurb || "", days: plan.days || [], publishAt: pubAt, draft: !!plan.draft });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", PLAN_D + id], ["t", NET]], content }, signer)).then((e) => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
    },
    removePlan(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", PLAN_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    subscribePlans(onPlans) {
      const CACHE_KEY = "trinityone.steward.plans." + (pub || "");
      const byId = /* @__PURE__ */ new Map();
      const emit = () => {
        const arr = [...byId.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0));
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
        } catch {
        }
        onPlans(arr);
      };
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
        if (Array.isArray(cached)) {
          cached.forEach((p) => {
            if (p && p.id != null) byId.set(p.id, p);
          });
          if (cached.length) onPlans(cached);
        }
      } catch {
      }
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(PLAN_D)) return;
          const id = d.slice(PLAN_D.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            byId.set(id, { id, ...JSON.parse(e.content), ts: e.created_at });
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
    // ---- devotionals the church shares (an uploaded text/Markdown reflection on a passage) ----
    // devo = { id?, title, ref, text }. The file (.txt or .md) is read client-side; its text is stored in the event.
    publishDevotional(devo) {
      if (!sk) return Promise.resolve(null);
      const id = devo.id || "devo" + Date.now();
      const base = { id, title: devo.title || "Devotional", ref: devo.ref || "", type: devo.type || "txt", text: devo.text || "" };
      if (typeof devo.order === "number") base.order = devo.order;
      if (devo.series) base.series = String(devo.series).slice(0, 80);
      if (devo.publishAt && devo.publishAt > now()) base.publishAt = Math.floor(devo.publishAt);
      if (devo.draft) base.draft = true;
      const content = JSON.stringify(base);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", DEVO_D + id], ["t", NET]], content })).then((e) => ({ id, ...JSON.parse(content), ts: e && e.created_at }));
    },
    removeDevotional(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", DEVO_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    subscribeDevotionals(onDevos) {
      const CACHE_KEY = "trinityone.steward.devos." + (pub || "");
      const byId = /* @__PURE__ */ new Map();
      const ord = (d) => typeof d.order === "number" ? d.order : Infinity;
      const emit = () => {
        const arr = [...byId.values()].sort((a, b) => ord(a) - ord(b) || (b.ts || 0) - (a.ts || 0));
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
        } catch {
        }
        onDevos(arr);
      };
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
        if (Array.isArray(cached)) {
          cached.forEach((it) => {
            if (it && it.id != null) byId.set(it.id, it);
          });
          if (cached.length) onDevos(cached);
        }
      } catch {
      }
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(DEVO_D)) return;
          const id = d.slice(DEVO_D.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            const c = JSON.parse(e.content);
            byId.set(id, { id, title: c.title, ref: c.ref, type: c.type, text: c.text || "", order: c.order, series: c.series || "", publishAt: c.publishAt || 0, draft: !!c.draft, hasFile: !!c.text, ts: e.created_at });
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
    // ════════════ SERVING / ROTA / CALENDAR (the coverage board) ════════════
    // A generic addressable-doc subscription over the church's own kind-30078 with a given d-prefix.
    _subAddr(prefix, map, onItems) {
      const CACHE_KEY = "trinityone.steward.addr." + prefix + (pub || "");
      const byId = /* @__PURE__ */ new Map();
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
        if (Array.isArray(cached)) {
          cached.forEach((it) => {
            if (it && it.id != null) byId.set(it.id, it);
          });
          if (cached.length) onItems(cached);
        }
      } catch {
      }
      const emit = () => {
        const arr = [...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
        } catch {
        }
        onItems(arr);
      };
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(prefix)) return;
          const id = d.slice(prefix.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            byId.set(id, { id, ...map(JSON.parse(e.content), id), ts: e.created_at });
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
    // ---- team rosters: the roles a team needs + the people who can serve ----
    // roster = { roles:[{id,name}], people:[{id,name,pub?}] }, keyed by team(group) id.
    publishRoster(teamId, roster) {
      if (!sk || !teamId) return Promise.resolve(null);
      const roles = (roster.roles || []).map((r) => ({ id: r.id || "r" + Math.random().toString(36).slice(2, 7), name: r.name || "Role" }));
      const people = (roster.people || []).map((p) => ({ id: p.id || "p" + Math.random().toString(36).slice(2, 7), name: p.name || "", pub: p.pub || "" }));
      const pods = (roster.pods || []).map((p) => ({ id: p.id || "pod" + Math.random().toString(36).slice(2, 7), name: p.name || "Pod", fills: p.fills && typeof p.fills === "object" ? p.fills : {} }));
      const content = JSON.stringify({ roles, people, pods });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", ROSTER_D + teamId], ["t", NET]], content })).then(() => ({ id: teamId, roles, people, pods }));
    },
    subscribeRosters(onRosters) {
      return this._subAddr(ROSTER_D, (c, id) => ({ team: id, roles: c.roles || [], people: c.people || [], pods: c.pods || [] }), onRosters);
    },
    // ---- services: a dated gathering people serve at ----
    // service = { id?, date:'YYYY-MM-DD', time:'10:30', name }
    publishService(svc) {
      if (!sk) return Promise.resolve(null);
      const id = svc.id || "svc" + Date.now();
      const content = JSON.stringify({ date: svc.date || "", time: svc.time || "10:30", name: svc.name || "Sunday Gathering" });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", SERVICE_D + id], ["t", NET]], content })).then(() => ({ id, ...JSON.parse(content) }));
    },
    removeService(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", SERVICE_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    subscribeServices(onServices) {
      return this._subAddr(SERVICE_D, (c) => ({ date: c.date, time: c.time, name: c.name }), onServices);
    },
    // ---- run sheets: a service's order-of-service + song setlist (d=runsheet:<serviceId>) ----
    publishRunsheet(serviceId, items) {
      if (!sk || !serviceId) return Promise.resolve(null);
      const content = JSON.stringify({ items: Array.isArray(items) ? items : [] });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", RUNSHEET_D + serviceId], ["t", NET]], content }));
    },
    subscribeRunsheets(onSheets) {
      return this._subAddr(RUNSHEET_D, (c) => ({ items: Array.isArray(c.items) ? c.items : [] }), onSheets);
    },
    // ---- kids check-in (ENCRYPTED to the church key: a child's presence + pickup code never leave plaintext,
    // so the relay + other members can't see them). Run by the church-key holder; d=checkin:<id>. ----
    publishCheckin(rec) {
      const id = rec.id || "ci" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      return window.Steward.encPublish("trinityone/checkin:" + id, {
        id,
        child: rec.child || "",
        childName: rec.childName || "",
        date: rec.date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        in: rec.in || Math.floor(Date.now() / 1e3),
        out: rec.out != null ? rec.out : null,
        code: rec.code || "",
        room: rec.room || "",
        note: rec.note || ""
      });
    },
    removeCheckin(id) {
      return window.Steward.encRemove("trinityone/checkin:" + id);
    },
    subscribeCheckins(cb) {
      return window.Steward.encSubscribe("trinityone/checkin:", cb);
    },
    // ---- rooms & bookings: a shared room calendar (steward-booked) ----
    // room = { id?, name, capacity?, note? } ; booking = { id?, roomId, date:'YYYY-MM-DD', start:'HH:MM', end:'HH:MM', title, note }
    publishRoom(room) {
      if (!sk) return Promise.resolve(null);
      const id = room.id || "room" + Date.now();
      const content = JSON.stringify({ name: (room.name || "Room").trim(), capacity: room.capacity || "", note: (room.note || "").trim() });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", ROOM_D + id], ["t", NET]], content })).then(() => ({ id, ...JSON.parse(content) }));
    },
    removeRoom(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", ROOM_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    subscribeRooms(cb) {
      return this._subAddr(ROOM_D, (c) => ({ name: c.name, capacity: c.capacity, note: c.note }), cb);
    },
    publishBooking(b) {
      if (!sk || !b || !b.roomId) return Promise.resolve(null);
      const id = b.id || "bk" + Date.now();
      const content = JSON.stringify({ roomId: b.roomId, date: b.date || "", start: b.start || "", end: b.end || "", title: (b.title || "").trim(), note: (b.note || "").trim() });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", BOOKING_D + id], ["t", NET]], content })).then(() => ({ id, ...JSON.parse(content) }));
    },
    removeBooking(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", BOOKING_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    subscribeBookings(cb) {
      return this._subAddr(BOOKING_D, (c, id) => ({ roomId: c.roomId, date: c.date, start: c.start, end: c.end, title: c.title, note: c.note }), cb);
    },
    // ---- rota: assignments for one service (latest wins; published flag) ----
    // rota = { service:<serviceId>, published:bool, assign:{ '<teamId>::<roleId>': {name, pub} } }
    publishRota(rota) {
      if (!sk || !rota || !rota.service) return Promise.resolve(null);
      const content = JSON.stringify({ service: rota.service, published: !!rota.published, assign: rota.assign || {} });
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", ROTA_D + rota.service], ["t", NET]], content })).then(() => ({ id: rota.service, service: rota.service, published: !!rota.published, assign: rota.assign || {} }));
    },
    removeRota(serviceId) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", ROTA_D + serviceId], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    subscribeRotas(onRotas) {
      return this._subAddr(ROTA_D, (c, id) => ({ service: id, published: !!c.published, assign: c.assign || {} }), onRotas);
    },
    // ---- calendar events (non-serving: workdays, lunches, prayer evenings…) ----
    // event = { id?, date, time, title, where, blurb, accent }
    // asPub (optional) publishes the event AS an owned network instead of the church — network-wide event.
    publishEvent(ev, asPub) {
      const signer = skFor(asPub);
      if (!signer) return Promise.resolve(null);
      const id = ev.id || "evt" + Date.now();
      const groupId = ev.groupId || "";
      const content = JSON.stringify({ date: ev.date || "", time: ev.time || "", title: ev.title || "Event", where: ev.where || "", blurb: ev.blurb || "", accent: ev.accent || "var(--clay)", image: ev.image || "", groupId });
      const tags = [["d", EVENT_D + id], ["t", NET]];
      if (groupId) tags.push(["t", groupId]);
      if (actingChurch) tags.push(["p", actingChurch]);
      return publish(feChurch({ kind: 30078, created_at: now(), tags, content }, signer)).then(() => ({ id, ...JSON.parse(content) }));
    },
    removeEvent(id) {
      if (!sk) return Promise.resolve(null);
      return publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", EVENT_D + id], ["t", NET], ["deleted", "1"]], content: "" }));
    },
    subscribeEvents(onEvents) {
      return this._subAddr(EVENT_D, (c) => ({ date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent }), onEvents);
    },
    // a single group's upcoming events (for the group chat window) — the church's own + its stewards' (church-tagged)
    subscribeGroupEvents(groupId, onEvents) {
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onEvents([...byId.values()].sort((a, b) => (a.date || "").localeCompare(b.date || "")));
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#t": [groupId] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(EVENT_D)) return;
          if (e.pubkey !== pub && !e.tags.some((t) => (t[0] === "p" || t[0] === "church") && t[1] === pub)) return;
          const id = d.slice(EVENT_D.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            const c = JSON.parse(e.content);
            byId.set(id, { id, date: c.date, time: c.time, title: c.title, where: c.where, blurb: c.blurb, accent: c.accent });
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
    // ---- serving requests: steward -> a member "can you serve?" (p-tagged to the member) ----
    sendServingRequest(req) {
      if (!sk || !req || !req.memberPub) return Promise.resolve(null);
      const id = req.id || "req" + Date.now();
      const content = JSON.stringify({ serviceId: req.serviceId || "", teamId: req.teamId || "", roleId: req.roleId || "", role: req.role || "", teamName: req.teamName || "", icon: req.icon || "hand", accent: req.accent || "var(--clay)", date: req.date || "", time: req.time || "", service: req.service || "", from: req.from || "Your church", note: req.note || "" });
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", REQUEST_D + id], ["t", NET], ["p", req.memberPub]], content }, sk)).then(() => ({ id, ...JSON.parse(content), memberPub: req.memberPub }));
    },
    // the church's own "can you serve?" request docs (so the board can join replies to a slot)
    subscribeRequests(onRequests) {
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onRequests([...byId.values()]);
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(REQUEST_D)) return;
          const id = d.slice(REQUEST_D.length);
          const memberPub = (e.tags.find((t) => t[0] === "p") || [])[1] || "";
          if (!e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            byId.set(id, { id, memberPub, ...JSON.parse(e.content), ts: e.created_at });
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
    // the steward's view of replies members sent back (reqreply docs p-tagged to the church)
    subscribeRequestReplies(onReplies) {
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onReplies([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#p": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(REQREPLY_D)) return;
          const id = d.slice(REQREPLY_D.length);
          if (!e.content) {
            byId.delete(id);
            emit();
            return;
          }
          try {
            byId.set(id, { id, by: e.pubkey, ...JSON.parse(e.content), ts: e.created_at });
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
    // member unavailability docs p-tagged to the church -> { memberPub: [dates] } (for "Away" + Auto-fill)
    subscribeUnavail(onUnavail) {
      const UNAVAIL_D = "trinityone/unavail:";
      const byMember = {};
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#p": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(UNAVAIL_D)) return;
          try {
            byMember[e.pubkey] = JSON.parse(e.content).dates || [];
            onUnavail({ ...byMember });
          } catch {
          }
        },
        oneose() {
          onUnavail({ ...byMember });
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
      };
    },
    // member RSVPs p-tagged to the church -> { eventId: { memberPub: v } } (for "going" counts)
    subscribeRsvps(onRsvps) {
      const RSVP_D = "trinityone/rsvp:";
      const byEvent = {};
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#p": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(RSVP_D)) return;
          const ev = d.slice(RSVP_D.length);
          try {
            (byEvent[ev] = byEvent[ev] || {})[e.pubkey] = JSON.parse(e.content).v;
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
    // ---- members: people who participate in this church's chat ----
    // In an anonymous, self-custodial model there is no follower registry. The real, privacy-
    // respecting signal a steward can see is participation: members tag their messages with the
    // church's pubkey (['p', churchPub]), so we read kind-1 events addressed to us, aggregate by
    // author, and resolve each author's kind-0 profile. The church's own posts are excluded.
    subscribeMembers(onMembers) {
      const MEMBER_D = "trinityone/member:";
      const CACHE_KEY = "trinityone.steward.members." + (pub || "");
      const byPub = /* @__PURE__ */ new Map();
      const profSubs = /* @__PURE__ */ new Map();
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
        if (Array.isArray(cached)) {
          cached.forEach((m) => {
            if (m && m.pubkey) byPub.set(m.pubkey, m);
          });
          if (cached.length) onMembers(cached);
        }
      } catch {
      }
      const emit = () => {
        const arr = [...byPub.values()].sort((a, b) => (b.lastTs || b.joined || 0) - (a.lastTs || a.joined || 0));
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(arr));
        } catch {
        }
        onMembers(arr);
      };
      const get = (pk) => byPub.get(pk) || { pubkey: pk, npub: npubEncode(pk), name: "", picture: "", count: 0, lastTs: 0, firstTs: Infinity, joined: 0 };
      const ensureProfile = (pk) => {
        if (profSubs.has(pk)) return;
        const s = pool.subscribeMany(relays(), [{ kinds: [0], authors: [pk] }], {
          onevent(e) {
            try {
              const meta = JSON.parse(e.content);
              const m = byPub.get(pk);
              if (m) {
                m.name = meta.name || meta.display_name || "";
                m.picture = meta.picture || "";
                m.nip05 = meta.nip05 || "";
                m.av = meta.av || void 0;
                m.hasPhoto = !!(meta.av && meta.av.kind === "photo" && meta.av.photo);
                emit();
              }
            } catch {
            }
          },
          oneose() {
          }
        });
        profSubs.set(pk, s);
      };
      const sub = pool.subscribeMany(relays(), [{ kinds: [1], "#p": [pub] }, { kinds: [30078], "#p": [pub] }], {
        onevent(e) {
          if (e.pubkey === pub) return;
          if (e.kind === 30078) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            if (!d.startsWith(MEMBER_D)) return;
            const left = e.tags.some((t) => t[0] === "deleted") || !e.content;
            const m2 = get(e.pubkey);
            if (left) {
              m2.joined = 0;
              if (m2.count === 0) {
                byPub.delete(e.pubkey);
                emit();
                return;
              }
            } else {
              let j = e.created_at;
              try {
                j = JSON.parse(e.content).joined || e.created_at;
              } catch {
              }
              m2.joined = j;
            }
            byPub.set(e.pubkey, m2);
            ensureProfile(e.pubkey);
            emit();
            return;
          }
          const m = get(e.pubkey);
          m.count++;
          if (e.created_at > m.lastTs) m.lastTs = e.created_at;
          if (e.created_at < m.firstTs) m.firstTs = e.created_at;
          byPub.set(e.pubkey, m);
          ensureProfile(e.pubkey);
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
        for (const s of profSubs.values()) {
          try {
            s.close();
          } catch {
          }
        }
      };
    },
    // ---- church profile (kind-0): name etc. shown to members and in the console ----
    subscribeProfile(onProfile) {
      let latest = 0;
      try {
        if (lastProfile && Object.keys(lastProfile).length) onProfile(lastProfile);
      } catch {
      }
      const sub = pool.subscribeMany(relays(), [{ kinds: [0], authors: [pub] }], {
        onevent(e) {
          if (e.created_at < latest) return;
          latest = e.created_at;
          try {
            const p = JSON.parse(e.content);
            lastProfile = { ...lastProfile, ...p };
            onProfile(p);
            try {
              window.dispatchEvent(new CustomEvent("steward-profile", { detail: lastProfile }));
            } catch (x) {
            }
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
    // ---- networks: a church declares it belongs to a wider group/network (its own npub) ----
    // The church publishes network:<networkPub> (p-tagged to the network). Members of the church
    // discover the network and can follow it — its groups/events/plans load like any church.
    joinNetwork(input) {
      if (!sk) return Promise.resolve(null);
      const np = toPubHex(input);
      if (!np) return Promise.resolve(null);
      const content = JSON.stringify({ joined: true });
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", NETWORK_D + np], ["t", NET], ["p", np]], content }, sk)).then(() => ({ networkPub: np, npub: npubEncode(np) }));
    },
    leaveNetwork(networkPub) {
      if (!sk) return Promise.resolve(null);
      const np = toPubHex(networkPub) || networkPub;
      return publish(finalizeEvent2({ kind: 30078, created_at: now(), tags: [["d", NETWORK_D + np], ["t", NET], ["deleted", "1"]], content: "" }, sk));
    },
    // create a brand-new network: generate its key, join it (so the relay lets it post here), then
    // publish the network's profile + a starter announcements channel (signed by the network key).
    // Returns { npub, mnemonic } — save/share these to run the network's own console later.
    async createNetwork(name) {
      if (!sk) return null;
      const m = generateSeedWords();
      const nsk = privateKeyFromSeedWords(m);
      const nPub = getPublicKey2(nsk);
      saveNetKey({ pub: nPub, mnemonic: m, name: name || "Network" });
      await window.Steward.joinNetwork(nPub);
      await publish(finalizeEvent2({ kind: 0, created_at: now(), tags: [], content: JSON.stringify({ name: name || "Network" }) }, nsk));
      await publish(feChurch({ kind: 30078, created_at: now(), tags: [["d", GROUP_D + "net-announce"], ["t", NET]], content: JSON.stringify({ name: "Announcements", kind: "broadcast", sub: "From " + (name || "the network"), icon: "globe", accent: "var(--clay)" }) }, nsk));
      window.dispatchEvent(new CustomEvent("steward-networks"));
      return { networkPub: nPub, npub: npubEncode(nPub), mnemonic: m };
    },
    // networks whose signing key is on THIS console -> [{ pub, npub, name }] (publish-as identities)
    ownedNetworks() {
      return netKeys().map((r) => ({ pub: r.pub, npub: npubEncode(r.pub), name: r.name || "Network" }));
    },
    // post a broadcast announcement AS an owned network (kind-1 into the net-announce channel)
    publishNetworkAnnouncement(networkPub, text) {
      const signer = skFor(networkPub);
      if (!signer || !text || !text.trim()) return Promise.resolve(null);
      return publish(finalizeEvent2({ kind: 1, created_at: now(), tags: [["t", NET], ["t", "net-announce"], ["p", networkPub]], content: text.trim() }, signer));
    },
    // a network's broadcast announcements (most recent first) — for previewing on the console
    subscribeNetworkAnnouncements(networkPub, onPosts) {
      const np = toPubHex(networkPub) || networkPub;
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onPosts([...byId.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0)));
      const sub = pool.subscribeMany(relays(), [{ kinds: [1], authors: [np], "#t": ["net-announce"] }], {
        onevent(e) {
          byId.set(e.id, { id: e.id, text: e.content, ts: e.created_at });
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
    // import an existing network's recovery phrase so this console can also publish as it
    importNetworkKey(mnemonic, name) {
      const mm = (mnemonic || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (mm.split(" ").length < 12) throw new Error("Enter the full 12-word recovery phrase.");
      const nsk = privateKeyFromSeedWords(mm);
      const nPub = getPublicKey2(nsk);
      saveNetKey({ pub: nPub, mnemonic: mm, name: name || "Network" });
      window.dispatchEvent(new CustomEvent("steward-networks"));
      return { networkPub: nPub, npub: npubEncode(nPub) };
    },
    // every identity this console can publish as: the church + any owned networks + any church we STEWARD
    identities() {
      const held = /* @__PURE__ */ new Set([churchPub, ...netKeys().map((r) => r.pub)]);
      return [
        { kind: "church", pub: churchPub, npub: churchPub ? npubEncode(churchPub) : "" },
        ...netKeys().map((r) => ({ kind: "network", pub: r.pub, npub: npubEncode(r.pub), name: r.name || "Network" })),
        ...[...stewardedChurches.entries()].filter(([cp]) => !held.has(cp)).map(([cp, m]) => ({ kind: "steward", pub: cp, npub: npubEncode(cp), name: m && m.name || "Church" }))
      ];
    },
    // switch the WHOLE console between the church, an owned network, or a church we steward (delegated) —
    // the active signing+reading identity. Subscriptions are keyed on activePub, so the dashboard re-renders.
    setActiveIdentity(targetPub) {
      const tp = toPubHex(targetPub) || targetPub || churchPub;
      if (tp === churchPub) {
        sk = churchSk;
        pub = churchPub;
        actingChurch = "";
      } else if (stewardedChurches.has(tp)) {
        sk = churchSk;
        pub = tp;
        actingChurch = tp;
      } else {
        const rec = netKeys().find((x) => x.pub === tp);
        if (!rec) return false;
        try {
          sk = privateKeyFromSeedWords(rec.mnemonic);
          pub = getPublicKey2(sk);
          actingChurch = "";
        } catch {
          return false;
        }
      }
      lastProfile = {};
      window.Steward.pubkey = pub;
      window.Steward.npub = npubEncode(pub);
      window.Steward.activePub = pub;
      window.Steward.actingChurch = actingChurch;
      window.dispatchEvent(new CustomEvent("steward-identity", { detail: { pub, actingChurch } }));
      return true;
    },
    isViewingNetwork() {
      return pub !== churchPub && !actingChurch;
    },
    isDelegated() {
      return !!actingChurch;
    },
    // discover churches whose owner-signed roster lists OUR key → we can act as their steward. Re-emits on change.
    subscribeStewardedChurches(cb) {
      const me = churchPub;
      const CACHE = "trinityone.steward.stewarded." + (me || "");
      const save = () => {
        try {
          lsSet(CACHE, JSON.stringify([...stewardedChurches.entries()].map(([cp, m]) => ({ cp, name: m && m.name || "" }))));
        } catch {
        }
      };
      const _ownedPubs = /* @__PURE__ */ new Set([me, ...netKeys().map((r) => r.pub)]);
      try {
        (JSON.parse(lsGet(CACHE) || "[]") || []).forEach((c) => {
          if (c && c.cp && !_ownedPubs.has(c.cp)) stewardedChurches.set(c.cp, { name: c.name || "Church" });
        });
      } catch {
      }
      const nameSubs = /* @__PURE__ */ new Map();
      const resolveName = (cp) => {
        if (nameSubs.has(cp)) return;
        nameSubs.set(cp, pool.subscribeMany(relays(), [{ kinds: [0], authors: [cp] }], {
          onevent(e) {
            try {
              const nm = JSON.parse(e.content).name || "";
              if (nm && stewardedChurches.has(cp) && stewardedChurches.get(cp).name !== nm) {
                stewardedChurches.set(cp, { name: nm });
                save();
                cb([...stewardedChurches.keys()]);
              }
            } catch {
            }
          },
          oneose() {
          }
        }));
      };
      if (stewardedChurches.size) cb([...stewardedChurches.keys()]);
      [...stewardedChurches.keys()].forEach(resolveName);
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(STEWARDS_D)) return;
          const cp = d.slice(STEWARDS_D.length);
          if (cp === me) return;
          let listed = false;
          if (!(e.tags.some((t) => t[0] === "deleted") || !e.content)) {
            try {
              listed = (JSON.parse(e.content).pubkeys || []).includes(me);
            } catch {
            }
          }
          const had = stewardedChurches.has(cp);
          if (listed && !had) {
            stewardedChurches.set(cp, { name: "Church" });
            save();
            resolveName(cp);
            cb([...stewardedChurches.keys()]);
          } else if (!listed && had) {
            stewardedChurches.delete(cp);
            save();
            if (actingChurch === cp) window.Steward.setActiveIdentity(churchPub);
            cb([...stewardedChurches.keys()]);
          }
        },
        oneose() {
          cb([...stewardedChurches.keys()]);
        }
      });
      return () => {
        try {
          sub.close();
        } catch {
        }
        for (const s of nameSubs.values()) {
          try {
            s.close();
          } catch {
          }
        }
      };
    },
    // this church's network memberships -> [{ networkPub, npub }]
    subscribeNetworks(onNetworks) {
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onNetworks([...byId.values()]);
      const sub = pool.subscribeMany(relays(), [{ kinds: [30078], authors: [pub], "#t": [NET] }, { kinds: [30078], "#church": [pub], "#t": [NET] }], {
        onevent(e) {
          const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
          if (!d.startsWith(NETWORK_D)) return;
          const np = d.slice(NETWORK_D.length);
          if (e.tags.some((t) => t[0] === "deleted") || !e.content) {
            byId.delete(np);
            emit();
            return;
          }
          byId.set(np, { networkPub: np, npub: npubEncode(np) });
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
    // resolve a network's display name (its kind-0 profile)
    subscribeNetworkProfile(networkPub, onProfile) {
      const np = toPubHex(networkPub) || networkPub;
      let latest = 0;
      const sub = pool.subscribeMany(relays(), [{ kinds: [0], authors: [np] }], {
        onevent(e) {
          if (e.created_at < latest) return;
          latest = e.created_at;
          let prof;
          try {
            prof = JSON.parse(e.content);
          } catch {
            return;
          }
          onProfile(prof);
          if (prof && prof.name) {
            const rec = netKeys().find((x) => x.pub === np);
            if (rec && rec.name !== prof.name) {
              saveNetKey({ ...rec, name: prof.name });
              window.dispatchEvent(new CustomEvent("steward-networks"));
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
    // ---- relays: the church's relay(s) — real status, not a mock ----
    relayList() {
      return relays();
    },
    ownRelay() {
      return ownRelay();
    },
    extraRelays() {
      return extraRelays();
    },
    // register THIS church with the relay's write policy so it stops rejecting our publishes. Needs the
    // relay's admin token (the steward running the relay has it — relay/admin.json / installer output).
    // Idempotent; works cross-origin (the relay's /config sends CORS + is token-gated).
    configBase() {
      return ownRelay().replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/relay\/?$/i, "");
    },
    async registerWithRelay(token, name) {
      const url = window.Steward.configBase() + "/config";
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + String(token || "").trim() },
        body: JSON.stringify({ addChurch: { npub: window.Steward.npub, name: name || "" } })
      });
      if (r.status === 401) throw new Error("That admin token wasn\u2019t accepted.");
      if (!r.ok) {
        let m = "";
        try {
          m = (await r.json()).error;
        } catch {
        }
        throw new Error(m || "the relay responded " + r.status);
      }
      return r.json();
    },
    // self-register this church with the shared pool relays by PROVING key ownership (NIP-98 signed by the
    // church key) — no admin token, and a church can only ever register its own npub. Called automatically
    // on console load, so onboarding a new church needs zero manual relay setup.
    async selfRegister(name) {
      if (!churchSk || !churchPub) return;
      const np = npubEncode(churchPub);
      const bases = /* @__PURE__ */ new Set([window.Steward.configBase()]);
      for (const r of CANONICAL_RELAYS) bases.add(r.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/relay\/?$/i, ""));
      for (const base of bases) {
        const url = base + "/config";
        try {
          const auth = finalizeEvent2({ kind: 27235, created_at: now(), tags: [["u", url], ["method", "POST"]], content: "" }, churchSk);
          await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addChurch: { npub: np, name: name || "" }, auth }) });
        } catch (e) {
        }
      }
    },
    // add a public relay the church ALSO publishes to (redundancy if the self-hosted relay is offline)
    addRelay(input) {
      const url = normRelay(input);
      if (!url || url === ownRelay()) return false;
      const cur = extraRelays();
      if (cur.includes(url)) return false;
      lsSet(RELAYS_LS, JSON.stringify([...cur, url]));
      window.dispatchEvent(new CustomEvent("steward-relays"));
      return url;
    },
    removeRelay(url) {
      const next = extraRelays().filter((r) => r !== url);
      lsSet(RELAYS_LS, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("steward-relays"));
      return true;
    },
    // probe each relay with a throwaway WS; resolves [{ url, status:'on'|'off', ms }]
    relayStatus() {
      return Promise.all(relays().map((url) => new Promise((res) => {
        let done = false;
        const t0 = Date.now();
        const finish = (status) => {
          if (done) return;
          done = true;
          try {
            ws.close();
          } catch {
          }
          res({ url, status, ms: status === "on" ? Date.now() - t0 : null });
        };
        let ws;
        try {
          ws = new WebSocket(url);
        } catch {
          return res({ url, status: "off", ms: null });
        }
        const to = setTimeout(() => finish("off"), 2500);
        ws.onopen = () => {
          clearTimeout(to);
          finish("on");
        };
        ws.onerror = () => {
          clearTimeout(to);
          finish("off");
        };
      })));
    },
    // live count of the church's footprint on the relay (its own events + everything addressed to it),
    // plus how many of those are the church's own announcements (kind-1 it authored)
    subscribeStats(onStats) {
      const ids = /* @__PURE__ */ new Set(), ann = /* @__PURE__ */ new Set();
      const emit = () => onStats({ events: ids.size, announcements: ann.size });
      const sub = pool.subscribeMany(relays(), [{ authors: [pub] }, { "#p": [pub] }], {
        onevent(e) {
          ids.add(e.id);
          if (e.kind === 1 && e.pubkey === pub) ann.add(e.id);
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
    // a live, recent activity feed derived from real events (groups, joins, posts) — newest first
    subscribeActivity(onActivity, max = 12) {
      const byId = /* @__PURE__ */ new Map();
      const emit = () => onActivity([...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, max));
      const sub = pool.subscribeMany(relays(), [{ kinds: [1, 30078], authors: [pub] }, { kinds: [1, 30078], "#p": [pub] }], {
        onevent(e) {
          const own = e.pubkey === pub;
          let item = null;
          if (e.kind === 30078) {
            const d = (e.tags.find((t) => t[0] === "d") || [])[1] || "";
            const deleted = e.tags.some((t) => t[0] === "deleted") || !e.content;
            if (d.startsWith(GROUP_D)) {
              let n = "";
              try {
                n = JSON.parse(e.content).name;
              } catch {
              }
              item = { ic: "chat", tint: "sage", text: deleted ? "A group was removed" : `Group \u201C${n || "untitled"}\u201D ${own ? "created" : "updated"}`, gid: deleted ? "" : d.slice(GROUP_D.length) };
            } else if (d.startsWith("trinityone/member:")) {
              if (!deleted) item = { ic: "pray", tint: "sage", text: "A new member joined", to: "members" };
            } else if (d.startsWith(FUND_D)) {
              let n = "";
              try {
                n = JSON.parse(e.content).name;
              } catch {
              }
              item = { ic: "gift", tint: "gold", text: deleted ? "A fund was removed" : `Fund \u201C${n || ""}\u201D updated`, to: "finance" };
            }
          } else if (e.kind === 1) {
            const g = (e.tags.find((t) => t[0] === "t" && t[1] !== NET) || [])[1] || "";
            if (own) item = { ic: "send", tint: "gold", text: "You posted an announcement", gid: g || "" };
            else item = { ic: "chat", tint: "clay", text: "New message in a group", gid: g || "" };
          }
          if (item) {
            byId.set(e.id, { id: e.id, ts: e.created_at, ...item });
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
    },
    // ---- join flow: members follow the church by its npub ----
    // The member app at the gateway root reads ?follow=<npub> and follows the church.
    joinUrl() {
      const np = window.Steward.npub || "";
      const o = typeof location !== "undefined" && location.origin || "";
      const PUBLIC_BASE = "https://trinityone.pages.dev";
      const isPublic = /^https:\/\//i.test(o) && !/^https:\/\/(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(o);
      const base = isPublic ? o : PUBLIC_BASE;
      const relay = ownRelay();
      return base + "/?follow=" + np + "&relay=" + encodeURIComponent(relay);
    },
    // a short, human-shareable code (the npub itself — paste-able into the member app's "Follow a church")
    joinCode() {
      return window.Steward.npub || "";
    },
    // a real QR encoding the join URL; scan with a phone camera to open the app already following.
    joinQR() {
      const qr = (0, import_qrcode_generator.default)(0, "M");
      qr.addData(window.Steward.joinUrl());
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    },
    // generic QR (used for the handoff code) — any text → scalable SVG string
    qrSVG(text) {
      try {
        const qr = (0, import_qrcode_generator.default)(0, "M");
        qr.addData(String(text || ""));
        qr.make();
        return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      } catch (e) {
        return "";
      }
    }
  };
  window.Steward.init();
})();
