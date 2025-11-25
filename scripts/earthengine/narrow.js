// -------------------------------------------------------------
// USER SETTINGS
// -------------------------------------------------------------
var tokyo = ee.Geometry.Rectangle([139.3, 35.4, 140.2, 36.2]);
var years = ee.List.sequence(2015, 2025);

// Window lengths (days): daily, 4-day, 8-day, 16-day, monthly-ish, whole summer
var windows = ee.List([1, 4, 8, 16, 30, 92]);

// MODIS LST collection (daytime + QC)
var col = ee.ImageCollection('MODIS/061/MOD11A2')
  .select(['LST_Day_1km', 'QC_Day']);

var scale = 1000;  // 1km

// Precompute total pixel count over Tokyo at this scale
var totalPix = ee.Number(
  ee.Image.constant(1)
    .clip(tokyo)
    .reduceRegion({
      reducer: ee.Reducer.count(),
      geometry: tokyo,
      scale: scale,
      maxPixels: 1e13
    })
    .get('constant')
);

// -------------------------------------------------------------
// Function to compute coverage for a given date window
// ALWAYS returns a dictionary: { start, end, days, coverage, image }
// For empty subsets, coverage = 0 and image = null.
// -------------------------------------------------------------
var computeCoverage = function(startDate, windowDays) {

  var start = ee.Date(startDate);
  var end   = start.advance(windowDays, 'day');

  var subset = col.filterDate(start, end);

  // If no images at all → return coverage 0, image null
  var result = ee.Algorithms.If(
    subset.size().eq(0),
    ee.Dictionary({
      'start': start,
      'end': end,
      'days': windowDays,
      'coverage': ee.Number(0),
      'image': null
    }),
    (function() {
      // Apply QC mask to each image BEFORE averaging
      var lstMaskedCol = subset.map(function(img) {
        img = ee.Image(img);

        // QC is integer; make sure it's int before bitwise
        var qc = img.select('QC_Day').toInt16();
        var valid = qc.bitwiseAnd(1).eq(0);  // bit 0 = good quality

        var lst = img.select('LST_Day_1km').updateMask(valid);
        return lst;
      });

      // Mean LST over the window (already masked by QC)
      var lstMean = lstMaskedCol.mean().clip(tokyo);

      // Count valid pixels (non-masked) in Tokyo
      var validPixRaw = lstMean.reduceRegion({
        reducer: ee.Reducer.count(),
        geometry: tokyo,
        scale: scale,
        maxPixels: 1e13
      }).get('LST_Day_1km');

      // validPixRaw can be null (no valid pixels in this window)
      var isNull = ee.Algorithms.IsEqual(validPixRaw, null);
      var validPix = ee.Number(
        ee.Algorithms.If(isNull, 0, validPixRaw)
      );

      var coverage = validPix.divide(totalPix);

      return ee.Dictionary({
        'start': start,
        'end': end,
        'days': windowDays,
        'coverage': coverage,
        'image': lstMean
      });
    })()
  );

  return result;
};

// -------------------------------------------------------------
// Build list of all windows: for each year, for each summer day, for each window size
// -------------------------------------------------------------
var results = years.map(function(y) {
  var yr = ee.Number(y);

  // Start at June 1 of that year, scan ~120 days (June–Sept)
  var dates = ee.List.sequence(0, 120).map(function(d) {
    return ee.Date.fromYMD(yr, 6, 1).advance(d, 'day');
  });

  var combos = dates.map(function(dt) {
    return windows.map(function(w) {
      return computeCoverage(dt, w);
    });
  });

  return ee.List(combos).flatten();
}).flatten();

// Make sure it's an ee.List of dictionaries
results = ee.List(results);

// -------------------------------------------------------------
// Convert to FeatureCollection and sort by coverage (descending)
// -------------------------------------------------------------
var fc = ee.FeatureCollection(
  results.map(function(d) {
    d = ee.Dictionary(d);
    return ee.Feature(null, d);
  })
);

// Sort by 'coverage' descending
var sortedFC = fc.sort('coverage', false);

