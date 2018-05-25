const config = require('./config.json')
const fs = require('fs')
const SerialPort = require('serialport')
const wisnodeSerial = new SerialPort(config.tty, { baudRate: config.baud })
const gpsd = require('node-gpsd')

let inResetMode = false
const onoff = require('onoff')
const Gpio = onoff.Gpio
const resetPin = new Gpio(config.wisnodResetPin, 'high')

const coords = require('./coordsCompress')

var gpsdListener = new gpsd.Listener({
  port: 2947,
  hostname: 'localhost',
  logger: {
    info: function () {},
    warn: logger,
    error: logger
  },

  parse: true
})

let realGPS = { lat: 0, lon: 0 }
let gpsMode = 'NA'
let approxHDOP = 0
let wisnodeConnected = false
let debugMsgID
let loraMsgId
let lastMsgTimestamp = 0
let connectStartTime = 0

/* 868 MHz */
// const initCommands = [
//   { send: 'at+mode=0', expect: 'OK', timeout: 10000, fail: 'ERROR' },
//   { send: 'at+get_config=dev_eui', expect: 'OK', timeout: 10000, fail: 'ERROR' },
//   { send: 'at+rf_config=868300000,12,0,1,8,20', expect: 'OK', fail: 'ERROR', timeout: 10000 },
//   { send: 'at+set_config=app_eui:70B3D57ED000C56A&app_key:4FAF9456A3E3D9D500888D526E47A9F3', expect: 'OK', timeout: 10000, fail: 'ERROR' },
//   { send: 'at+join=otaa', expect: 'OK', fail: 'at+recv=6,0,0', timeout: 300000 }
// ]
/* 433 MHz */
const initCommands = [
  { send: 'at+mode=0', expect: 'OK', timeout: 10000 },
  { send: 'at+set_config=app_key:A6B08140DAE1D795EBFA5A6DEE1F4DBD', expect: 'OK', timeout: 10000 },
  { send: 'at+join=otaa', expect: 'OK', timeout: 300000 }
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
    return undefined
  }
  return coords.compress(realGPS.lat, realGPS.lon, approxHDOP, config.centerLat, config.centerLon, false)
}

function logger (str) {
  const logstr = `${new Date()}\t${str}`
  console.log(logstr)
  fs.appendFile('./tracker.log', logstr + '\n', (err) => {
    if (err) throw err
  })
}

function debugPrint (accPacket) {
  const dtime = ((new Date().getTime()) - lastMsgTimestamp)
  logger(`${config.accPackets ? (accPacket ? '!' : '*') : ''} LORA: ${wisnodeConnected ? 'UP' : 'DOWN'}|${lastMsgTimestamp === 0 ? '?' : dtime}ms|${config.accPackets ? lastMsgAcc + '|' : ''}${sentMsgCount}|${accMsgCount}\tGPS: ${gpsdListener.isConnected() ? 'UP' : 'DOWN'} ${gpsMode} ${realGPS.lon.toFixed(4)} ${realGPS.lat.toFixed(4)} ${approxHDOP}`)
}

function gpioWrite (pin, on) {
  if (config.verbose || (config.initVerbose && initState !== undefined)) {
    logger(`^^^ pin: ${pin} ==> ${(on ? 'ON' : 'OFF')}`)
  }
  resetPin.write(on ? 1 : 0, () => {})
}
function sendResetWisnode (resetTime) {
  gpioWrite(config.wisnodResetPin, true)
  gpioWrite(config.wisnodResetPin, false)
  setTimeout(() => { gpioWrite(config.wisnodResetPin, true) }, (config.wisnodeResetTime !== undefined ? resetTime : 450))
}

function resetWisnode () {
  inResetMode = true
  sendResetWisnode()
  setTimeout(sendResetWisnode, 1000)
  setTimeout(sendResetWisnode, 2000)
  setTimeout(sendResetWisnode, 3000)
  setTimeout(sendResetWisnode, 3500)
  setTimeout(() => { inResetMode = false }, 2100)
}

gpsdListener.on('TPV', function (tpv) {
  switch (tpv.mode) {
    case 0:
      gpsMode = 'N/A'
      break
    case 1:
      gpsMode = 'NOFIX'
      break
    case 2:
      gpsMode = '2D'
      break
    case 3:
      gpsMode = '3D'
      break

    default:
      break
  }
  if (!tpv.lat || !tpv.lon) {
    return
  }
  if (Math.floor(realGPS.lat * 10000) !== Math.floor(tpv.lat * 10000) && Math.floor(realGPS.lon * 10000) !== Math.floor(tpv.lon * 10000)) {
    realGPS = Object.assign({}, tpv)
  }
})

// Get the HDOP value, divide by 2 and cap to 15, we use this to create a
// 4 bit value to send later.
gpsdListener.on('SKY', (sky) => {
  approxHDOP = Math.min(31, Math.floor(sky.hdop / 2))
})

gpsdListener.connect(function () {
  gpsdListener.watch()
})

