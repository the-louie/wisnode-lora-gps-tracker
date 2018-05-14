const binPad = (bin, bits) => {
  if (bin.indexOf('-') > -1) {
    bin = bin.replace('-', '')
    return '1' + bin.padStart(bits - 1, 0)
  } else {
    return bin.padStart(bits, 0)
  }
}
const binToInt = (bin, signed) => {
  if (signed && bin.substr(0, 1) === '1') {
    // replace first 1 to 0 and make it negative
    return -1 * parseInt(bin.replace('1', '0'), 2)
  } else {
    return parseInt(bin, 2)
  }
}
const chk8 = (data) => {
  const binrev = (b) => {
    return parseInt((b.toString(2).padStart(8, '0').split('').reverse().join('')), 2)
  }
  const chk = data.reduce((acc, curr) => {
    return [binrev((acc[0] + curr) % 255), (acc[1] + ((acc[0] + curr) % 255)) % 255]
  }, [0, 0])

  return chk[1] ^ chk[0]
}

module.exports = {
  compress: (lat, lon, hdop, clat, clon) => {
    const dlat = Math.round((clat - lat) * 5000)
    const dlon = Math.round((clon - lon) * 5000)
    const adopc = Math.min(15, Math.floor(hdop / 2)) // hdop can be max 4 bits, create an approximate value

    // Out of bounds
    if (Math.abs(dlat) > 5000 || Math.abs(dlon) > 5000) {
      return undefined
    }

    const bdlat = binPad(dlat.toString(2), 14)
    const bdlon = binPad(dlon.toString(2), 14)
    const bhdop = binPad(adopc.toString(2), 4)

    const hash = chk8(new Buffer(parseInt(bdlat + bdlon + bhdop, 2).toString(16), 'hex'))
    const bhash = binPad(hash.toString(2), 8)

    // const result = binPad(bdlat + bdlon + bhdop + bhash, 40)
    const result = bdlat + bdlon + bhdop + bhash

    // const intResult = parseInt(result, 2)
    // console.log('result:', result, intResult)
    // console.log('', lat, '=>', dlat, '\t', `${bdlat} (${bdlat.length})`, dlat.toString(16))
    // console.log('', lon, '=>', dlon, '\t', `${bdlon} (${bdlon.length})`, dlon.toString(16))
    // console.log('encbin', result, parseInt(result, 2).toString(16))
    // console.log(`enc> bhash: ${bdlat}(${bdlat.length}) ${bdlon}(${bdlon.length}) ${bhdop}(${bhdop.length}) ${bhash}(${bhash.length}) (${bhash.length})`)
    // console.log('', hash)

    // console.log('ENC:', lat, lon, hdop, hash)

    return parseInt(result, 2).toString(16)
    // return intResult.toString(16) + '' + hash.toString(16)
    // console.log('', hdop, '=>', hdopc, '\t', `${bhdop} (${bhdop.length})`, hdop.toString(16))
    // console.log(' ====> ', result, result.length, parseInt(result, 2).toString(16))
    // return parseInt(result, 2).toString(16)
  },
  decompress: (hex, clat, clon) => {
    const bin = binPad(parseInt(hex, 16).toString(2), 40)
    // console.log('decbin', bin)
    const bdlat = bin.substr(0, 14)
    const bdlon = bin.substr(14, 14)
    const bhdop = bin.substr(28, 4)
    const bhash = bin.substr(32, 8)
    // console.log(`dec> bhash: ${bdlat}(${bdlat.length}) ${bdlon}(${bdlon.length}) ${bhdop}(${bhdop.length}) ${bhash}(${bhash.length}) (${bhash.length})`)

    const calchash = chk8(new Buffer(parseInt(bdlat + bdlon + bhdop, 2).toString(16), 'hex'))
    const dlat = binToInt(bdlat, true)
    const dlon = binToInt(bdlon, true)
    const hdop = binToInt(bhdop, false) * 2
    const inhash = binToInt(bhash, false)
    const lat = (((clat / 5000) - dlat) / 5000) + clat
    const lon = (((clon / 5000) - dlon) / 5000) + clon

    // console.log('dec', hex, '=>', `bdlat: ${bdlat} (${dlat}) bdlon: ${bdlon} (${dlon}) bhdop: ${bhdop} (${hdop}) bhash: ${bhash} (${inhash}) `, dlat, dlon, hdop)
    // console.log('DEC:', lat, lon, hdop, calchash, inhash)
    return {
      lat: lat,
      lon: lon,
      hdop: hdop,
      calchash: calchash,
      inhash: inhash
    }
  }
}

var clat = 57.7
var clon = 14.6
function Decoder (hex) {
  var bin = binPad(parseInt(hex, 16).toString(2), 40)
  // console.log('decbin', bin)
  var bdlat = bin.substr(0, 14)
  var bdlon = bin.substr(14, 14)
  var bhdop = bin.substr(28, 4)
  var bhash = bin.substr(32, 8)
  // console.log(`dec> bhash: ${bdlat}(${bdlat.length}) ${bdlon}(${bdlon.length}) ${bhdop}(${bhdop.length}) ${bhash}(${bhash.length}) (${bhash.length})`)

  var calchash = chk8(new Buffer(parseInt(bdlat + bdlon + bhdop, 2).toString(16), 'hex'))
  var dlat = binToInt(bdlat, true)
  var dlon = binToInt(bdlon, true)
  var hdop = binToInt(bhdop, false) * 2
  var inhash = binToInt(bhash, false)
  var lat = (((clat / 5000) - dlat) / 5000) + clat
  var lon = (((clon / 5000) - dlon) / 5000) + clon

  // console.log('dec', hex, '=>', `bdlat: ${bdlat} (${dlat}) bdlon: ${bdlon} (${dlon}) bhdop: ${bhdop} (${hdop}) bhash: ${bhash} (${inhash}) `, dlat, dlon, hdop)
  // console.log('DEC:', lat, lon, hdop, calchash, inhash)
  return {
    lat: lat,
    lon: lon,
    hdop: hdop,
    calchash: calchash,
    inhash: inhash
  }
}
