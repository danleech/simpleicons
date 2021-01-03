const fs = require('fs');

const data = require("./_data/simple-icons.json");
const { htmlFriendlyToTitle } = require("./scripts/utils.js");
const svgPath = require("svgpath");
const { svgPathBbox } = require("svg-path-bbox");

const titleRegexp = /(.+) icon$/;
const svgRegexp = /^<svg( [^\s]*=".*"){3}><title>.*<\/title><path d=".*"\/><\/svg>\r?\n?$/;
const negativeZerosRegexp = /-0(?=[^\.]|[\s\d\w]|$)/g;

const iconSize = 24;
const iconFloatPrecision = 3;
const iconMaxFloatPrecision = 5;
const iconTolerance = 0.001;

// set env SI_UPDATE_IGNORE to recreate the ignore file
const updateIgnoreFile = process.env.SI_UPDATE_IGNORE === 'true'
const ignoreFile = "./.svglint-ignored.json";
const iconIgnored = !updateIgnoreFile ? require(ignoreFile) : {};

function sortObjectByKey(obj) {
  return Object
    .keys(obj)
    .sort()
    .reduce((r, k) => Object.assign(r, { [k]: obj[k] }), {});
}

function sortObjectByValue(obj) {
  return Object
    .keys(obj)
    .sort((a, b) => ('' + obj[a]).localeCompare(obj[b]))
    .reduce((r, k) => Object.assign(r, { [k]: obj[k] }), {});
}

function removeLeadingZeros(number) {
  // convert 0.03 to '.03'
  return number.toString().replace(/^(-?)(0)(\.?.+)/, '$1$3');
}

const collinear = (x1, y1, x2, y2, x3, y3) => {
    return (x1 * (y2 - y3) + x2 * (y3 - y1) +  x3 * (y1 - y2)) === 0;
}

if (updateIgnoreFile) {
  process.on('exit', () => {
    // ensure object output order is consistent due to async svglint processing
    const sorted = sortObjectByKey(iconIgnored)
    for (const linterName in sorted) {
      sorted[linterName] = sortObjectByValue(sorted[linterName])
    }

    fs.writeFileSync(
      ignoreFile,
      JSON.stringify(sorted, null, 2) + '\n',
      {flag: 'w'}
    );
  });
}

function isIgnored(linterName, path) {
  return iconIgnored[linterName] && iconIgnored[linterName].hasOwnProperty(path);
}

function ignoreIcon(linterName, path, $) {
  if (!iconIgnored[linterName]) {
    iconIgnored[linterName] = {};
  }

  const title = $.find("title").text().replace(/(.*) icon/, '$1');
  const iconName = htmlFriendlyToTitle(title);

  iconIgnored[linterName][path] = iconName;
}

