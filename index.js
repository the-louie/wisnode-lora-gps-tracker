const config = require('./config.json')
const SerialPort = require('serialport')
const wisnodeSerial = new SerialPort(config.tty, { baudRate: config.baud })
const gpsd = require('node-gpsd')
const coords = require('./coordsCompress')

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
let approxHDOP = 0
let wisnodeConnected = false
let gpsConnected = false
let debugMsgID
let lastMsgTimestamp = 0

const initStart = { send: 'at+reset=0', expect: 'OK', timeout: 4000, fail: 'ERROR' }

// at+rf_config=868300000,12,0,1,8,20
const initCommands = [
  // { send: 'at+reset=0', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+mode=0', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+get_config=dev_eui', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+rf_config=868300000,12,0,1,8,20', expect: 'OK', fail: 'ERROR', timeout: 10000 },
  { send: 'at+set_config=app_eui:70B3D57ED000C56A&app_key:4FAF9456A3E3D9D500888D526E47A9F3', expect: 'OK', timeout: 10000, fail: 'ERROR' },
  { send: 'at+join=otaa', expect: 'OK', fail: 'at+recv=6,0,0', timeout: 1200000 }
]
const initEnd = 'at+recv=3,0,0'

let initState
let timeoutID = 0

let loraChannel = 0
let sentMsgCount = 0
let accMsgCount = 0
let lastMsgAcc = false

function randInt (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Returns hex-string of compressed coords, or undefined on failure.
 */
function getGPS () {
  if (!realGPS || realGPS.lat < 57 || realGPS.lat > 58 || realGPS.lon < 14 || realGPS.lon > 15) {
    // console.log('no GPSTVP: realGPS: ', realGPS)
    if (realGPS !== undefined) {
      // console.log(`lon: ${realGPS.lon}, lat: ${realGPS.lat}`)
    }
    return undefined
  }
  return coords.compress(realGPS.lat, realGPS.lon, approxHDOP, config.centerLat, config.centerLon)
  // return compressCoords(realGPS.lon, realGPS.lat, satCount)
}

function debugPrint (accPacket) {
  const dtime = ((new Date().getTime()) - lastMsgTimestamp)
  console.log(`${accPacket ? '!' : '*'} LORA: ${wisnodeConnected ? 'UP' : 'DOWN'}|${dtime}ms|${lastMsgAcc}|${sentMsgCount}|${accMsgCount}\tGPS: ${gpsConnected ? 'UP' : 'DOWN'} ${realGPS.lon} ${realGPS.lat} ${approxHDOP}`)
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
{
    "class":"SKY",
    "device":"/dev/pts/1",
    "time":"2005-07-08T11:28:07.114Z",
    "xdop":1.55,
    "hdop":1.24,
    "pdop":1.99,
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

// Get the HDOP value, divide by 2 and cap to 15, we use this to create a
// 4 bit value to send later.
gpsdListener.on('SKY', (sky) => {
  approxHDOP = Math.min(31, Math.floor(sky.hdop / 2))
})

gpsdListener.connect(function () {
  gpsConnected = true
  gpsdListener.watch()
})

function wisnodeWrite (obj) {
  const data = obj.send
  if (config.verbose || (config.initVerbose && initState !== undefined)) {
    console.log(`--> '${data}' (${obj.timeout ? obj.timeout : 'None'})`)
  }
  wisnodeSerial.write(`${data}\r\n`)
  if (obj.timeout !== undefined) {
    timeoutID = setTimeout(() => { exitError('TIMEOUT') }, obj.timeout)
  }
}

function loraSendPos () {
  const latlon = getGPS()
  if (latlon !== undefined) {
    loraChannel = randInt(0, 8)
    wisnodeWrite({send: `at+send=${config.accPackets ? '1' : '0'},${loraChannel},${latlon}`})
    sentMsgCount += 1
    lastMsgAcc = false
    lastMsgTimestamp = new Date().getTime()
    debugMsgID = setTimeout(() => debugPrint(false), config.reportInterval - 10000)
  }
}

function exitError (msg) {
  console.error('ERROR:', msg)
  console.log('--- EXIT --------------------------------------------')
  wisnodeSerial.close()
  process.exit(1)
}

function expectedData (expected, data) {
  return (data.substr(0, expected.length) === expected)
}

wisnodeSerial.on('open', () => {
  // Reset Wisnode-LoRa board
  wisnodeWrite(initStart)

  wisnodeSerial.on('readable', () => {
    const data = (wisnodeSerial.read()).toString('utf8').replace(/(\n|\r)+$/, '')
    if (timeoutID !== undefined) { clearTimeout(timeoutID) }

    if (config.verbose || (config.initVerbose && initState !== undefined) || (!expectedData('OK', data) && !expectedData('at+recv=1,0,0', data) && !expectedData('at+recv=2,0,0', data))) {
      console.log(`<-- ${data} ${initState !== undefined ? `(@${initState})` : ''}`)
    }

    // Always reset state when wisnode board is reset
    if (expectedData('Welcome to RAK811', data)) {
      // winode is reset, start init sequence
      console.log('Wisnode board reset. Start init-sequence')
      initState = 0
      wisnodeWrite(initCommands[initState])
    }

    // If we're not in initstate
    if (initState === undefined) {
      if (expectedData(initEnd, data)) {
        // Exit init sequence if we when we connect to gateway

        console.log('INIT DONE, CONNECTED!')
        initState = undefined
        wisnodeConnected = true

        setInterval(loraSendPos, config.reportInterval)
      } else if (expectedData('at+recv=6,0,0', data)) {
        exitError('CONNECTION FAILED')
      } else if (!lastMsgAcc && expectedData('at+recv=1,', data)) {
        if (debugMsgID !== undefined) { clearTimeout(debugMsgID) }
        lastMsgAcc = true
        accMsgCount += 1
        debugPrint(true)
      }
      return
    }

    // if we get an expected result we should act on it
    if (expectedData(initCommands[initState].expect, data)) {
      initState = initState >= initCommands.length - 1 ? undefined : initState + 1
      if (initState === undefined) { return } // return if this was the last step in init sequence
      wisnodeWrite(initCommands[initState]) // send next message
    // If we get an error we should exit
    } else if (expectedData(initCommands[initState].fail, data)) {
      exitError(data)
    }
  })
})
