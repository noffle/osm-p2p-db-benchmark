var hyperlog = require('hyperlog')
var osmdb = require('osm-p2p-db')
var createPerfTimer = require('./lib/app_timer')
var path = require('path')
var nineSquare = require('./lib/9-square')
var meanNode = require('./lib/mean-node')
var tmpdir = require('os').tmpdir
var level = require('level')
var chunk = require('fd-chunk-store')
var mkdirp = require('mkdirp')

module.exports = {
  random: benchmarkRandom,
  db: benchmarkDb
}

function benchmarkDb (dbPath, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  var osm = osmdb({
    log: hyperlog(level(path.join(dbPath, 'log')), { valueEncoding: 'json' }),
    db: level(path.join(tmpdir(), 'index' + Math.random().toString())),
    store: chunk(4096, path.join(tmpdir(), 'kdb' + Math.random().toString()))
  })

  var timer = createPerfTimer(level, chunk)
  var res = []
  res.db = dbPath

  benchmark(osm, timer, res, opts, cb)
}

function benchmarkRandom (level, chunk, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }

  var timer = createPerfTimer(level, chunk)
  var res = []

  var osm = osmdb({
    log: hyperlog(level('log1'), { valueEncoding: 'json' }),
    db: level('index1'),
    store: chunk(4096, 'kdb1')
  })

  timer.start('insert')
  var batch = []
  var n = opts.n || 100
  var r = Math.min(1, n / 500000)
  res.numNodes = n
  process.stderr.write('Inserting', n, 'documents..')
  for (var i = 0; i < n; i++) {
    var node = {
      type: 'node',
      lat: Math.random() * 180 * r - 90 * r,
      lon: Math.random() * 360 * r - 180 * r
    }
    batch.push({ type: 'put', key: '' + i, value: node })
  }
  osm.batch(batch, function (err) {
    if (err) throw err
    console.error('..done')
    res.push(timer.end())

    benchmark(osm, timer, res, cb)
  })
}

function benchmark (osm, timer, res, cb) {
  process.stderr.write('Indexing..')
  timer.start('index')
  osm.ready(function () {
    console.error('..done')
    res.push(timer.end())

    process.stderr.write('Computing rough center of dataset..')
    meanNode(osm, function (err, lat, lon) {
      if (err) return cb(err)
      console.error('..done (' + lat + ', ' + lon + ')')

      process.stderr.write('Zoom-16 query..')
      timer.start('zoom-16-query')
      nineSquare(osm, lat, lon, 0.005, function (err, numResults) {
        if (err) return cb(err)
        console.error('..done (' + numResults + ')')
        res.push(timer.end())

        process.stderr.write('Zoom-13 query..')
        timer.start('zoom-13-query')
        nineSquare(osm, lat, lon, 0.044, function (err, numResults) {
          if (err) return cb(err)
          console.error('..done (' + numResults + ')')
          res.push(timer.end())

          process.stderr.write('Zoom-11 query..')
          timer.start('zoom-11-query')
          nineSquare(osm, lat, lon, 0.176, function (err, numResults) {
            if (err) return cb(err)
            console.error('..done (' + numResults + ')')
            res.push(timer.end())

            process.stderr.write('Full map query..')
            timer.start('full-map-query')
            fullMapQuery(osm, function (err) {
              if (err) return cb(err)
              console.error('..done')
              res.push(timer.end())

              process.stderr.write('Replicate to new DB..')
              timer.start('replication')
              replicateToTempDb(osm, function (err) {
                if (err) return cb(err)
                console.error('..done')
                res.push(timer.end())

                res.push(timer.total())
                cb(null, res)
              })
            })
          })
        })
      })
    })
  })
}

function replicate (a, b, cb) {
  var r1 = a.log.replicate()
  var r2 = b.log.replicate()

  r1.pipe(r2).pipe(r1)

  r1.on('end', done)
  r2.on('end', done)

  var pending = 2
  function done () {
    if (!--pending) cb()
  }
}

function fullMapQuery (osm, cb) {
  var bbox = [
    [-85, 85],
    [-180, 180]
  ]
  var qs = osm.queryStream(bbox)
  qs.on('data', function () {})
  qs.once('error', cb)
  qs.once('end', cb)
}

function replicateToTempDb (osm, cb) {
  var dir = path.join(tmpdir(), Math.random().toString(16).substring(2))
  mkdirp.sync(dir)
  var osm2 = osmdb({
    log: hyperlog(level(path.join(dir, 'log')), { valueEncoding: 'json' }),
    db: level(path.join(dir, 'index')),
    store: chunk(4096, path.join(dir, 'kdb'))
  })
  replicate(osm, osm2, cb)
}
