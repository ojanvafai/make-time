// Rolling hash taken from https://gist.github.com/i-e-b/b892d95ac7c0cf4b70e4.
'use strict';

// TODO: Use ES Modules!
(function() {

function cc(chr) {return chr.charCodeAt(0) * 21474836;}

// add a char without removing
function fill(hsh, chr) {
  hsh.patch.push(chr);
  hsh.value = fls1(hsh);
  hsh.value ^= cc(chr);
  return hsh;
}

// add head char, moving window forward
function update(hsh, head) {
  let tail = hsh.patch.shift();
  hsh.patch.push(head);
  let z = flsn(cc(tail), hsh.windowSize);
  hsh.value = fls1(hsh) ^ z ^ (cc(head));
  return hsh;
}

//fast left shift 1
function fls1(hsh) {
  return (hsh.value << 1) | (hsh.value >>> 31);
}

//fash left shift window
function flsn(x, w) {
  return (x << w) | (x >>> (32 - w));
}

// fill or update as required
function nextChr(hsh, chr) {
  if (hsh.patch.length == hsh.windowSize)
    return update(hsh,chr);
  return fill(hsh,chr);
}

class Differ {
  constructor(beforeDelimiter, afterDelimeter, windowSize, minimumLength) {
    this.beforeDelimiter = beforeDelimiter;
    this.afterDelimeter = afterDelimeter;
    // TODO: Have windows of number of words instead of characters.
    // That will both be more efficient and lead to better matching.
    // Don't actually want to elide in the middle of a word!
    this.windowSize = windowSize;
    this.minimumLength = minimumLength;
  }

  computeHashes(text) {
    this.patch = [];
    this.value = 0;
    let indexToChecksum = [];
    let checksumToIndex = {};

    let parts = text.split('');
    let inTag = false;
    let inScript = false;
    let windowStartIndex = 0;
    for (let i = 0; i < parts.length; i++) {
      var char = parts[i];
      // Don't compute hashes for markup as we don't want to break up
      // in the middle of a tag.
      if (char == '>') {
        inTag = false;
        continue;
      }
      if (char == '<') {
        if (inScript) {
          inScript = parts[i+1] != '/' ||
            parts[i+2] != 's' ||
            parts[i+3] != 'c' ||
            parts[i+4] != 'r' ||
            parts[i+5] != 'i' ||
            parts[i+6] != 'p' ||
            parts[i+7] != 't' ||
            (parts[i+8] != ' ' && parts[i+8] != '>');
        } else {
          inScript = parts[i+1] == 's' &&
            parts[i+2] == 'c' &&
            parts[i+3] == 'r' &&
            parts[i+4] == 'i' &&
            parts[i+5] == 'p' &&
            parts[i+6] == 't' &&
            (parts[i+7] == ' ' || parts[i+7] == '>');
        }
        inTag = true;
      }
      if (inTag || inScript)
        continue;
      nextChr(this, char);
      let checksum = this.value.toString(36);
      indexToChecksum[windowStartIndex] = checksum;
      let list = checksumToIndex[checksum];
      if (!list)
        list = checksumToIndex[checksum] = [];
      list.push(windowStartIndex);

      windowStartIndex = i;
    };

    return {
      indexToChecksum: indexToChecksum,
      checksumToIndex: checksumToIndex,
    }
  }

  diff(currentMessage, previousMessage) {
    let current = this.computeHashes(currentMessage);
    let previous = this.computeHashes(previousMessage);

    let matchingRuns = [];
    for (let i = 0; i < currentMessage.length; i++) {
      let checksum = current.indexToChecksum[i];
      if (!checksum)
        continue;

      let matches = previous.checksumToIndex[checksum];
      if (!matches)
        continue;

      let longestRun = { index: -1, length: 0 };
      for (let matchingIndex of matches) {
        let length = 0;
        let currentChecksum = current.indexToChecksum[i];
        let previousChecksum = previous.indexToChecksum[matchingIndex];
        while (currentChecksum && currentChecksum == previousChecksum) {
          length++;
          currentChecksum = current.indexToChecksum[i + length];
          previousChecksum = previous.indexToChecksum[matchingIndex + length];
        }

        // Walk backwards and forwards to catch any characters missed due to being
        // <windowSize away from the start/end of the message where the rolling
        // checksums definitionally won't match.
        let startAdjustment = 0;
        let markupOffset = 0;
        while (true) {
          startAdjustment++;
          let currentChar = currentMessage.charAt(i - startAdjustment);
          let previousChar = previousMessage.charAt(matchingIndex - startAdjustment);

          if (!currentChar || !previousChar || currentChar != previousChar) {
            startAdjustment--;
            if (markupOffset) {
              startAdjustment -= markupOffset;
            }
            break;
          }

          if (currentChar == '>') {
            markupOffset = 1;
          } else if (currentChar == '<') {
            markupOffset = 0;
          } else if (markupOffset) {
            markupOffset++;
          }
        }

        let endAdjustment = 0;
        markupOffset = 0;
        while (true) {
          let currentChar = currentMessage.charAt(i + length + endAdjustment);
          let previousChar = previousMessage.charAt(matchingIndex + length + endAdjustment);
          if (!currentChar || !previousChar || currentChar != previousChar) {
            endAdjustment -= markupOffset;
            break;
          }

          endAdjustment++;

          if (currentChar == '<') {
            markupOffset = 1;
          } else if (currentChar == '>') {
            markupOffset = 0;
          } else if (markupOffset) {
            markupOffset++;
          }
        }

        if (length > longestRun.length) {
          longestRun.index = i - startAdjustment;
          longestRun.length = length + startAdjustment + endAdjustment;
        }
      }

      if (longestRun.length < this.minimumLength)
        continue;

      i += longestRun.length;
      matchingRuns.push(longestRun);
    }

    let result = '';
    let currentIndex = 0;

    for (let run of matchingRuns) {
      let newIndex = run.index;
      let part = currentMessage.slice(currentIndex, newIndex);
      if (part)
        result += part;
      currentIndex = newIndex;

      newIndex = currentIndex + run.length;
      part = currentMessage.slice(currentIndex, newIndex);
      result += this.beforeDelimiter + part + this.afterDelimeter;
      currentIndex = newIndex;
    }
    let lastPart = currentMessage.slice(currentIndex, currentMessage.length);
    if (lastPart)
      result += lastPart;

    return result;
  }
}

window.Differ = Differ;
})();