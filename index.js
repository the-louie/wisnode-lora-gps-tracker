const config = require('./config.json')
const SerialPort = require('serialport')
const port = new SerialPort(config.tty, { baudRate: config.baud })
const gpsd = require('node-gpsd');

var listener = new gpsd.Listener({
  port: 2947,
  hostname: 'localhost',
  logger: {
    info: function () {},
    warn: console.warn,
    error: console.error
  },
  parse: true
})


const fakeGPS = {
  class: 'TPV',
  time: '2010-04-30T11:48:20.10Z',
  ept: 0.005,
  lat: 57.7756288,
  lon: 14.153153,
  alt: 1327.689,
  epx: 15.319,
  epy: 17.054,
  epv: 124.484,
  track: 10.3797,
  speed: 0.091,
  climb: -0.085,
  eps: 34.11,
  mode: 3
}

let realGPS = { lat: 0, lon: 0 }

const initCommands = [
  // { send: 'at+reset', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+mode=0', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+get_config=dev_eui', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+set_config=app_eui:70B3D57ED000C56A&app_key:4FAF9456A3E3D9D500888D526E47A9F3', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+join=otaa', expect: 'at+recv=3,0,0', fail: 'at+recv=6,0,0', timeout: 60000 }
]
const initEnd = 'at+recv=3,0,0'

let initState = 0
let timeoutID = 0

function toHex (d) {
  return ('0' + (Number(d).toString(16))).slice(-4).toUpperCase()
}

function compressCoords (lon, lat) {
  lon = Math.round((lon - 14) * 10000)
  lat = Math.round((lat - 57) * 10000)

  return toHex(lon) + toHex(lat)
}

function getGPS () {
  return realGPS !== undefined ? compressCoords(realGPS.lon, realGPS.lat) : undefined
}

listener.on('TPV', function (tpv) {
  if (Math.floor(realGPS.lat * 10000) !== Math.floor(tpv.lat * 10000) && Math.floor(realGPS.lon * 10000) !== Math.floor(tpv.lon * 10000)) {
    realGPS = Object.assign({}, tpv)
    console.log('NEWPOS: ', realGPS.lat, realGPS.lon)
  }
})

listener.connect(function () {
  console.log('Connected')
  listener.watch()
})

port.on('open', () => {
  console.log('PORT OPEN')

  console.log(`SEND: ${initCommands[initState].send}`)
  port.write(`${initCommands[initState].send}\r\n`)

  port.on('readable', () => {
    const data = (port.read()).toString('utf8')
    console.log(`DATA: ${data}`)
    if (timeoutID !== undefined) {
      clearTimeout(timeoutID)
    }

    if (data.substr(0, initEnd.length) === initEnd) {
      console.log('INIT DONE, CONNECTED!')
      initState = undefined
      const latlon = getGPS()
      if (latlon !== undefined) {
        console.log(`SENDING: at+send=0,2,${latlon}`)
        port.write(`at+send=0,2,${latlon}\r\n`)
      }
      setInterval(() => {
        const latlon = getGPS()
        if (latlon !== undefined) {
          console.log(`SENDING: at+send=0,2,${latlon}`)
          port.write(`at+send=0,2,${latlon}\r\n`)
        }
      }, 60000)
    }

    if (initState !== undefined) {
      const expect = initCommands[initState].expect
      const timeout = initCommands[initState].timeout

      if (data.substr(0, expect.length) === expect) {

        initState = initState > initCommands.length ? undefined : initState + 1
        console.log(`SEND: ${initCommands[initState].send} (${timeout})`)
        port.write(`${initCommands[initState].send}\r\n`)
        timeoutID = setTimeout(() => {
          console.error('ERROR: TIMEOUT')
          port.close()
          process.exit(1)
        }, timeout)
      } else {
        console.log(`WARN, expected ${expect}`)
        // port.close()
        // process.exit(1)
      }
    }
  })
})
