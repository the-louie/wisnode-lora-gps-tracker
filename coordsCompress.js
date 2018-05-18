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
  compress: (lat, lon, hdop, clat, clon, sendHash) => {
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

    const bhash = sendHash ? binPad(chk8((parseInt(bdlat + bdlon + bhdop, 2).toString(16), 'hex').split('')).toString(2), 8) : undefined

    const result = bdlat + bdlon + bhdop + (bhash !== undefined ? bhash : '')

    return parseInt(result, 2).toString(16)
  },
  decompress: (hex, clat, clon) => {
    const bin = binPad(parseInt(hex, 16).toString(2), 40)
    // console.log('decbin', bin)
    const bdlat = bin.substr(0, 14)
    const bdlon = bin.substr(14, 14)
    const bhdop = bin.substr(28, 4)
    const bhash = bin.length > 32 ? bin.substr(32, 8) : undefined
    // console.log(`dec> bhash: ${bdlat}(${bdlat.length}) ${bdlon}(${bdlon.length}) ${bhdop}(${bhdop.length}) ${bhash}(${bhash.length}) (${bhash.length})`)

    const calchash = chk8((parseInt(bdlat + bdlon + bhdop, 2).toString(16), 'hex').split(''))
    const dlat = binToInt(bdlat, true)
    const dlon = binToInt(bdlon, true)
    const hdop = binToInt(bhdop, false) * 2
    const inhash = bhash !== undefined ? binToInt(bhash, false) : 'N/A'
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
