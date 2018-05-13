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
  compress: (lat, lon, satc, clat, clon) => {
    const dlat = Math.round((clat - lat) * 5000)
    const dlon = Math.round((clon - lon) * 5000)
    const sats = satc < 15 ? satc : 15

    // Out of bounds
    if (Math.abs(dlat) > 5000 || Math.abs(dlon) > 5000) {
      return undefined
    }

    const bdlat = binPad(dlat.toString(2), 14)
    const bdlon = binPad(dlon.toString(2), 14)
    const bsats = binPad(sats.toString(2), 4)

    const result = bdlat + bdlon + bsats

    const data = parseInt(result, 2)
    const hash = chk8(new Buffer(data.toString(16), 'hex'))
    console.log('result:', result, data)
    console.log('', lat, '=>', dlat, '\t', `${bdlat} (${bdlat.length})`, dlat.toString(16))
    console.log('', lon, '=>', dlon, '\t', `${bdlon} (${bdlon.length})`, dlon.toString(16))
    console.log('', hash)

    return data.toString(16) + hash.toString(16)
    // console.log('', satc, '=>', sats, '\t', `${bsats} (${bsats.length})`, sats.toString(16))
    // console.log(' ====> ', result, result.length, parseInt(result, 2).toString(16))
    // return parseInt(result, 2).toString(16)
  },
  decompress: (hex, clat, clon) => {
    const bin = parseInt(hex, 16).toString(2)
    const bdlat = bin.substr(0, 14)
    const bdlon = bin.substr(14, 14)
    const bsats = bin.substr(28, 4)
    const bhash = bin.substr(32, 8)
    const dlat = binToInt(bdlat, true)
    const dlon = binToInt(bdlon, true)
    const sats = binToInt(bsats, false)
    const hash = binToInt(bhash, false)
    const lat = (((clat / 5000) - dlat) / 5000) + clat
    const lon = (((clon / 5000) - dlon) / 5000) + clon

    console.log(hex, '=>', `bdlat: ${bdlat} (${dlat}) bdlon: ${bdlon} (${dlon}) bsats: ${bsats} (${sats}) bhash: ${bhash} (${hash}) `, dlat, dlon, sats)
    console.log('===>', lat, lon, sats)
  }
}
