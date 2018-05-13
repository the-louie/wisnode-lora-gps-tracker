const c = require('../coordsCompress.js')
const clat = 57.7
const clon = 14.6

let a

a = c.compress(57.7944017, 14.2540865, 12, clat, clon)
console.log('-')
c.decompress(a, clat, clon)
console.log('-\n\n')
a = c.compress(58.7, 15, 13, clat, clon)
console.log('-')
c.decompress(a, clat, clon)
console.log('-\n\n')
a = c.compress(56.7, 14, 29, clat, clon)
console.log('-')
c.decompress(a, clat, clon)
console.log('-\n\n')
a = c.compress(55.7, 12, 2, clat, clon)
console.log('-')
c.decompress(a, clat, clon)
console.log('-\n\n')
a = c.compress(59.7, 12, 12, clat, clon)
console.log('-')
c.decompress(a, clat, clon)
