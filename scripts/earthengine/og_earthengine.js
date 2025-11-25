// ---- 0. REGION & DATES ----
var region = ee.Geometry.Rectangle([139.3, 35.4, 140.2, 36.2]);  // Tokyo
var lstStart = '2010-01-01';
var lstEnd   = '2025-08-31';

var lcYear = '2020-01-01';   // MCD12Q1 is yearly

// ---- 1. MODIS LST  (MOD11A2) ----
var lstCol = ee.ImageCollection('MODIS/061/MOD11A2')
  .filterDate(lstStart, lstEnd)
  .select(['LST_Day_1km', 'LST_Night_1km', 'QC_Day', 'QC_Night']);

var lstMean = lstCol.mean()
  .clip(region)

// real LST[K] = value * 0.02


// ---- 2. MODIS NDVI  (MOD13A1) ----
var ndviCol = ee.ImageCollection('MODIS/061/MOD13A1')
  .filterDate(lstStart, lstEnd)
  .select(['NDVI', 'DetailedQA']);

var ndviMean = ndviCol.mean()
  .clip(region);

// real NDVI = value * 0.0001.


// ---- 3. MODIS Land Cover  (MCD12Q1) ----
var lcCol = ee.ImageCollection('MODIS/061/MCD12Q1')
  .filterDate(lcYear, ee.Date(lcYear).advance(1, 'year'))
  .select('LC_Type1');

var landcover = lcCol.first()
  .clip(region);


// ---- 4. VISUAL CHECK ----
Map.centerObject(region, 9);

var lstVis = {min: 14000, max: 16000, palette: ['040274','0602ff','30c8e2','3be285','fff705','ff0000']};
Map.addLayer(lstMean.select('LST_Day_1km'), lstVis, 'LST Day (raw)');
Map.addLayer(lstMean.select('LST_Night_1km'), lstVis, 'LST Night (raw)');

var ndviVis = {min: 0, max: 9000, palette: ['ffffff','fcd163','99b718','529400','004c00']};
Map.addLayer(ndviMean.select('NDVI'), ndviVis, 'NDVI (raw)');

var lcVis = {
  min: 1, max: 17,
  palette: [
    '05450a','086a10','54a708','78d203','009900',
    'c6b044','dcd159','dade48','fbff13','b6ff05',
    '27ff87','c24f44','a5a5a5','ff6d4c','69fff8',
    'f9ffa4','1c0dff'
  ]
};
Map.addLayer(landcover.select('LC_Type1'), lcVis, 'Land cover (IGBP)');


// Exports
// LST (day + night)
Export.image.toDrive({
  image: lstMean.select(['LST_Day_1km', 'LST_Night_1km']),
  description: 'tokyo_MOD11A2_LST_2020_summer',
  folder: 'earthengine', 
  fileNamePrefix: 'tokyo_LST_2020_summer',
  region: region,
  scale: 1000,   // 1 km resolution
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

// NDVI
Export.image.toDrive({
  image: ndviMean.select('NDVI'),
  description: 'tokyo_MOD13A1_NDVI_2020_summer',
  folder: 'earthengine',
  fileNamePrefix: 'tokyo_NDVI_2020_summer',
  region: region,
  scale: 1000,  
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

// Land cover
Export.image.toDrive({
  image: landcover.select('LC_Type1'),
  description: 'tokyo_MCD12Q1_LC_2020',
  folder: 'earthengine',
  fileNamePrefix: 'tokyo_LC_2020',
  region: region,
  scale: 1000,  
  crs: 'EPSG:4326',
  maxPixels: 1e13
});