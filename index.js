const config = require('./config.json')
const SerialPort = require('serialport')
const port = new SerialPort(config.tty, { baudRate: config.baud })
const gpsd = require('node-gpsd')

var gpsdListener = new gpsd.Listener({
  port: 2947,
  hostname: 'localhost',
  logger: {
    info: function () {},
    warn: console.warn,
    error: console.error
  },
  parse: true
})

// const fakeGPS = {
//   class: 'TPV',
//   time: '2010-04-30T11:48:20.10Z',
//   ept: 0.005,
//   lat: 57.7756288,
//   lon: 14.153153,
//   alt: 1327.689,
//   epx: 15.319,
//   epy: 17.054,
//   epv: 124.484,
//   track: 10.3797,
//   speed: 0.091,
//   climb: -0.085,
//   eps: 34.11,
//   mode: 3
// }

let realGPS = { lat: 0, lon: 0 }
let satCount = 0
let wisnodeConnected = false
let gpsConnected = false

const initStart = { send: 'at+reset=0', expect: 'OK', timeout: 2000, fail: 'ERROR' }
const initCommands = [
  // { send: 'at+reset=0', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+mode=0', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+get_config=dev_eui', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+set_config=app_eui:70B3D57ED000C56A&app_key:4FAF9456A3E3D9D500888D526E47A9F3', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+join=otaa', expect: 'OK', fail: 'at+recv=6,0,0', timeout: 1200000 }
]
const initEnd = 'at+recv=3,0,0'

let initState
let timeoutID = 0

let loraChannel = 0

function toHex (d, i) {
  return ('0' + (Number(d).toString(16))).slice(-(i * 2)).toUpperCase().substr(-i)
}

function randInt (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function compressCoords (lon, lat, sat) {
  lon = Math.round((lon - 14) * 10000)
  lat = Math.round((lat - 57) * 10000)

  return toHex(lon < 65535 ? lon : 65535, 4) + toHex(lat < 65535 ? lat : 65535, 4) + toHex(sat < 255 ? sat : 255, 2)
}

function getGPS () {
  if (!realGPS || realGPS.lat < 57 || realGPS.lat > 58 || realGPS.lon < 14 || realGPS.lon > 15) {
    // console.log('no GPSTVP: realGPS: ', realGPS)
    if (realGPS !== undefined) {
      // console.log(`lon: ${realGPS.lon}, lat: ${realGPS.lat}`)
    }
    return undefined
  }
  return compressCoords(realGPS.lon, realGPS.lat, satCount)
}

function debugPrint () {
  console.log(`LORA: ${wisnodeConnected ? 'CONNECTED' : 'WAITING'} GPS: ${gpsConnected ? 'CONNECTED' : 'WAITING'} ${realGPS.lon} ${realGPS.lat} ${satCount}`)
}

gpsdListener.on('TPV', function (tpv) {
  if (!tpv.lat || !tpv.lon) {
    return
  }
  if (Math.floor(realGPS.lat * 10000) !== Math.floor(tpv.lat * 10000) && Math.floor(realGPS.lon * 10000) !== Math.floor(tpv.lon * 10000)) {
    realGPS = Object.assign({}, tpv)
    // console.log('NEWPOS: ', realGPS.lat, realGPS.lon)
  }
})

/*
{"class":"SKY","device":"/dev/pts/1",
    "time":"2005-07-08T11:28:07.114Z",
    "xdop":1.55,"hdop":1.24,"pdop":1.99,
    "satellites":[
        {"PRN":23,"el":6,"az":84,"ss":0,"used":false},
        {"PRN":28,"el":7,"az":160,"ss":0,"used":false},
        {"PRN":8,"el":66,"az":189,"ss":44,"used":true},
        {"PRN":29,"el":13,"az":273,"ss":0,"used":false},
        {"PRN":10,"el":51,"az":304,"ss":29,"used":true},
        {"PRN":4,"el":15,"az":199,"ss":36,"used":true},
        {"PRN":2,"el":34,"az":241,"ss":43,"used":true},
        {"PRN":27,"el":71,"az":76,"ss":43,"used":true}]}
*/

/**
 * Collect the number of active satellites for reporting
 */
gpsdListener.on('SKY', function (sky) {
  const newSatCount = sky.satellites.reduce((acc, curr) => curr.used ? acc + 1 : acc, 0)
  if (newSatCount !== satCount) {
    satCount = newSatCount
    // console.log(`SATS: ${satCount}`)
  }
})

gpsdListener.connect(function () {
  // console.log('Connected')
  gpsConnected = true
  gpsdListener.watch()
})

function wisnodeWrite (data) {
  console.log(`WISNWRITE: ${data}`)
  port.write(`${data}\r\n`)
  loraChannel = loraChannel < 2 ? loraChannel + 1 : 0
}

function loraSendPos () {
  const latlon = getGPS()
  if (latlon !== undefined) {
    loraChannel = randInt(0, 8)
    wisnodeWrite(`at+send=0,${loraChannel},${latlon}`)
  }
}

function expectedData (expected, data) {
  return (data.substr(0, expected.length) === expected)
}

setInterval(debugPrint, config.debugInterval)

port.on('open', () => {
  // console.log('WISNODE PORT OPEN')

  // Reset Wisnode-LoRa board
  wisnodeWrite(initStart.send)
  timeoutID = setTimeout(() => {
    console.error('ERROR: TIMEOUT')
    port.close()
    process.exit(1)
  }, initStart.timeout)

  port.on('readable', () => {
    const data = (port.read()).toString('utf8').replace(/(\n|\r)+$/, '')
    console.log(`LORA RECV: ${data}`)
    if (timeoutID !== undefined) { clearTimeout(timeoutID) }

    if (data === 'Welcome to RAK811') {
      // winode is reset, start init sequence
      initState = 0
      wisnodeWrite(initCommands[initState].send)

    // If we're in the init sequence
    } else if (initState !== undefined) {
      if (expectedData(initCommands[initState].expect, data)) {
        initState = initState >= initCommands.length + 2 ? undefined : initState + 1
        if (initState !== undefined && initState < initCommands.length) {
          wisnodeWrite(initCommands[initState].send)
          timeoutID = setTimeout(() => {
            console.error('ERROR: TIMEOUT')
            port.close()
            process.exit(1)
          }, initCommands[initState].timeout)
        }
      } else if (expectedData(initCommands[initState].fail, data)) {
        console.log('FAIL: ', data)
        port.close()
        process.exit(1)

      // Exit init sequence if we when we connect to gateway
      } else if (expectedData(initEnd, data)) {
        // console.log('INIT DONE, CONNECTED!')
        initState = undefined
        wisnodeConnected = true
        setInterval(() => {
          loraSendPos()
        }, config.reportInterval)

      // Unknown message, display a warning
      } else {
        console.log(`WARN, expected ${initCommands[initState].expect}`)
      }
    }
  })
})
