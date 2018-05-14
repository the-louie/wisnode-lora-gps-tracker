const c = require('../coordsCompress.js')
const clat = 57.7
const clon = 14.6

const maxlat = clat + 1
const minlat = clat - 1
const maxlon = clon + 1
const minlon = clon - 1

const tests = 100

let err = 0

for (let i = 0; i < tests; i += 1) {
  const randlat = (Math.random() * (maxlat - minlat) + minlat).toFixed(8)
  const randlon = (Math.random() * (maxlon - minlon) + minlon).toFixed(8)
  const randhdop = (Math.random() * (50 - 0)).toFixed(2)
  const compdata = c.compress(randlat, randlon, randhdop, clat, clon)
  const result = c.decompress(compdata, clat, clon)
  console.log('encoded: ', compdata)
  const errlat = Math.abs(result.lat - randlat)
  const errlon = Math.abs(result.lon - randlon)
  if (errlat > 0.01 || errlon > 0.01) {
    console.log('===', randlat, randlon, errlat, errlon)
    err += 1
  } else if (result.inhash !== result.calchash) {
    console.log('***', randlat, randlon, result.lat, result.lon, result.inhash, result.calchash, errlat, errlon)
    err += 1
  }
}
console.log('================================================')
console.log(`${err} / ${tests} failed.`)