// Inspect top 20
print('TOP 20 windows (best coverage first):', sortedFC.limit(20));

// Best 1-day window
var dailyFC = sortedFC.filter(ee.Filter.eq('days', 1));
var bestDaily = dailyFC.first();
print('Best DAILY window:', bestDaily);

var w8FC = sortedFC.filter(ee.Filter.eq('days', 8));
var best8 = w8FC.first();
print('Best 8-day window:', best8);

var w16FC = sortedFC.filter(ee.Filter.eq('days', 16));
var best16 = w16FC.first();
print('Best 16-day window:', best16);

// Best window as a Feature
var bestFeat = sortedFC.first();
print('Best window feature:', bestFeat);

// Extract properties
var bestImage = ee.Image(bestFeat.get('image'));
var bestStart = ee.Date(bestFeat.get('start'));
var bestEnd   = ee.Date(bestFeat.get('end'));
var bestDays  = bestFeat.get('days');
var bestCov   = ee.Number(bestFeat.get('coverage'));

print('Best window date range:', bestStart.format('YYYY-MM-dd'), '→', bestEnd.format('YYYY-MM-dd'));
print('Best window length (days):', bestDays);
print('Best window coverage (%):', bestCov.multiply(100));

// -------------------------------------------------------------
// Visualize best LST on map
// -------------------------------------------------------------
Map.centerObject(tokyo, 9);

var lstVis = {
  min: 14000,
  max: 16000,
  palette: ['040274','0602ff','30c8e2','3be285','fff705','ff0000']
};

Map.addLayer(bestImage, lstVis, 'Best LST window (daytime)');


lstBest = bestImage.set({
  'lst_window_start': bestStart.format('YYYY-MM-dd'),
  'lst_window_end': bestEnd.format('YYYY-MM-dd'),
  'lst_window_days': bestDays,
  'lst_window_coverage': bestCov
});
Export.image.toDrive({
  image: bestImage,
  description: 'tokyo_best_LST_window',
  folder: 'earthengine',
  fileNamePrefix: 'tokyo_best_LST',
  region: tokyo,
  scale: 1000,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

// Total pixels over Tokyo (same as before)
var scale = 1000;
var totalPix = ee.Number(
  ee.Image.constant(1).clip(tokyo).reduceRegion({
    reducer: ee.Reducer.count(),
    geometry: tokyo,
    scale: scale,
    maxPixels: 1e13
  }).get('constant')
);

// NDVI collection for that same window
var ndviCol = ee.ImageCollection('MODIS/061/MOD13A1')
  .select('NDVI')
  .filterDate(bestStart, bestEnd);

var ndviMean = ndviCol.mean();

// valid NDVI pixels
var ndviValidPix = ee.Number(
  ndviMean.mask().reduceRegion({
    reducer: ee.Reducer.count(),
    geometry: tokyo,
    scale: scale,
    maxPixels: 1e13
  }).get('NDVI')
);

var ndviCoverage = ndviValidPix.divide(totalPix);
print('NDVI coverage in best LST window:', ndviCoverage);

ndviMean = ndviMean.set({
  'ndvi_window_start': bestStart.format('YYYY-MM-dd'),
  'ndvi_window_end': bestEnd.format('YYYY-MM-dd'),
  'ndvi_window_days': bestDays,
  'ndvi_window_lst_coverage': bestCov,    // reuse LST coverage
  'ndvi_window_ndvi_coverage': ndviCoverage
});

Map.centerObject(tokyo, 9);

Map.addLayer(
  lstBest,
  {min: 14000, max: 16000, palette: ['blue','cyan','yellow','red']},
  'Best LST (Day)'
);

Map.addLayer(
  ndviMean,
  {min: 0, max: 9000, palette: ['ffffff','fcd163','99b718','529400','004c00']},
  'NDVI mean (same window)'
);

// Export NDVI in same window
Export.image.toDrive({
  image: ndviMean,
  description: 'tokyo_best_NDVI_window',
  folder: 'earthengine',
  fileNamePrefix: 'tokyo_best_NDVI',
  region: tokyo,
  scale: 1000,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});