module.exports = {
    rules: {
        elm: {
            "svg": 1,
            "svg > title": 1,
            "svg > path": 1,
            "*": false,
        },
        attr: [
            { // ensure that the SVG elm has the appropriate attrs
                "role": "img",
                "viewBox": `0 0 ${iconSize} ${iconSize}`,
                "xmlns": "http://www.w3.org/2000/svg",
                "rule::selector": "svg",
                "rule::whitelist": true,
            },
            { // ensure that the title elm has the appropriate attr
                "rule::selector": "svg > title",
                "rule::whitelist": true,
            },
            { // ensure that the path element only has the 'd' attr (no style, opacity, etc.)
                "d": /^[,a-zA-Z0-9\. -]+$/,
                "rule::selector": "svg > path",
                "rule::whitelist": true,
            }
        ],
        custom: [
          function(reporter, $, ast) {
            reporter.name = "icon-title";

            const iconTitleText = $.find("title").text();
            if (!titleRegexp.test(iconTitleText)) {
              reporter.error("<title> should follow the format \"[ICON_NAME] icon\"");
            } else {
              const titleMatch = iconTitleText.match(titleRegexp);
              // titleMatch = [ "[ICON_NAME] icon", "[ICON_NAME]" ]
              const rawIconName = titleMatch[1];
              const iconName = htmlFriendlyToTitle(rawIconName);
              const icon = data.icons.find(icon => icon.title === iconName);
              if (icon === undefined) {
                reporter.error(`No icon with title "${iconName}" found in simple-icons.json`);
              }
            }
          },
          function(reporter, $, ast) {
            reporter.name = "icon-size";

            const iconPath = $.find("path").attr("d");
            if (!updateIgnoreFile && isIgnored(reporter.name, iconPath)) {
              return;
            }

            const [minX, minY, maxX, maxY] = svgPathBbox(iconPath);
            const width = +(maxX - minX).toFixed(iconFloatPrecision);
            const height = +(maxY - minY).toFixed(iconFloatPrecision);

            if (width === 0 && height === 0) {
              reporter.error("Path bounds were reported as 0 x 0; check if the path is valid");
              if (updateIgnoreFile) {
                ignoreIcon(reporter.name, iconPath, $);
              }
            } else if (width !== iconSize && height !== iconSize) {
              reporter.error(`Size of <path> must be exactly ${iconSize} in one dimension; the size is currently ${width} x ${height}`);
              if (updateIgnoreFile) {
                ignoreIcon(reporter.name, iconPath, $);
              }
            }
          },
          function(reporter, $, ast) {
            reporter.name = "icon-precision";

            const iconPath = $.find("path").attr("d");
            if (!updateIgnoreFile && isIgnored(reporter.name, iconPath)) {
              return;
            }

            const { segments } = svgPath(iconPath);
            const segmentParts = segments.flat().filter((num) => (typeof num === 'number'));

            const countDecimals = (num) => {
              if (num && num % 1) {
                let [base, op, trail] = num.toExponential().split(/e([+-])/);
                let elen = parseInt(trail, 10);
                let idx = base.indexOf('.');
                return idx == -1 ? elen : base.length - idx - 1 + (op === '+' ? -elen : elen);
              }
              return 0;
            };
            const precisionArray = segmentParts.map(countDecimals);
            const precisionMax = precisionArray && precisionArray.length > 0 ?
              Math.max(...precisionArray) :
              0;

            if (precisionMax > iconMaxFloatPrecision) {
              reporter.error(`Maximum precision should not be greater than ${iconMaxFloatPrecision}; it is currently ${precisionMax}`);
              if (updateIgnoreFile) {
                ignoreIcon(reporter.name, iconPath, $);
              }
            }
          },
          function(reporter, $, ast) {
            reporter.name = "ineffective-segments";

            const iconPath = $.find("path").attr("d");
            if (!updateIgnoreFile && isIgnored(reporter.name, iconPath)) {
              return;
            }

            const { segments } = svgPath(iconPath);
            const { segments: absSegments } = svgPath(iconPath).abs().unshort();

            const lowerMovementCommands = ['m', 'l'];
            const lowerDirectionCommands = ['h', 'v'];
            const lowerCurveCommand = 'c';
            const lowerShorthandCurveCommand = 's';
            const lowerCurveCommands = [lowerCurveCommand, lowerShorthandCurveCommand];
            const upperMovementCommands = ['M', 'L'];
            const upperHorDirectionCommand = 'H';
            const upperVerDirectionCommand = 'V';
            const upperDirectionCommands = [upperHorDirectionCommand, upperVerDirectionCommand];
            const upperCurveCommand = 'C';
            const upperShorthandCurveCommand = 'S';
            const upperCurveCommands = [upperCurveCommand, upperShorthandCurveCommand];
            const curveCommands = [...lowerCurveCommands, ...upperCurveCommands];
            const commands = [...lowerMovementCommands, ...lowerDirectionCommands, ...upperMovementCommands, ...upperDirectionCommands, ...curveCommands];
            const getInvalidSegments = ([command, x1Coord, y1Coord, ...rest], index) => {
              if (commands.includes(command)) {
                // Relative directions (h or v) having a length of 0
                if (lowerDirectionCommands.includes(command) && x1Coord === 0) {
                  return true;
                }
                // Relative movement (m or l) having a distance of 0
                if (lowerMovementCommands.includes(command) && x1Coord === 0 && y1Coord === 0) {
                  return true;
                }
                if (lowerCurveCommands.includes(command) && x1Coord === 0 && y1Coord === 0) {
                  const [x2Coord, y2Coord] = rest;
                  if (
                    // Relative shorthand curve (s) having a control point of 0
                    command === lowerShorthandCurveCommand ||
                    // Relative bézier curve (c) having control points of 0
                    (command === lowerCurveCommand && x2Coord === 0 && y2Coord === 0)
                  ) {
                    return true;
                  }
                }
                if (index > 0) {
                  let [yPrevCoord, xPrevCoord, ...prevRest] = [...absSegments[index - 1]].reverse();
                  // If the previous command was a direction one, we need to iterate back until we find the missing coordinates
                  if (upperDirectionCommands.includes(xPrevCoord)) {
                    xPrevCoord = undefined;
                    yPrevCoord = undefined;
                    let idx = index;
                    while (--idx > 0 && (xPrevCoord === undefined || yPrevCoord === undefined)) {
                      let [yPrevCoordDeep, xPrevCoordDeep, ...rest] = [...absSegments[idx]].reverse();
                      // If the previous command was a horizontal movement, we need to consider the single coordinate as x
                      if (upperHorDirectionCommand === xPrevCoordDeep) {
                        xPrevCoordDeep = yPrevCoordDeep;
                        yPrevCoordDeep = undefined;
                      }
                      // If the previous command was a vertical movement, we need to consider the single coordinate as y
                      if (upperVerDirectionCommand === xPrevCoordDeep) {
                        xPrevCoordDeep = undefined;
                      }
                      if (xPrevCoord === undefined && xPrevCoordDeep !== undefined) {
                        xPrevCoord = xPrevCoordDeep;
                      }
                      if (yPrevCoord === undefined && yPrevCoordDeep !== undefined) {
                        yPrevCoord = yPrevCoordDeep;
                      }
                    }
                  }

                  if (upperCurveCommands.includes(command)) {
                    const [x2Coord, y2Coord, xCoord, yCoord] = rest;
                    // Absolute shorthand curve (S) having the same coordinate as the previous segment and a control point equal to the ending point
                    if (upperShorthandCurveCommand === command && x1Coord === xPrevCoord && y1Coord === yPrevCoord && x1Coord === x2Coord && y1Coord === y2Coord) {
                      return true;
                    }
                    // Absolute bézier curve (C) having the same coordinate as the previous segment and last control point equal to the ending point
                    if (upperCurveCommand === command && x1Coord === xPrevCoord && y1Coord === yPrevCoord && x2Coord === xCoord && y2Coord === yCoord) {
                      return true;
                    }
                  }

                  return (
                    // Absolute horizontal direction (H) having the same x coordinate as the previous segment
                    (upperHorDirectionCommand === command && x1Coord === xPrevCoord) ||
                    // Absolute vertical direction (V) having the same y coordinate as the previous segment
                    (upperVerDirectionCommand === command && x1Coord === yPrevCoord) ||
                    // Absolute movement (M or L) having the same coordinate as the previous segment
                    (upperMovementCommands.includes(command) && x1Coord === xPrevCoord && y1Coord === yPrevCoord)
                  );
                }
              }
            };
            const invalidSegments = segments.filter(getInvalidSegments);

            if (invalidSegments.length) {
              invalidSegments.forEach(([command, x1Coord, y1Coord, ...rest]) => {
                let readableSegment = `${command}${x1Coord}`,
                    resolutionTip = 'should be removed';
                if (y1Coord !== undefined) {
                  readableSegment += ` ${y1Coord}`;
                }
                if (curveCommands.includes(command)) {
                  const [x2Coord, y2Coord, xCoord, yCoord] = rest;
                  readableSegment += `, ${x2Coord} ${y2Coord}`;
                  if (yCoord !== undefined) {
                    readableSegment += `, ${xCoord} ${yCoord}`;
                  }
                  if (command === lowerShorthandCurveCommand && (x2Coord !== 0 || y2Coord !== 0)) {
                    resolutionTip = `should be "l${removeLeadingZeros(x2Coord)} ${removeLeadingZeros(y2Coord)}" or removed`;
                  }
                  if (command === upperShorthandCurveCommand) {
                    resolutionTip = `should be "L${removeLeadingZeros(x2Coord)} ${removeLeadingZeros(y2Coord)}" or removed`;
                  }
                  if (command === lowerCurveCommand && (xCoord !== 0 || yCoord !== 0)) {
                    resolutionTip = `should be "l${removeLeadingZeros(xCoord)} ${removeLeadingZeros(yCoord)}" or removed`;
                  }
                  if (command === upperCurveCommand) {
                    resolutionTip = `should be "L${removeLeadingZeros(xCoord)} ${removeLeadingZeros(yCoord)}" or removed`;
                  }
                }
                reporter.error(`Ineffective segment "${readableSegment}" in path (${resolutionTip}).`);
              });
              if (updateIgnoreFile) {
                ignoreIcon(reporter.name, iconPath, $);
              }
            }
          },
          function(reporter, $, ast) {
            reporter.name = "collinear-segments";

            const iconPath = $.find("path").attr("d");
            if (!updateIgnoreFile && isIgnored(reporter.name, iconPath)) {
              return;
            }
            
            const getCollinearSegments = (path) => {
              const { segments } = svgPath(path).unarc().unshort();
              // Collinear coordinates
              const collinearSegments = [];
              // We are in a line?
              // What are the points of the current line?
              // What is the current absolute coordinate?
              let _inStraightLine = false,
                  _newInStraightLine = false,
                  _currentLine = [],
                  _currentAbsCoord = [undefined, undefined];

              for (let s = 0; s < segments.length; s++) {
                let seg = segments[s],
                    cmd = seg[0],
                    nextCmd = s + 1 < segments.length ? segments[s + 1][0] : null;
                
                    if ('LM'.includes(cmd)) {
                      _currentAbsCoord[0] = seg[1];
                      _currentAbsCoord[1] = seg[2];
                    } else if ('lm'.includes(cmd)) {
                      _currentAbsCoord[0] = (!_currentAbsCoord[0] ? 0 : _currentAbsCoord[0]) + seg[1];
                      _currentAbsCoord[1] = (!_currentAbsCoord[1] ? 0 : _currentAbsCoord[1]) + seg[2];
                    } else if (cmd === 'H') {
                      _currentAbsCoord[0] = seg[1];
                    } else if (cmd === 'h') {
                      _currentAbsCoord[0] = (!_currentAbsCoord[0] ? 0 : _currentAbsCoord[0]) + seg[1];
                    } else if (cmd === 'V') {
                      _currentAbsCoord[1] = seg[1];
                    } else if (cmd === 'v') {
                      _currentAbsCoord[1] = (!_currentAbsCoord[1] ? 0 : _currentAbsCoord[1]) + seg[1];
                    } else if (cmd === 'C') {
                      _currentAbsCoord[0] = seg[5];
                      _currentAbsCoord[1] = seg[6];
                    } else if (cmd === 'c') {
                      _currentAbsCoord[0] = (!_currentAbsCoord[0] ? 0 : _currentAbsCoord[0]) + seg[5];
                      _currentAbsCoord[1] = (!_currentAbsCoord[1] ? 0 : _currentAbsCoord[1]) + seg[6];
                    } else if (cmd === 'Q') {
                      _currentAbsCoord[0] = seg[3];
                      _currentAbsCoord[1] = seg[4];
                    } else if (cmd === 'q') {
                      _currentAbsCoord[0] = (!_currentAbsCoord[0] ? 0 : _currentAbsCoord[0]) + seg[3];
                      _currentAbsCoord[1] = (!_currentAbsCoord[1] ? 0 : _currentAbsCoord[1]) + seg[4];
                    } else if (!'zZ'.includes(cmd)) {
                      throw new Error(`"${cmd}" command not handled`)
                    }
                
                _newInStraightLine = ['H', 'h', 'V', 'v', 'L', 'l', 'M', 'm'].includes(nextCmd);
                let _exitingStraightLine = (_inStraightLine && !_newInStraightLine);
                _inStraightLine = ['H', 'h', 'V', 'v', 'L', 'l', 'M', 'm'].includes(cmd);

                if (_inStraightLine) {
                  _currentLine.push([_currentAbsCoord[0], _currentAbsCoord[1]]);
                } else {
                  if (_exitingStraightLine) {
                    if (!'zZ'.includes(cmd)) {
                      _currentLine.push([_currentAbsCoord[0], _currentAbsCoord[1]]);
                    }
                    // Get collinear coordinates
                    for (let p = 0; p < _currentLine.length; p++) {
                      if (p === 0 || p === _currentLine.length - 1) {
                        continue;
                      }
                      let _collinearCoord = collinear(_currentLine[p - 1][0],
                                                      _currentLine[p - 1][1],
                                                      _currentLine[p][0],
                                                      _currentLine[p][1],
                                                      _currentLine[p + 1][0],
                                                      _currentLine[p + 1][1])
                      if (_collinearCoord) {
                        collinearSegments.push(segments[s - _currentLine.length + p + 1]);
                      }
                    }
                  }
                  _currentLine = [];
                }
              }
              
              return collinearSegments;
            }
            
            const collinearSegments = getCollinearSegments(iconPath);
            collinearSegments.forEach((segment) => {
              let segmentString = `${segment[0]}${segment[1]}`;
              if ('LlMm'.includes(segment[0])) {
                segmentString += ` ${segment[2]}`
              }
              reporter.error(`Collinear segment "${segmentString}" in path (should be removed)`);
            });
          },
          function(reporter, $, ast) {
            reporter.name = "extraneous";

            const rawSVG = $.html();
            if (!svgRegexp.test(rawSVG)) {
              reporter.error("Unexpected character(s), most likely extraneous whitespace, detected in SVG markup");
            }
          },
          function(reporter, $, ast) {
            reporter.name = "negative-zeros";

            const iconPath = $.find("path").attr("d");
            if (!updateIgnoreFile && isIgnored(reporter.name, iconPath)) {
              return;
            }

            // Find negative zeros inside path
            const negativeZeroMatches = Array.from(iconPath.matchAll(negativeZerosRegexp));
            if (negativeZeroMatches.length) {
              // Calculate the index for each match in the file
              const pathDStart = '<path d="';
              const svgFileHtml = $.html();
              const pathDIndex = svgFileHtml.indexOf(pathDStart) + pathDStart.length;

              negativeZeroMatches.forEach((match) => {
                const negativeZeroFileIndex = match.index + pathDIndex;
                const previousChar = svgFileHtml[negativeZeroFileIndex - 1];
                const replacement = "0123456789".includes(previousChar) ? " 0" : "0";
                reporter.error(`Found "-0" at index ${negativeZeroFileIndex} (should be "${replacement}")`);
              })
            }
          },
          function(reporter, $, ast) {
            reporter.name = "icon-centered";

            const iconPath = $.find("path").attr("d");
            if (!updateIgnoreFile && isIgnored(reporter.name, iconPath)) {
              return;
            }

            const [minX, minY, maxX, maxY] = svgPathBbox(iconPath);
            const targetCenter = iconSize / 2;
            const centerX = +((minX + maxX) / 2).toFixed(iconFloatPrecision);
            const devianceX = centerX - targetCenter;
            const centerY = +((minY + maxY) / 2).toFixed(iconFloatPrecision);
            const devianceY = centerY - targetCenter;

            if (
              Math.abs(devianceX) > iconTolerance ||
              Math.abs(devianceY) > iconTolerance
            ) {
              reporter.error(`<path> must be centered at (${targetCenter}, ${targetCenter}); the center is currently (${centerX}, ${centerY})`);
              if (updateIgnoreFile) {
                ignoreIcon(reporter.name, iconPath, $);
              }
            }
          }
        ]
    }
};
