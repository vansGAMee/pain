var PainPhonetics = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
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
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../../tmp/pain-double-metaphone/index.js
  var index_exports = {};
  __export(index_exports, {
    doubleMetaphone: () => doubleMetaphone
  });
  var vowels = /[AEIOUY]/;
  var slavoGermanic = /W|K|CZ|WITZ/;
  var germanic = /^(VAN |VON |SCH)/;
  var initialExceptions = /^(GN|KN|PN|WR|PS)/;
  var initialGreekCh = /^CH(IA|EM|OR([^E])|YM|ARAC|ARIS)/;
  var greekCh = /ORCHES|ARCHIT|ORCHID/;
  var chForKh = /[ BFHLMNRVW]/;
  var gForF = /[CGLRT]/;
  var initialGForKj = /Y[\s\S]|E[BILPRSY]|I[BELN]/;
  var initialAngerException = /^[DMR]ANGER/;
  var gForKj = /[EGIR]/;
  var jForJException = /[LTKSNMBZ]/;
  var alle = /AS|OS/;
  var hForS = /EIM|OEK|OLM|OLZ/;
  var dutchSch = /E[DMNR]|UY|OO/;
  function doubleMetaphone(value) {
    let primary = "";
    let secondary = "";
    let index = 0;
    const length = value.length;
    const last = length - 1;
    const normalized = String(value).toUpperCase() + "     ";
    const isSlavoGermanic = slavoGermanic.test(normalized);
    const isGermanic = germanic.test(normalized);
    const characters = normalized.split("");
    if (initialExceptions.test(normalized)) {
      index++;
    }
    if (characters[0] === "X") {
      primary += "S";
      secondary += "S";
      index++;
    }
    while (index < length) {
      const previous = characters[index - 1];
      const next = characters[index + 1];
      const nextnext = characters[index + 2];
      let subvalue;
      switch (characters[index]) {
        case "A":
        case "E":
        case "I":
        case "O":
        case "U":
        case "Y":
        case "\xC0":
        case "\xCA":
        case "\xC9":
          if (index === 0) {
            primary += "A";
            secondary += "A";
          }
          index++;
          break;
        case "B":
          primary += "P";
          secondary += "P";
          if (next === "B") {
            index++;
          }
          index++;
          break;
        case "\xC7":
          primary += "S";
          secondary += "S";
          index++;
          break;
        case "C":
          if (previous === "A" && next === "H" && nextnext !== "I" && !vowels.test(characters[index - 2]) && (nextnext !== "E" || (subvalue = normalized.slice(index - 2, index + 4)) && (subvalue === "BACHER" || subvalue === "MACHER"))) {
            primary += "K";
            secondary += "K";
            index += 2;
            break;
          }
          if (index === 0 && normalized.slice(index + 1, index + 6) === "AESAR") {
            primary += "S";
            secondary += "S";
            index += 2;
            break;
          }
          if (normalized.slice(index + 1, index + 4) === "HIA") {
            primary += "K";
            secondary += "K";
            index += 2;
            break;
          }
          if (next === "H") {
            if (index > 0 && nextnext === "A" && characters[index + 3] === "E") {
              primary += "K";
              secondary += "X";
              index += 2;
              break;
            }
            if (index === 0 && initialGreekCh.test(normalized)) {
              primary += "K";
              secondary += "K";
              index += 2;
              break;
            }
            if (isGermanic || // Such as 'architect' but not 'arch', orchestra', 'orchid'.
            greekCh.test(normalized.slice(index - 2, index + 4)) || nextnext === "T" || nextnext === "S" || (index === 0 || previous === "A" || previous === "E" || previous === "O" || previous === "U") && // Such as `wachtler`, `weschsler`, but not `tichner`.
            chForKh.test(nextnext)) {
              primary += "K";
              secondary += "K";
            } else if (index === 0) {
              primary += "X";
              secondary += "X";
            } else if (normalized.slice(0, 2) === "MC") {
              primary += "K";
              secondary += "K";
            } else {
              primary += "X";
              secondary += "K";
            }
            index += 2;
            break;
          }
          if (next === "Z" && normalized.slice(index - 2, index) !== "WI") {
            primary += "S";
            secondary += "X";
            index += 2;
            break;
          }
          if (normalized.slice(index + 1, index + 4) === "CIA") {
            primary += "X";
            secondary += "X";
            index += 3;
            break;
          }
          if (next === "C" && !(index === 1 && characters[0] === "M")) {
            if ((nextnext === "I" || nextnext === "E" || nextnext === "H") && normalized.slice(index + 2, index + 4) !== "HU") {
              subvalue = normalized.slice(index - 1, index + 4);
              if (index === 1 && previous === "A" || subvalue === "UCCEE" || subvalue === "UCCES") {
                primary += "KS";
                secondary += "KS";
              } else {
                primary += "X";
                secondary += "X";
              }
              index += 3;
              break;
            } else {
              primary += "K";
              secondary += "K";
              index += 2;
              break;
            }
          }
          if (next === "G" || next === "K" || next === "Q") {
            primary += "K";
            secondary += "K";
            index += 2;
            break;
          }
          if (next === "I" && // Bug: The original algorithm also calls for A (as in CIA), which is
          // already taken care of above.
          (nextnext === "E" || nextnext === "O")) {
            primary += "S";
            secondary += "X";
            index += 2;
            break;
          }
          if (next === "I" || next === "E" || next === "Y") {
            primary += "S";
            secondary += "S";
            index += 2;
            break;
          }
          primary += "K";
          secondary += "K";
          if (next === " " && (nextnext === "C" || nextnext === "G" || nextnext === "Q")) {
            index += 3;
            break;
          }
          index++;
          break;
        case "D":
          if (next === "G") {
            if (nextnext === "E" || nextnext === "I" || nextnext === "Y") {
              primary += "J";
              secondary += "J";
              index += 3;
            } else {
              primary += "TK";
              secondary += "TK";
              index += 2;
            }
            break;
          }
          if (next === "T" || next === "D") {
            primary += "T";
            secondary += "T";
            index += 2;
            break;
          }
          primary += "T";
          secondary += "T";
          index++;
          break;
        case "F":
          if (next === "F") {
            index++;
          }
          index++;
          primary += "F";
          secondary += "F";
          break;
        case "G":
          if (next === "H") {
            if (index > 0 && !vowels.test(previous)) {
              primary += "K";
              secondary += "K";
              index += 2;
              break;
            }
            if (index === 0) {
              if (nextnext === "I") {
                primary += "J";
                secondary += "J";
              } else {
                primary += "K";
                secondary += "K";
              }
              index += 2;
              break;
            }
            if (
              // Such as `Hugh`.  The comma is not a bug.
              (subvalue = characters[index - 2], subvalue === "B" || subvalue === "H" || subvalue === "D") || // Such as `bough`.  The comma is not a bug.
              (subvalue = characters[index - 3], subvalue === "B" || subvalue === "H" || subvalue === "D") || // Such as `Broughton`.  The comma is not a bug.
              (subvalue = characters[index - 4], subvalue === "B" || subvalue === "H")
            ) {
              index += 2;
              break;
            }
            if (index > 2 && previous === "U" && gForF.test(characters[index - 3])) {
              primary += "F";
              secondary += "F";
            } else if (index > 0 && previous !== "I") {
              primary += "K";
              secondary += "K";
            }
            index += 2;
            break;
          }
          if (next === "N") {
            if (index === 1 && vowels.test(characters[0]) && !isSlavoGermanic) {
              primary += "KN";
              secondary += "N";
            } else if (normalized.slice(index + 2, index + 4) !== "EY" && normalized.slice(index + 1) !== "Y" && !isSlavoGermanic) {
              primary += "N";
              secondary += "KN";
            } else {
              primary += "KN";
              secondary += "KN";
            }
            index += 2;
            break;
          }
          if (normalized.slice(index + 1, index + 3) === "LI" && !isSlavoGermanic) {
            primary += "KL";
            secondary += "L";
            index += 2;
            break;
          }
          if (index === 0 && initialGForKj.test(normalized.slice(1, 3))) {
            primary += "K";
            secondary += "J";
            index += 2;
            break;
          }
          if (normalized.slice(index + 1, index + 3) === "ER" && previous !== "I" && previous !== "E" && !initialAngerException.test(normalized.slice(0, 6)) || next === "Y" && !gForKj.test(previous)) {
            primary += "K";
            secondary += "J";
            index += 2;
            break;
          }
          if (next === "E" || next === "I" || next === "Y" || (previous === "A" || previous === "O") && next === "G" && nextnext === "I") {
            if (normalized.slice(index + 1, index + 3) === "ET" || isGermanic) {
              primary += "K";
              secondary += "K";
            } else {
              primary += "J";
              secondary += normalized.slice(index + 1, index + 5) === "IER " ? "J" : "K";
            }
            index += 2;
            break;
          }
          if (next === "G") {
            index++;
          }
          index++;
          primary += "K";
          secondary += "K";
          break;
        case "H":
          if (vowels.test(next) && (index === 0 || vowels.test(previous))) {
            primary += "H";
            secondary += "H";
            index++;
          }
          index++;
          break;
        case "J":
          if (normalized.slice(index, index + 4) === "JOSE" || normalized.slice(0, 4) === "SAN ") {
            if (normalized.slice(0, 4) === "SAN " || index === 0 && characters[index + 4] === " ") {
              primary += "H";
              secondary += "H";
            } else {
              primary += "J";
              secondary += "H";
            }
            index++;
            break;
          }
          if (index === 0) {
            primary += "J";
            secondary += "A";
          } else if (!isSlavoGermanic && (next === "A" || next === "O") && vowels.test(previous)) {
            primary += "J";
            secondary += "H";
          } else if (index === last) {
            primary += "J";
          } else if (previous !== "S" && previous !== "K" && previous !== "L" && !jForJException.test(next)) {
            primary += "J";
            secondary += "J";
          } else if (next === "J") {
            index++;
          }
          index++;
          break;
        case "K":
          if (next === "K") {
            index++;
          }
          primary += "K";
          secondary += "K";
          index++;
          break;
        case "L":
          if (next === "L") {
            if (index === length - 3 && (previous === "A" && nextnext === "E" || previous === "I" && (nextnext === "O" || nextnext === "A")) || previous === "A" && nextnext === "E" && (characters[last] === "A" || characters[last] === "O" || alle.test(normalized.slice(last - 1, length)))) {
              primary += "L";
              index += 2;
              break;
            }
            index++;
          }
          primary += "L";
          secondary += "L";
          index++;
          break;
        case "M":
          if (next === "M" || // Such as `dumb`, `thumb`.
          previous === "U" && next === "B" && (index + 1 === last || normalized.slice(index + 2, index + 4) === "ER")) {
            index++;
          }
          index++;
          primary += "M";
          secondary += "M";
          break;
        case "N":
          if (next === "N") {
            index++;
          }
          index++;
          primary += "N";
          secondary += "N";
          break;
        case "\xD1":
          index++;
          primary += "N";
          secondary += "N";
          break;
        case "P":
          if (next === "H") {
            primary += "F";
            secondary += "F";
            index += 2;
            break;
          }
          subvalue = next;
          if (subvalue === "P" || subvalue === "B") {
            index++;
          }
          index++;
          primary += "P";
          secondary += "P";
          break;
        case "Q":
          if (next === "Q") {
            index++;
          }
          index++;
          primary += "K";
          secondary += "K";
          break;
        case "R":
          if (index === last && !isSlavoGermanic && previous === "E" && characters[index - 2] === "I" && characters[index - 4] !== "M" && characters[index - 3] !== "E" && characters[index - 3] !== "A") {
            secondary += "R";
          } else {
            primary += "R";
            secondary += "R";
          }
          if (next === "R") {
            index++;
          }
          index++;
          break;
        case "S":
          if (next === "L" && (previous === "I" || previous === "Y")) {
            index++;
            break;
          }
          if (index === 0 && normalized.slice(1, 5) === "UGAR") {
            primary += "X";
            secondary += "S";
            index++;
            break;
          }
          if (next === "H") {
            if (hForS.test(normalized.slice(index + 1, index + 5))) {
              primary += "S";
              secondary += "S";
            } else {
              primary += "X";
              secondary += "X";
            }
            index += 2;
            break;
          }
          if (next === "I" && (nextnext === "O" || nextnext === "A")) {
            if (isSlavoGermanic) {
              primary += "S";
              secondary += "S";
            } else {
              primary += "S";
              secondary += "X";
            }
            index += 3;
            break;
          }
          if (next === "Z" || index === 0 && (next === "L" || next === "M" || next === "N" || next === "W")) {
            primary += "S";
            secondary += "X";
            if (next === "Z") {
              index++;
            }
            index++;
            break;
          }
          if (next === "C") {
            if (nextnext === "H") {
              subvalue = normalized.slice(index + 3, index + 5);
              if (dutchSch.test(subvalue)) {
                if (subvalue === "ER" || subvalue === "EN") {
                  primary += "X";
                  secondary += "SK";
                } else {
                  primary += "SK";
                  secondary += "SK";
                }
                index += 3;
                break;
              }
              if (index === 0 && !vowels.test(characters[3]) && characters[3] !== "W") {
                primary += "X";
                secondary += "S";
              } else {
                primary += "X";
                secondary += "X";
              }
              index += 3;
              break;
            }
            if (nextnext === "I" || nextnext === "E" || nextnext === "Y") {
              primary += "S";
              secondary += "S";
              index += 3;
              break;
            }
            primary += "SK";
            secondary += "SK";
            index += 3;
            break;
          }
          subvalue = normalized.slice(index - 2, index);
          if (index === last && (subvalue === "AI" || subvalue === "OI")) {
            secondary += "S";
          } else {
            primary += "S";
            secondary += "S";
          }
          if (next === "S") {
            index++;
          }
          index++;
          break;
        case "T":
          if (next === "I" && nextnext === "O" && characters[index + 3] === "N") {
            primary += "X";
            secondary += "X";
            index += 3;
            break;
          }
          subvalue = normalized.slice(index + 1, index + 3);
          if (next === "I" && nextnext === "A" || next === "C" && nextnext === "H") {
            primary += "X";
            secondary += "X";
            index += 3;
            break;
          }
          if (next === "H" || next === "T" && nextnext === "H") {
            if (isGermanic || (nextnext === "O" || nextnext === "A") && characters[index + 3] === "M") {
              primary += "T";
              secondary += "T";
            } else {
              primary += "0";
              secondary += "T";
            }
            index += 2;
            break;
          }
          if (next === "T" || next === "D") {
            index++;
          }
          index++;
          primary += "T";
          secondary += "T";
          break;
        case "V":
          if (next === "V") {
            index++;
          }
          primary += "F";
          secondary += "F";
          index++;
          break;
        case "W":
          if (next === "R") {
            primary += "R";
            secondary += "R";
            index += 2;
            break;
          }
          if (index === 0) {
            if (vowels.test(next)) {
              primary += "A";
              secondary += "F";
            } else if (next === "H") {
              primary += "A";
              secondary += "A";
            }
          }
          if ((previous === "E" || previous === "O") && next === "S" && nextnext === "K" && (characters[index + 3] === "I" || characters[index + 3] === "Y") || // Maybe a bug? Shouldn't this be general Germanic?
          normalized.slice(0, 3) === "SCH" || index === last && vowels.test(previous)) {
            secondary += "F";
            index++;
            break;
          }
          if (next === "I" && (nextnext === "C" || nextnext === "T") && characters[index + 3] === "Z") {
            primary += "TS";
            secondary += "FX";
            index += 4;
            break;
          }
          index++;
          break;
        case "X":
          if (!(index === last && // Bug: IAU and EAU also match by AU
          // (/IAU|EAU/.test(normalized.slice(index - 3, index))) ||
          previous === "U" && (characters[index - 2] === "A" || characters[index - 2] === "O"))) {
            primary += "KS";
            secondary += "KS";
          }
          if (next === "C" || next === "X") {
            index++;
          }
          index++;
          break;
        case "Z":
          if (next === "H") {
            primary += "J";
            secondary += "J";
            index += 2;
            break;
          } else if (next === "Z" && (nextnext === "A" || nextnext === "I" || nextnext === "O") || isSlavoGermanic && index > 0 && previous !== "T") {
            primary += "S";
            secondary += "TS";
          } else {
            primary += "S";
            secondary += "S";
          }
          if (next === "Z") {
            index++;
          }
          index++;
          break;
        default:
          index++;
      }
    }
    return [primary, secondary];
  }
  return __toCommonJS(index_exports);
})();
if(typeof module==='object'&&module.exports)module.exports=PainPhonetics;