function safeExit (msg) {
  console.log(msg)
  wisnodeSerial.close(() => {
    console.log('\t* Wisnode Closed.')
    gpsdListener.disconnect(() => {
      console.log('\t* GPSD Closed.')
      console.log('---------------- E X I T -------------------')
      console.log('')
      process.exit(0)
    })
  })
}
process.on('SIGINT', () => {
  safeExit('Caught interrupt signal, closing down...')
})

function wisnodeWrite (obj) {
  const data = obj.send
  if (timeoutID !== undefined) { clearTimeout(timeoutID) }
  if (config.verbose || (config.initVerbose && initState !== undefined)) {
    logger(`--> '${data}' (${obj.timeout ? obj.timeout : 'None'})`)
  }

  wisnodeSerial.write(`${data}\r\n`)
  if (obj.timeout !== undefined) {
    timeoutID = setTimeout(() => { safeExit('TIMEOUT') }, obj.timeout)
  }
}

function loraSendPos () {
  const latlon = getGPS()
  if (latlon !== undefined) {
    loraChannel = randInt(1, 8)
    wisnodeWrite({send: `at+send=${config.accPackets ? '1' : '0'},${loraChannel},${latlon}`})
    sentMsgCount += 1
    lastMsgAcc = false
    lastMsgTimestamp = new Date().getTime()
  }
  if (debugMsgID !== undefined) { clearTimeout(debugMsgID) }
  if (loraMsgId !== undefined) { clearTimeout(loraMsgId) }
  debugMsgID = setTimeout(() => debugPrint(false), config.reportInterval)
  loraMsgId = setTimeout(loraSendPos, config.maxReportInterval)
}

function expectedData (expected, data) {
  if (expected === undefined) { return false }
  return (data.substr(0, expected.length) === expected)
}

wisnodeSerial.on('open', () => {
  // Reset Wisnode-LoRa board
  // wisnodeWrite(initStart)
  resetWisnode()

  wisnodeSerial.on('readable', () => {
    const data = (wisnodeSerial.read()).toString('utf8').replace(/(\n|\r)+$/, '')
    if (timeoutID !== undefined) { clearTimeout(timeoutID) }
    if (inResetMode) { return }

    if (config.verbose || (config.initVerbose && initState !== undefined) || (!expectedData('OK', data) && !expectedData('at+recv=1,0,0', data) && !expectedData('at+recv=2,0,0', data))) {
      logger(`<-- ${data} ${initState !== undefined ? `(@${initState})` : ''}`)
    }

    // Always reset state when wisnode board is reset
    if (expectedData(config.welcomeString, data)) {
      // winode is reset, start init sequence
      logger('Wisnode board reset. Start init-sequence')
      wisnodeConnected = false

      initState = 0
      wisnodeWrite(initCommands[initState])
    }

    // If we're not in initstate
    if (initState === undefined) {
      if (expectedData(initEnd, data)) {
        // Exit init sequence if we when we connect to gateway
        const connectTime = (new Date().getTime()) - connectStartTime
        logger(`INIT DONE, CONNECTED. Took ${connectTime} ms`)
        initState = undefined

        wisnodeConnected = true

        setTimeout(loraSendPos, config.minReportInterval)
      } else if (expectedData('at+recv=6,0,0', data)) {
        safeExit('CONNECTION FAILED')
      } else if (!lastMsgAcc && expectedData('at+recv=1,', data)) {
        // ACC receieved
        lastMsgAcc = true
        accMsgCount += 1

        if (debugMsgID !== undefined) { clearTimeout(debugMsgID) }
        debugPrint(true)

        if (loraMsgId !== undefined) { clearTimeout(loraMsgId) }
        loraMsgId = setTimeout(loraSendPos, config.minReportInterval <= 0 ? Math.max(((new Date().getTime()) - lastMsgTimestamp), config.minReportInterval) : config.minReportInterval)
      } else if (expectedData('ERROR-1', data)) {
        if (debugMsgID !== undefined) { clearTimeout(debugMsgID) }
        debugPrint(false)
        if (loraMsgId !== undefined) { clearTimeout(loraMsgId) }
        loraMsgId = setTimeout(loraSendPos, config.minReportInterval <= 0 ? Math.max(((new Date().getTime()) - lastMsgTimestamp), config.minReportInterval) : config.minReportInterval)
      }
      return
    }

    // if we get an expected result we should act on it
    if (expectedData(initCommands[initState].expect, data)) {
      initState = initState >= initCommands.length - 1 ? undefined : initState + 1
      if (initState === undefined) { return } // return if this was the last step in init sequence
      wisnodeWrite(initCommands[initState]) // send next message
      if (initState === initCommands.length - 1) { // If this was the last command start the timer
        connectStartTime = new Date().getTime()
      }
    // If we get an error we should exit
    } else if (expectedData(initCommands[initState].fail, data)) {
      safeExit(data)
    }
  })
})

console.log()
