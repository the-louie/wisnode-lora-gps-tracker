var clat = 57.7
var clon = 14.6

function padStart (sourceString, targetLength, padString) {
  targetLength = targetLength >> 0 // truncate if number or convert non-number to 0;
  padString = String((typeof padString !== 'undefined' ? padString : ' '))
  if (this.length > targetLength) {
    return String(this)
  } else {
    targetLength = targetLength - this.length
    if (targetLength > padString.length) {
      padString += padString.repeat(targetLength / padString.length) // append to original to ensure we are longer than needed
    }
    return padString.slice(0, targetLength) + sourceString
  }
}

function binPad (bin, bits) {
  if (bin.indexOf('-') > -1) {
    bin = bin.replace('-', '')
    return '1' + padStart(bin, bits - 1, 0)
  } else {
    return padStart(bin, bits, 0)
  }
}
function chk8 (data) {
  function binrev (b) {
    return parseInt((padStart(b.toString(2), 8, '0').split('').reverse().join('')), 2)
  }
  var chk = data.reduce(function (acc, curr) {
    return [binrev((acc[0] + curr) % 255), (acc[1] + ((acc[0] + curr) % 255)) % 255]
  }, [0, 0])

  return chk[1] ^ chk[0]
}
function binToInt (bin, signed) {
  if (signed && bin.substr(0, 1) === '1') {
    // replace first 1 to 0 and make it negative
    return -1 * parseInt(bin.replace('1', '0'), 2)
  } else {
    return parseInt(bin, 2)
  }
}

// Function for use at TTN website to decode coordinates for ttnmapper.com
// eslint-disable-next-line no-unused-vars
function Decode (fport, data) {
  var hex = (data.map(function (i) {
    return i.toString(16)
  })).join('')
  var bin = binPad(parseInt(hex, 16).toString(2), 40)
  var bdlat = bin.substr(0, 14)
  var bdlon = bin.substr(14, 14)
  var bhdop = bin.substr(28, 4)
  var bhash = bin.length > 32 ? bin.substr(32, 8) : undefined

  var calchash = chk8(parseInt(bdlat + bdlon + bhdop, 2).toString(16).split('', 'hex'))
  var dlat = binToInt(bdlat, true)
  var dlon = binToInt(bdlon, true)
  var hdop = binToInt(bhdop, false) * 2
  var inhash = bhash !== undefined ? binToInt(bhash, false) : 'N/A'
  var lat = (((clat / 5000) - dlat) / 5000) + clat
  var lon = (((clon / 5000) - dlon) / 5000) + clon

  return {
    lat: lat,
    lon: lon,
    hdop: hdop,
    calchash: calchash,
    inhash: inhash
  }
}
