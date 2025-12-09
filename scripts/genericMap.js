const landCoverTypes = {
    0: 'No Data',
    1: 'Evergreen Needleleaf Forests',
    2: 'Evergreen Broadleaf Forests',
    3: 'Deciduous Needleleaf Forests', 
    4: 'Deciduous Broadleaf Forests',
    5: 'Mixed Forests',
    6: 'Closed Shrublands',
    7: 'Open Shrublands',
    8: 'Woody Savannas',
    9: 'Savannas',
    10: 'Grasslands',
    11: 'Permanent Wetlands',
    12: 'Croplands',
    13: 'Urban and Built-up Lands',
    14: 'Cropland/Natural Vegetation Mosaics',
    15: 'Permanent Snow and Ice',
    16: 'Water Bodies',
    17: 'Barren'
};

// Land cover groupings for legend with custom colors
const landCoverGroups = {
  'No Data': { values: [0], color: '#000000ff'},
  'Various Forests': { values: [1, 2, 3, 4, 5], color: '#1c861cff' },      
  'Grasslands': { values: [6, 7, 8, 9, 10], color: '#6ab51aff' },          
  'Wetlands': { values: [11], color: '#46987aff' },                       
  'Croplands': { values: [12, 14], color: '#FFD700' },                 
  'Urban': { values: [13], color: '#808080' },                          
  'Water/Snow/Ice': { values: [17], color: '#246bb2ff' },    // Barren and Water Bodies were swapped during preprocessing
  'Barren': { values: [15, 16], color: '#de8124ff' },           
};

// ------------------------------------------------------------------
// NDVI → LST response models for "what-if greenness" simulator
// ------------------------------------------------------------------

let ndviLstModels = null;  // loaded JSON from Python
const CORR_THRESHOLD = 0.4; // decide city-curve vs pooled
const ndviPaintSimStore = {};

const DEFAULT_PAINT_DELTA = 0.02;     // default NDVI increment per pass
const DEFAULT_BRUSH_RADIUS = 0;       // 0 = single pixel, 1 = ~3x3 neighborhood
const NDVI_MAX_CLAMP = 0.95;          // don’t let NDVI blow up

// From greenness_model_experiments.py output (pooled linear models)
const GLOBAL_LINEAR_MODEL = {
  day: {
    ndvi_slope: -5.606,   // °C per NDVI
    city_intercepts: {
      "tokyo":    26.23,
      "london":   19.33,
      "nyc":      21.26,
      "sandiego": 32.31
    },
    global_intercept: 0   // not actually used if we have city intercepts
  },
  night: {
    ndvi_slope: -3.322,
    city_intercepts: {
      "tokyo":    11.62,
      "london":   8.70,
      "nyc":      10.01,
      "sandiego": 14.12
    },
    global_intercept: 0
  }
};

function blendColors(color1Hex, color2Hex) {
  let ratio = 0.5;
  // Convert hex to RGB
  function hexToRgb(hex) {
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    return [r, g, b];
  }

  // Convert RGB to hex
  function rgbToHex(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  const rgb1 = hexToRgb(color1Hex);
  const rgb2 = hexToRgb(color2Hex);

  const blendedR = Math.round(rgb1[0] * (1 - ratio) + rgb2[0] * ratio);
  const blendedG = Math.round(rgb1[1] * (1 - ratio) + rgb2[1] * ratio);
  const blendedB = Math.round(rgb1[2] * (1 - ratio) + rgb2[2] * ratio);

  return rgbToHex(blendedR, blendedG, blendedB);
}

// Map various city names → model keys
function modelCityKeyFromName(name) {
  const s = (name || "").toLowerCase();
  if (s.includes("tokyo")) return "tokyo";
  if (s.includes("london")) return "london";
  if (s.includes("new york")) return "nyc";
  if (s.includes("san diego")) return "sandiego";
  return null;
}

function interp1D(xs, ys, x) {
  if (!xs || !ys || xs.length === 0) return null;

  const X = xs.map(Number);
  const Y = ys.map(Number);

  if (x <= X[0]) return Y[0];
  if (x >= X[X.length - 1]) return Y[Y.length - 1];

  let lo = 0;
  let hi = X.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x < X[mid]) hi = mid;
    else lo = mid;
  }
  const x0 = X[lo], x1 = X[hi];
  const y0 = Y[lo], y1 = Y[hi];
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

// Decide whether to trust the city-specific curve or fall back on pooled model
function shouldUseCityCurve(cityModel, target) {
  if (!cityModel) return false;
  const r = (target === "day")
    ? cityModel.ndvi_corr_day
    : cityModel.ndvi_corr_night;
  return r != null && Math.abs(r) >= CORR_THRESHOLD;
}

/**
 * Estimate LST (and Δ) for NDVI change at a given pixel.
 *
 * @param {Object} opts
 *   cityName: string (e.g. "Tokyo")
 *   baseNdvi: number
 *   newNdvi: number
 *   target: "day" | "night"
 *
 * @returns {Object|null}
 *   { basePred, newPred, delta, source: "city-curve" | "pooled-linear" }
 */
function estimateLstChangeFromNdvi(opts) {
  const { cityName, baseNdvi, newNdvi, target } = opts;

  // Basic sanity checks
  if (baseNdvi == null || !Number.isFinite(baseNdvi)) return null;
  if (newNdvi == null || !Number.isFinite(newNdvi)) return null;

  const cityKey = modelCityKeyFromName(cityName);
  if (!cityKey) return null;

  let cityModel = null;

  // Only try per-city curves if we actually have ndviLstModels loaded
  if (ndviLstModels && ndviLstModels.per_city_response_curves) {
    const models = ndviLstModels.per_city_response_curves;
    cityModel = models[cityKey];
  }

  // 1) Try city-specific response curve if correlation strong enough
  if (cityModel && shouldUseCityCurve(cityModel, target)) {
    const curve = (target === "day")
      ? cityModel.ndvi_to_lst.day
      : cityModel.ndvi_to_lst.night;

    if (curve && curve.ndvi && curve.lst && curve.ndvi.length) {
      const basePred = interp1D(curve.ndvi, curve.lst, baseNdvi);
      const newPred  = interp1D(curve.ndvi, curve.lst, newNdvi);
      if (basePred != null && newPred != null) {
        return {
          basePred,
          newPred,
          delta: newPred - basePred,
          source: "city-curve"
        };
      }
    }
    // fall through to pooled if curve missing / interpolation fails
  }

  // 2) Fallback: pooled linear model (works even if ndviLstModels is null)
  const pooled = GLOBAL_LINEAR_MODEL[target];
  if (!pooled) return null;

  const slope = pooled.ndvi_slope;
  const intercept = pooled.city_intercepts[cityKey] ?? pooled.global_intercept;

  const basePred = intercept + slope * baseNdvi;
  const newPred  = intercept + slope * newNdvi;

  return {
    basePred,
    newPred,
    delta: newPred - basePred,
    source: "pooled-linear"
  };
}

// Helper function to generate shades around a base color
function generateColorShades(baseColor, count) {
  // Parse the base color
  const color = d3.color(baseColor);
  const hsl = d3.hsl(color);
  
  if (count === 1) return [baseColor];
  
  // Generate shades by varying lightness
  const shades = [];
  const lightnessRange = 0.02; // Range to vary lightness (±15%)
  
  for (let i = 0; i < count; i++) {
    const offset = (i / (count - 1) - 0.5) * 2 * lightnessRange; // -0.15 to +0.15
    const newLightness = Math.max(0, Math.min(1, hsl.l + offset));
    const shade = d3.hsl(hsl.h, hsl.s, newLightness);
    shades.push(shade.formatHex());
  }
  
  return shades;
}

// Build discrete color map for all land cover values
function buildLandCoverColorMap() {
  const colorMap = {};
  for (const [groupLabel, groupData] of Object.entries(landCoverGroups)) {
    const values = groupData.values;
    const shades = generateColorShades(groupData.color, values.length);
    
    values.forEach((value, index) => {
      colorMap[value] = shades[index];
    });
  }
  return colorMap;
}

const landCoverColorMap = buildLandCoverColorMap();

// Generate land cover categories for legend (grouped)
function getLandCoverCategories(min, max, palette) {
  const categories = [];
  const presentValues = new Set();
  
  // Collect all present land cover values in the data
  for (let value = Math.ceil(min); value <= Math.floor(max); value++) {
    if (landCoverTypes[value] && value > 0) {
      presentValues.add(value);
    }
  }
  
  // Build grouped categories
  for (const [groupLabel, groupData] of Object.entries(landCoverGroups)) {
    // Check if any values from this group are present
    const groupValues = groupData.values.filter(v => presentValues.has(v));
    if (groupValues.length > 0) {
      categories.push({
        value: groupValues[0],
        label: groupLabel,
        color: groupData.color,
        groupValues: groupValues
      });
    }
  }
  
  return categories;
}

// Session-level variable to remember the last selected layer ID across city switches
let sessionActiveLayerId = null;

// Bivariate color scheme generator - DISCRETE 4x4 grid using variable palettes
function createBivariateColorScale(palette1, palette2) {
  return function(value1, value2, min1, max1, min2, max2) {
    // Normalize values to 0-1 range
    const norm1 = Math.max(0, Math.min(1, (value1 - min1) / (max1 - min1)));
    const norm2 = Math.max(0, Math.min(1, (value2 - min2) / (max2 - min2)));
    
    // Map to 4x4 discrete grid (0-3 for each dimension)
    const bin1 = Math.min(3, Math.floor(norm1 * 4));
    const bin2 = Math.min(3, Math.floor(norm2 * 4));
    
    // Get colors from center of each bin
    const binCenter1 = (bin1 + 0.5) / 4;
    const binCenter2 = (bin2 + 0.5) / 4;
    
    const color1 = palette1(binCenter1);
    const color2 = palette2(binCenter2);
    
    // Use LAB color space for perceptually uniform blending
    const lab1 = d3.lab(color1);
    const lab2 = d3.lab(color2);
    
    // Blend in LAB space for better color mixing
    const blendedL = (lab1.l + lab2.l) / 2;
    const blendedA = (lab1.a + lab2.a) / 2;
    const blendedB = (lab1.b + lab2.b) / 2;
    
    return d3.lab(blendedL, blendedA, blendedB).toString();
  };
}

// Custom high-contrast color palettes for bivariate visualization
function createBrightGreenPalette() {
  return function(t) {
    const colors = ['#c1ebc5', '#90c99a', '#60a870', '#2f8746'];
    const index = Math.min(3, Math.floor(t * 4));
    return colors[index];
  };
}

function createBrightOrangePalette() {
  return function(t) {
    const colors = ['#c1ebc5', '#dbe59f', '#f4df79', '#ffcc33'];
    const index = Math.min(3, Math.floor(t * 4));
    return colors[index];
  };
}

// Color palettes for day vs night temperature comparison
function createDayTempPalette() {
  return function(t) {
    // Orange/red gradient for daytime temperature
    const colors = ['#FCE4EC', '#F48FB1 ', '#EC407A', '#AD1457'];
    const index = Math.min(3, Math.floor(t * 4));
    return colors[index];
  };
}

function createNightTempPalette() {
  return function(t) {
    // Purple/blue gradient for nighttime temperature
    const colors = ['#E1F5FE', '#81D4FA', '#29B6F6', '#0277BD'];
    const index = Math.min(3, Math.floor(t * 4));
    return colors[index];
  };
}

async function createCityGridMap(config) {
  const {
    containerId,
    gridPath,
    wardStatsPath = null,
    cityName = "City",
    subunit,

    layers,                // array of layer defs 
    showLayerToggle = true,
    defaultActiveId = null,
    
    bivariate = false,     // enable bivariate mode
    bivariateVars = null,  // { var1: "ndvi", var2: "lst_day" }

    tooltipFormatter = null, // optional custom formatter
    onReady = null,          // optional callback after draw
    isInitialRender = false,  // flag for city switch transitions

    enableNdviPainting = false,
    enablelc = false
  } = config;

  let activeLayer = null;

  // Temperature unit for display only ("C" or "F")
  let tempUnit = "C";
  let lcUnit = enablelc;

  function toDisplayTemp(cVal) {
    if (cVal == null || !Number.isFinite(cVal)) return null;
    return tempUnit === "C" ? cVal : (cVal * 9 / 5 + 32);
  }

  function tempSuffix() {
    return tempUnit === "C" ? "°C" : "°F";
  }

  const container = d3.select(containerId);
  const node = container.node();
  const width = node.clientWidth;
  const height = node.clientHeight;

  container.selectAll("*").remove();

  // ---------- 1. Load grid + ward stats ----------
  const gridResp = await fetch(gridPath);
  const meta = await gridResp.json();

  let wardMeta = null;
  if (wardStatsPath) {
    const wardResp = await fetch(wardStatsPath);
    wardMeta = await wardResp.json();
  }

  const rasterWidth  = meta.width;
  const rasterHeight = meta.height;
  const bbox         = meta.bbox;
  const wardIds      = meta.ward_ids || [];
  const lcs          = meta.lc;

  if (!rasterWidth || !rasterHeight || !bbox) {
    console.error("Grid JSON missing width/height/bbox:", gridPath);
    return;
  }

  // --- NDVI painting / simulation state for this city (if enabled) ---
  const simCityKey = enableNdviPainting ? modelCityKeyFromName(cityName) : null;
  let simState = null;

  if (enableNdviPainting && simCityKey && meta.ndvi) {
    const nPixels = rasterWidth * rasterHeight;
    let store = ndviPaintSimStore[simCityKey];

    if (!store || store.width !== rasterWidth || store.height !== rasterHeight) {
      store = {
        width: rasterWidth,
        height: rasterHeight,

        baseNdvi: Float32Array.from(meta.ndvi),
        baseLstDay: meta.lst_day_C ? Float32Array.from(meta.lst_day_C) : null,
        baseLstNight: meta.lst_night_C ? Float32Array.from(meta.lst_night_C) : null,

        currNdvi: Float32Array.from(meta.ndvi),
        currLstDay: meta.lst_day_C ? Float32Array.from(meta.lst_day_C) : null,
        currLstNight: meta.lst_night_C ? Float32Array.from(meta.lst_night_C) : null,

        deltaDay: new Float32Array(nPixels),   // per-pixel Δ vs base
        deltaNight: new Float32Array(nPixels),
        touchedMask: new Uint8Array(nPixels),  // 0/1: has this pixel been painted?
        touchedCount: 0,
        totalDeltaDay: 0,
        totalDeltaNight: 0,
        wardsTouched: new Set(),

        // NEW: brush configuration (persists per city)
        brushRadius: DEFAULT_BRUSH_RADIUS,
        paintStep: DEFAULT_PAINT_DELTA
      };
      ndviPaintSimStore[simCityKey] = store;
    } else {
      // Make sure new fields exist on old store
      if (typeof store.brushRadius !== "number") {
        store.brushRadius = DEFAULT_BRUSH_RADIUS;
      }
      if (typeof store.paintStep !== "number") {
        store.paintStep = DEFAULT_PAINT_DELTA;
      }
    }

    simState = store;
  }

  // Ward info map (id -> ward object)
  const wardInfoMap = new Map();
  if (wardMeta && wardMeta.wards) {
    wardMeta.wards.forEach(w => {
      wardInfoMap.set(w.id, w);
    });
  }

  // ---------- 2. Materialize per-layer state ----------
  // layerDef shape:
  // {
  //   id: "ndvi",
  //   valueKey: "ndvi",
  //   minKey: "ndvi_min",
  //   maxKey: "ndvi_max",
  //   label: "Greenness (Vegetation)",
  //   unit: "",
  //   palette: d3.interpolateYlGn
  // }

  let layerStates = (layers || []).map(def => {
    const nCells = rasterWidth * rasterHeight;

    // 1) Try the configured key
    let vals = meta[def.valueKey];

    // 2) Fallbacks if that’s missing (handles small naming differences)
    if (!vals) {
      const candidates = [
        def.id,                     // e.g. "lst_day"
        `${def.id}_C`,              // e.g. "lst_day_C"
        `${def.id}_mean`,           // e.g. "lst_day_mean"
        `${def.id}_median`          // e.g. "lst_day_median"
      ];

      for (const key of candidates) {
        const arr = meta[key];
        if (Array.isArray(arr) && arr.length === nCells) {
          console.warn(
            `Layer "${def.id}" using fallback key "${key}" (valueKey="${def.valueKey}")`
          );
          vals = arr;
          break;
        }
      }
    }

    // 3) Swap to simulated arrays if greenness sim is enabled
    if (enableNdviPainting && simState) {
      if (def.id === "ndvi" && simState.currNdvi) {
        vals = simState.currNdvi;
      } else if (def.id === "lst_day" && simState.currLstDay) {
        vals = simState.currLstDay;
      } else if (def.id === "lst_night" && simState.currLstNight) {
        vals = simState.currLstNight;
      }
    }

    if (!vals || vals.length !== nCells) {
      console.warn(
        `Layer "${def.id}" missing or wrong length in`,
        gridPath,
        `(valueKey=${def.valueKey})`
      );
      return null;
    }

    let minVal, maxVal;
    if (def.domain && def.domain.length === 2) {
      [minVal, maxVal] = def.domain;
    } else {
      const explicitMin = def.minKey ? meta[def.minKey] : undefined;
      const explicitMax = def.maxKey ? meta[def.maxKey] : undefined;
      minVal = (typeof explicitMin === "number") ? explicitMin : d3.min(vals);
      maxVal = (typeof explicitMax === "number") ? explicitMax : d3.max(vals);
    }

    const layerState = {
      ...def,
      values: vals,
      min: minVal,
      max: maxVal
    };

    if (def.id === "lc" || def.label === "Land Cover Type") {
      layerState.categories = getLandCoverCategories(minVal, maxVal, def.palette);
    }

    return layerState;
  }).filter(Boolean);

  // 👀 Handy debug: see which layers actually made it through
  console.log("Grid layers for", cityName, layerStates.map(l => l.id));

  if (!layerStates.length) {
    console.error("No valid layers for grid map:", gridPath);
    return;
  }

  // ---- Correlation plot state ----
  // We only consider numeric / continuous layers (no land cover)
  const numericLayers = layerStates.filter(l => !l.categories && l.id !== "lc");

  let corrXId = null;
  let corrYId = null;
  let corrPanel = null;
  let corrSvg = null;
  let corrContent = null;
  let corrXSelect = null;
  let corrYSelect = null;

  // Deferred update (to avoid recomputing on every single pixel while dragging)
  let corrNeedsUpdate = false;
  let corrUpdateScheduled = false;

  function computeCorrelation(xs, ys) {
    const n = xs.length;
    if (n < 2) return null;

    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) {
      sumX += xs[i];
      sumY += ys[i];
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      num  += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const denom = Math.sqrt(denX * denY);
    if (!denom) return null;
    return num / denom;
  }

  function requestCorrelationUpdate() {
    if (!corrPanel || !numericLayers || numericLayers.length < 2) return;
    corrNeedsUpdate = true;
    if (corrUpdateScheduled) return;
    corrUpdateScheduled = true;
    setTimeout(() => {
      if (corrNeedsUpdate) {
        corrNeedsUpdate = false;
        updateCorrelationPlot();
      }
      corrUpdateScheduled = false;
    }, 120);
  }

  // Use session memory for layer selection if available, otherwise use config default
  let activeLayerId = defaultActiveId || layerStates[0].id;

  // ---------- 3. Build pixel objects ----------
  const pixels = new Array(rasterWidth * rasterHeight);
  const [minLon, minLat, maxLon, maxLat] = bbox;

  const rasterAspect = rasterWidth / rasterHeight;
  const containerAspect = width / height;

  let cellWidth, cellHeight, xOffset, yOffset;

  if (containerAspect > rasterAspect) {
    // container is relatively wider -> height is limiting dimension
    cellHeight = height / rasterHeight;
    cellWidth  = cellHeight;
    xOffset    = (width - rasterWidth * cellWidth) / 2;
    yOffset    = 0;
  } else {
    // container is relatively taller -> width is limiting dimension
    cellWidth  = width / rasterWidth;
    cellHeight = cellWidth;
    xOffset    = 0;
    yOffset    = (height - rasterHeight * cellHeight) / 2;
  }

  for (let idx = 0; idx < pixels.length; idx++) {
    const row = Math.floor(idx / rasterWidth);
    const col = idx % rasterWidth;

    const lon = minLon + (col + 0.5) * (maxLon - minLon) / rasterWidth;
    const lat = minLat + (row + 0.5) * (maxLat - minLat) / rasterHeight;

    const wardId = wardIds[idx] || 0;
    const lc = lcs[idx] || 0;

    pixels[idx] = { idx, row, col, lon, lat, wardId, lc };
  }

  // ---------- 4. City-specific processing configurations ----------
  // Define these early so they can be used in SVG setup
  const isTokyo = cityName.toLowerCase().includes('tokyo');
  
  // Cities that need full vertical flip for all pixels + background opacity control
  const citiesWithFullVerticalFlip = ['london', 'new york', 'san diego'];
  const needsFullVerticalFlip = citiesWithFullVerticalFlip.some(city => 
    cityName.toLowerCase().includes(city)
  );

  // Swap wardId assignments to flip which pixels are foreground
  if (needsFullVerticalFlip) {
    // Create a temporary copy of wardIds
    const tempWardIds = new Array(pixels.length);
    for (let idx = 0; idx < pixels.length; idx++) {
      const row = Math.floor(idx / rasterWidth);
      const col = idx % rasterWidth;
      
      // Calculate where this pixel's wardId should come from (vertically flipped)
      const flippedRow = rasterHeight - 1 - row;
      const sourceIdx = flippedRow * rasterWidth + col;
      
      tempWardIds[idx] = wardIds[sourceIdx] || 0;
    }
    // Apply the swapped wardIds to pixels
    for (let idx = 0; idx < pixels.length; idx++) {
      pixels[idx].wardId = tempWardIds[idx];
    }
  }

  // Swap wardId assignments for Tokyo (vertical flip only)
  if (isTokyo) {
    const tempWardIds = new Array(pixels.length);
    for (let idx = 0; idx < pixels.length; idx++) {
      const row = Math.floor(idx / rasterWidth);
      const col = idx % rasterWidth;
      
      // Calculate where this pixel's wardId should come from (vertical flip only)
      const flippedRow = rasterHeight - 1 - row;
      const sourceIdx = flippedRow * rasterWidth + col;
      
      tempWardIds[idx] = wardIds[sourceIdx] || 0;
    }
    // Apply the swapped wardIds to pixels
    for (let idx = 0; idx < pixels.length; idx++) {
      pixels[idx].wardId = tempWardIds[idx];
    }
  }

  // Throttled ward-mean recomputation
  let wardStatsNeedsUpdate = false;
  let wardStatsUpdateScheduled = false;

  function broadcastWardStats() {
    if (!pixels || !pixels.length || !wardInfoMap.size) return;

    const metricsByWardId = {};

    function getWardBucket(id) {
      if (!metricsByWardId[id]) {
        metricsByWardId[id] = {
          ndvi_sum: 0, ndvi_count: 0,
          lst_day_sum: 0, lst_day_count: 0,
          lst_night_sum: 0, lst_night_count: 0
        };
      }
      return metricsByWardId[id];
    }

    const n = pixels.length;
    for (let i = 0; i < n; i++) {
      const wardId = pixels[i].wardId;
      if (!wardId) continue;

      const bucket = getWardBucket(wardId);

      const ndvi = simState && simState.currNdvi
        ? simState.currNdvi[i]
        : meta.ndvi && meta.ndvi[i];

      const lstDay = simState && simState.currLstDay
        ? simState.currLstDay[i]
        : meta.lst_day_C && meta.lst_day_C[i];

      const lstNight = simState && simState.currLstNight
        ? simState.currLstNight[i]
        : meta.lst_night_C && meta.lst_night_C[i];

      if (Number.isFinite(ndvi)) {
        bucket.ndvi_sum += ndvi;
        bucket.ndvi_count += 1;
      }
      if (Number.isFinite(lstDay)) {
        bucket.lst_day_sum += lstDay;
        bucket.lst_day_count += 1;
      }
      if (Number.isFinite(lstNight)) {
        bucket.lst_night_sum += lstNight;
        bucket.lst_night_count += 1;
      }
    }

    // Convert to means
    Object.keys(metricsByWardId).forEach(id => {
      const b = metricsByWardId[id];
      b.ndvi_mean = b.ndvi_count ? b.ndvi_sum / b.ndvi_count : null;
      b.lst_day_mean = b.lst_day_count ? b.lst_day_sum / b.lst_day_count : null;
      b.lst_night_mean = b.lst_night_count ? b.lst_night_sum / b.lst_night_count : null;
    });

    document.dispatchEvent(new CustomEvent("wardStatsUpdated", {
      detail: {
        cityName,
        metricsByWardId
      }
    }));
  }

  function requestWardStatsUpdate() {
    wardStatsNeedsUpdate = true;
    if (wardStatsUpdateScheduled) return;
    wardStatsUpdateScheduled = true;
    setTimeout(() => {
      if (wardStatsNeedsUpdate) {
        wardStatsNeedsUpdate = false;
        broadcastWardStats();
      }
      wardStatsUpdateScheduled = false;
    }, 150);
  }

  // ---------- 5. SVG, zoom root, shadow filter ----------
  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("display", "block")
    .style("shape-rendering", "crispEdges");

  const rootG = svg.append("g").attr("class", "grid-root");

  const zoom = d3.zoom()
    .filter(event => {
      // Always allow wheel zoom
      if (event.type === "wheel") return true;

      // When NDVI painting is enabled & NDVI layer is active:
      // - ignore left-button drag so our paint logic can use it
      if (enableNdviPainting &&
          activeLayer &&
          activeLayer.id === "ndvi" &&
          event.type === "mousedown" &&
          event.button === 0) {
        return false;   // do NOT start zoom on this drag
      }

      // Otherwise: default behavior (left mouse drags for pan, etc.)
      // This is a slightly stricter version of d3's default filter:
      if (event.type === "mousedown" && event.button === 0 && !event.ctrlKey) return true;
      if (event.type === "dblclick") return true;

      return false;
    })
    .scaleExtent([1, 8])
    .translateExtent([
      [xOffset, yOffset],
      [xOffset + rasterWidth * cellWidth, yOffset + rasterHeight * cellHeight]
    ])
    .on("zoom", (event) => {
      rootG.attr("transform", event.transform);
    });

  svg.call(zoom);

  const defs = svg.append("defs");
  const shadow = defs.append("filter")
    .attr("id", "wardShadowGrid")
    .attr("x", "-20%")
    .attr("y", "-20%")
    .attr("width", "140%")
    .attr("height", "140%");

  shadow.append("feDropShadow")
    .attr("dx", 0)
    .attr("dy", 0)
    .attr("stdDeviation", 2)
    .attr("flood-color", "#000")
    .attr("flood-opacity", 0.35);

  // ---------- 6. Pixel grid (draw once) ----------
  const pixelG = rootG.append("g").attr("class", "grid-pixels");
  
  // Create separate groups for background and foreground for smooth CSS transitions
  const backgroundG = pixelG.append("g")
    .attr("class", "background-pixels")
    .style("transition", "opacity 2s ease-in-out");
  
  const foregroundG = pixelG.append("g")
    .attr("class", "foreground-pixels");

  // Separate pixels into background and foreground
  const backgroundPixels = pixels.filter(d => !d.wardId);
  const foregroundPixels = pixels.filter(d => d.wardId);

  const backgroundRects = backgroundG.selectAll("rect")
    .data(backgroundPixels)
    .enter()
    .append("rect")
    .attr("x", d => xOffset + d.col * cellWidth)
    .attr("y", d => yOffset + d.row * cellHeight)
    .attr("width", cellWidth + 0.01)
    .attr("height", cellHeight + 0.01)
    .attr("data-idx", d => d.idx);

  const foregroundRects = foregroundG.selectAll("rect")
    .data(foregroundPixels)
    .enter()
    .append("rect")
    .attr("x", d => xOffset + d.col * cellWidth)
    .attr("y", d => yOffset + d.row * cellHeight)
    .attr("width", cellWidth + 0.01)
    .attr("height", cellHeight + 0.01)
    .attr("data-idx", d => d.idx);
  
  // Combined selection for updateLayer function
  const rects = pixelG.selectAll("rect");

  // ---------- 7. Ward borders (pixel-aligned) ----------
  // COMMENTED OUT - showing only background
  // ---------- 7. Ward borders (pixel-aligned) ----------
  const borderG = rootG.append("g")
    .attr("class", "grid-ward-borders")
    .attr("stroke", "#111")
    .attr("stroke-width", 0.8)
    .attr("fill", "none")
    .attr("pointer-events", "none")
    .attr("filter", "url(#wardShadowGrid)")
    .style("transition", "opacity 2s ease-in-out");

  const landCoverColorMap = buildLandCoverColorMap();

  function createLcBorder(x1, x2, y1, y2, lcColor) {
    borderG.append("line")
        .attr("x1", x1).attr("y1", y1)
        .attr("x2", x2).attr("y2", y2)
        .attr("stroke", lcColor);
  }

  // Generate borders based on the pixels' assigned wardIds
  // For flipped cities, pixels have already been assigned flipped wardIds
  // So we compare neighbors in the normal grid and draw at normal positions
  for (let row = 0; row < rasterHeight; row++) {
    for (let col = 0; col < rasterWidth; col++) {
      const idx = row * rasterWidth + col;
    
      if (lcUnit) {
        let x1 = 0;
        let x2 = 0;
        let y1 = 0;
        let y2 = 0;

        //right edge
        x1  = xOffset + (col + 1) * cellWidth;
        y1 = yOffset + row * cellHeight;
        y2 = yOffset + (row + 1) * cellHeight;
        let lcColor = landCoverColorMap[pixels[idx].lc];
        if (col < rasterWidth - 1) {
            lcColor = blendColors(landCoverColorMap[pixels[idx].lc], landCoverColorMap[pixels[idx + 1].lc]);
        }
        createLcBorder(x1, x1, y1, y2, lcColor);

        //left edge
        x1  = xOffset + col * cellWidth;
        y1 = yOffset + row * cellHeight;
        y2 = yOffset + (row + 1) * cellHeight;
        lcColor = landCoverColorMap[pixels[idx].lc];
        if (col > 0) {
            lcColor = blendColors(landCoverColorMap[pixels[idx].lc], landCoverColorMap[pixels[idx - 1].lc]);
        }
        createLcBorder(x1, x1, y1, y2, lcColor);

        //bottom edge
        y1  = yOffset + (row + 1) * cellHeight;
        x1 = xOffset + col * cellWidth;
        x2 = xOffset + (col + 1) * cellWidth;
        lcColor = landCoverColorMap[pixels[idx].lc];
        if (row < rasterHeight - 1) {
            lcColor = blendColors(landCoverColorMap[pixels[idx].lc], landCoverColorMap[pixels[idx + rasterWidth].lc]);
        }
        createLcBorder(x1, x2, y1, y1, lcColor);
        
        //top edge
        y1  = yOffset + row * cellHeight;
        x1 = xOffset + col * cellWidth;
        x2 = xOffset + (col + 1) * cellWidth;
        lcColor = landCoverColorMap[pixels[idx].lc];
        if (row > 0) {
            lcColor = blendColors(landCoverColorMap[pixels[idx].lc], landCoverColorMap[pixels[idx - rasterWidth].lc]);
        }
        createLcBorder(x1, x2, y1, y1, lcColor);
      }

      const wId = pixels[idx].wardId;
      if (!wId) continue;

      // right edge - compare with neighbor to the right
      if (!lcUnit && col < rasterWidth - 1) {
        const wRight = pixels[idx + 1].wardId;
        if (wRight !== wId) {
          const x  = xOffset + (col + 1) * cellWidth;
          const y1 = yOffset + row * cellHeight;
          const y2 = yOffset + (row + 1) * cellHeight;
          borderG.append("line")
            .attr("x1", x).attr("y1", y1)
            .attr("x2", x).attr("y2", y2);
        }
      }

      // bottom edge - compare with neighbor below
      if (!lcUnit && row < rasterHeight - 1) {
        const wDown = pixels[idx + rasterWidth].wardId;
        if (wDown !== wId) {
          const y  = yOffset + (row + 1) * cellHeight;
          const x1 = xOffset + col * cellWidth;
          const x2 = xOffset + (col + 1) * cellWidth;
          borderG.append("line")
            .attr("x1", x1).attr("y1", y)
            .attr("x2", x2).attr("y2", y);
        }
      }
    }
  }

  // ---------- 8. Tooltip ----------
  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "grid-tooltip")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("background", "rgba(0,0,0,0.8)")
    .style("color", "#fff")
    .style("padding", "4px 8px")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("opacity", 0);

  // Default tooltip if none provided
  const defaultTooltipFormatter = ({ pixel, ward, activeLayer, allLayers, subunit }) => {
    const wardLine = ward
      ? `${subunit}: ${ward.name || ("ID " + pixel.wardId)}<br>`
      : `<span style="opacity:0.7">Outside city</span><br>`;

    let rows = "";
    allLayers.forEach(layer => {
      const v = layer.values[pixel.idx];
      if (v == null || !Number.isFinite(v)) return;
      const active = (layer.id === activeLayer.id);

      // --- base value formatting ---
      const isTempLayer =
        layer.id === "lst_day" || layer.id === "lst_night";

      let displayVal = v;
      let unitLabel = layer.unit ? ` ${layer.unit}` : "";

      if (isTempLayer) {
        const tv = toDisplayTemp(v);
        if (tv != null) displayVal = tv;
        unitLabel = ` ${tempSuffix()}`;
      }

      let val = `${displayVal.toFixed(2)}${unitLabel}`;

      // Land cover override (ignores numeric / units)
      if (layer.id === "lc") {
        const lcCode = Math.round(v);
        val = landCoverTypes[lcCode] || `Class ${lcCode}`;
        if (lcCode == 15 | lcCode == 16) {
          val = "Barren";
        }
        if (lcCode == 17) {
          val = "Water/Snow/Ice";
        }
      }

      // --- inline delta vs baseline (only for painted pixels) ---
      let deltaHtml = "";
      if (
        enableNdviPainting &&
        simState &&
        simState.touchedMask &&
        simState.touchedMask[pixel.idx]
      ) {
        let baseVal = null;
        let isTempDelta = false;

        if (layer.id === "ndvi" && simState.baseNdvi) {
          baseVal = simState.baseNdvi[pixel.idx];
        } else if (layer.id === "lst_day" && simState.baseLstDay) {
          baseVal = simState.baseLstDay[pixel.idx];
          isTempDelta = true;
        } else if (layer.id === "lst_night" && simState.baseLstNight) {
          baseVal = simState.baseLstNight[pixel.idx];
          isTempDelta = true;
        }

        if (baseVal != null && Number.isFinite(baseVal)) {
          let delta;
          let unit = "";

          if (layer.id === "ndvi") {
            // NDVI is unitless and stays unitless
            delta = v - baseVal;
            unit = "";
          } else if (isTempDelta) {
            // For LST, compute delta in display units (°C or °F)
            const baseDisp = toDisplayTemp(baseVal);
            const newDisp  = toDisplayTemp(v);
            if (baseDisp != null && newDisp != null) {
              delta = newDisp - baseDisp;
              unit = ` ${tempSuffix()}`;
            }
          }

          if (delta != null && Math.abs(delta) > 1e-4) {
            const sign = delta >= 0 ? "+" : "";
            let deltaColor = "#FFD54F"; // default amber

            if (layer.id === "ndvi") {
              deltaColor = "#A5D6A7";   // greenish for greenness change
            } else {
              // cooler temps blue, hotter red
              deltaColor = delta <= 0 ? "#81D4FA" : "#EF9A9A";
            }

            deltaHtml =
              ` <span style="color:${deltaColor};opacity:0.9">` +
              `(${sign}${delta.toFixed(2)}${unit} vs baseline)` +
              `</span>`;
          }
        }
      }

      rows += `<span style="color:${active ? "#fff" : "#ccc"}">` +
        `${layer.label}: ` + val + deltaHtml + `</span><br>`;
    });

    return (
      `<strong>${cityName}</strong><br>` +
      wardLine +
      rows +
      `Lon: ${pixel.lon.toFixed(3)}, Lat: ${pixel.lat.toFixed(3)}`
    );
  };

  const tooltipFn = (params) => {
    // 1) Always build the core tooltip (values + inline deltas + temp units)
    const baseHtml = defaultTooltipFormatter(params);

    // 2) Let a per-city formatter (if provided) APPEND extra content
    //    (e.g. a "What if NDVI +0.10?" block), using the same tempUnit, etc.
    let extraHtml = "";
    if (typeof tooltipFormatter === "function") {
      extraHtml = tooltipFormatter({
        ...params,
        tempUnit,
        toDisplayTemp,
        tempSuffix,
        simState
      }) || "";
    }

    return baseHtml + extraHtml;
  };

  // ---------- 8.5 Greenness simulator summary box (optional) ----------
  let simSummaryBox = null;

  function updateSimSummary() {
    if (!enableNdviPainting || !simState) return;
    if (!simSummaryBox) return;

    if (!simState.touchedCount) {
      simSummaryBox.html(
        `<strong>Greenness simulator</strong><br>` +
        `<span style="opacity:0.8">Switch to the NDVI layer and drag to “paint” greenness. ` +
        `We’ll estimate how much that could cool local daytime and nighttime land surface temperatures.</span>`
      );
      return;
    }

    const avgDay = simState.touchedCount
      ? simState.totalDeltaDay / simState.touchedCount
      : 0;
    const avgNight = simState.touchedCount
      ? simState.totalDeltaNight / simState.touchedCount
      : 0;

    const factor = tempUnit === "C" ? 1 : 9 / 5;
    const unit = tempSuffix();

    const avgDayDisp = avgDay * factor;
    const avgNightDisp = avgNight * factor;

    const wardNames = Array.from(simState.wardsTouched || []);
    let wardText = "";
    if (wardNames.length === 1) wardText = wardNames[0];
    else if (wardNames.length <= 3) wardText = wardNames.join(", ");
    else wardText = wardNames.slice(0, 3).join(", ") +
      `, +${wardNames.length - 3} more`;

    simSummaryBox.html(
      `<strong>Greenness simulator</strong><br>` +
      `<span style="opacity:0.85">You’ve modified greenness in ` +
      `${simState.touchedCount} pixels` +
      (wardText ? ` across <em>${wardText}</em>` : "") +
      `.</span><br>` +
      `<span style="opacity:0.9">Avg daytime LST change: ` +
      `${avgDay >= 0 ? "+" : ""}${avgDay.toFixed(2)} ${unit}</span><br>` +
      `<span style="opacity:0.9">Avg nighttime LST change: ` +
      `${avgNight >= 0 ? "+" : ""}${avgNight.toFixed(2)} ${unit}</span>`
    );
  }

  if (enableNdviPainting && simCityKey) {
    simSummaryBox = container.append("div")
      .attr("class", "ndvi-sim-summary")
      .style("position", "absolute")
      .style("bottom", "10px")
      .style("right", "16px")
      .style("background", "rgba(0,0,0,0.75)")
      .style("color", "#fff")
      .style("padding", "6px 8px")
      .style("border-radius", "4px")
      .style("font-size", "11px")
      .style("max-width", "260px")
      .style("line-height", "1.3")
      .style("display", "none");

    updateSimSummary();
  }

  // --- Brush controls (size + intensity) ---
  if (enableNdviPainting && simCityKey && simState) {
    const brushControls = container.append("div")
      .attr("class", "ndvi-brush-controls")
      .style("position", "absolute")
      .style("bottom", "10px")
      .style("left", "16px")
      .style("background", "rgba(0,0,0,0.75)")
      .style("color", "#fff")
      .style("padding", "6px 8px")
      .style("border-radius", "4px")
      .style("font-size", "11px")
      .style("max-width", "260px")
      .style("line-height", "1.3")
      .style("display", "none");

    brushControls.append("div")
      .style("font-weight", "bold")
      .style("margin-bottom", "4px")
      .text("Brush settings");

    // Brush size (in pixel radius)
    const sizeRow = brushControls.append("div")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "6px")
      .style("margin-bottom", "4px");

    sizeRow.append("span")
      .text("Size:");

    const sizeValue = sizeRow.append("span")
      .style("font-weight", "bold")
      .text(`${simState.brushRadius ?? DEFAULT_BRUSH_RADIUS}px`);

    const sizeInput = sizeRow.append("input")
      .attr("type", "range")
      .attr("min", 0)
      .attr("max", 4)
      .attr("step", 1)
      .attr("value", simState.brushRadius ?? DEFAULT_BRUSH_RADIUS)
      .style("flex", "1");

    sizeInput.on("input", (event) => {
      const r = +event.target.value;
      simState.brushRadius = r;
      sizeValue.text(`${r}px`);
    });

    // Brush intensity (NDVI delta per pass)
    const intensityRow = brushControls.append("div")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "6px");

    intensityRow.append("span")
      .text("Strength:");

    const initialIntensity = Math.round(
      100 * (simState.paintStep || DEFAULT_PAINT_DELTA)
    ); // 0.02 -> 2

    const intensityValue = intensityRow.append("span")
      .style("font-weight", "bold")
      .text(`+${(initialIntensity / 100).toFixed(2)} NDVI / pass`);

    const intensityInput = intensityRow.append("input")
      .attr("type", "range")
      .attr("min", 1)   // 0.01
      .attr("max", 10)  // 0.10
      .attr("step", 1)
      .attr("value", initialIntensity)
      .style("flex", "1");

    intensityInput.on("input", (event) => {
      const v = +event.target.value;
      const step = v / 100; // 1 → 0.01, 10 → 0.10
      simState.paintStep = step;
      intensityValue.text(`+${step.toFixed(2)} NDVI / pass`);
    });
  }

  // ---------- 9. Legend ----------
  const legendMargin = 16;
  const safeContainerId = containerId.replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `grid-layer-gradient-${safeContainerId}`;

  // Estimate legend widths
  // For bivariate: legendSize=120, backgroundPadding=70, diagonal calculation
  const bivariateLegendWidth = Math.ceil((120 + 70) * 1.414) + 10;
  const univariateLegendWidth = 65; // textWidth + legendWidth + spacing
  const legendWidth = bivariate ? bivariateLegendWidth : univariateLegendWidth;

  // Position legend: centered between wall and map if space allows, otherwise constrained
  let legendLeft, legendTransform;
  
  if (bivariate) {
    // For bivariate: center between wall and map, but ensure it doesn't overflow left
    const idealLeft = xOffset / 2;
    const minLeft = legendWidth / 2 + 10; // 10px padding from left edge
    legendLeft = Math.max(idealLeft, minLeft);
    legendTransform = "translate(-50%, -50%)";
  } else {
    // For univariate: 10px left of map, but ensure it fits
    const idealLeft = xOffset - 10;
    const minLeft = legendWidth + 10; // Ensure full width visible with 10px padding
    legendLeft = Math.max(idealLeft, minLeft);
    legendTransform = "translate(-100%, -50%)";
  }

  // Create a container div for the legend that can be rebuilt as needed
  const legendContainer = container.append("div")
    .attr("class", "legend-container")
    .style("position", "absolute")
    .style("left", `${legendLeft}px`)
    .style("top", "50%")
    .style("transform", legendTransform)
    .style("padding", bivariate ? "0px" : "8px")
    .style("background", bivariate ? "transparent" : "white")
    .style("border-radius", bivariate ? "0px" : "4px")
    .style("max-height", "300px")
    .style("overflow-y", "auto");

  // --- Temperature unit toggle (for tooltips, legend labels, summary) ---
  const unitControls = container.append("div")
    .attr("class", "temp-unit-toggle")
    .style("position", "absolute")
    .style("top", "12px")
    .style("left", "16px")
    .style("background", "rgba(0,0,0,0.75)")
    .style("color", "#fff")
    .style("padding", "4px 6px")
    .style("border-radius", "4px")
    .style("font-size", "11px")
    .style("display", "none") // start hidden; scenes decide when to show
    .style("gap", "4px")
    .style("align-items", "center");

  unitControls.append("span")
    .text("Temp:");

  const cBtn = unitControls.append("button")
    .text("°C")
    .style("border", "none")
    .style("padding", "2px 4px")
    .style("border-radius", "3px")
    .style("cursor", "pointer");

  const fBtn = unitControls.append("button")
    .text("°F")
    .style("border", "none")
    .style("padding", "2px 4px")
    .style("border-radius", "3px")
    .style("cursor", "pointer");

  function updateUnitButtons() {
    cBtn
      .style("background", tempUnit === "C" ? "#fff" : "transparent")
      .style("color", tempUnit === "C" ? "#000" : "#fff");
    fBtn
      .style("background", tempUnit === "F" ? "#fff" : "transparent")
      .style("color", tempUnit === "F" ? "#000" : "#fff");
  }

  cBtn.on("click", () => {
    if (tempUnit === "C") return;
    tempUnit = "C";
    updateUnitButtons();
    updateLayer(false);   // refresh legend labels
    updateSimSummary();   // refresh summary units
  });

  fBtn.on("click", () => {
    if (tempUnit === "F") return;
    tempUnit = "F";
    updateUnitButtons();
    updateLayer(false);
    updateSimSummary();
  });

  updateUnitButtons();

  // ---------- 10. Layer toggle buttons ----------
  activeLayer = layerStates.find(l => l.id === activeLayerId) || layerStates[0];
  activeLayerId = activeLayer.id;

  // Background opacity control for London
  let backgroundOpacity = 0.30;

  let buttons = null;
  if (showLayerToggle && layerStates.length > 1) {
    const controls = container.append("div")
      .attr("class", "grid-layer-controls")
      .style("position", "absolute")
      .style("top", "12px")
      .style("right", "16px")
      .style("display", "flex")
      .style("gap", "6px")
      .style("background", "rgba(250,250,250,0.9)")
      .style("padding", "4px 6px")
      .style("border-radius", "4px")
      .style("font-size", "12px");

    if (bivariate) {
      // Bivariate mode: two dropdowns for variable selection
      // Only include continuous layers (exclude land cover) for Variable 1
      const continuousLayers = layerStates.filter(l => l.id !== "lc");
      
      controls.append("span")
        .style("margin-right", "4px")
        .text("Variable 1:");
      
      const select1 = controls.append("select")
        .style("padding", "2px 6px")
        .style("border", "1px solid #ccc")
        .style("border-radius", "3px")
        .style("cursor", "pointer")
        .style("font-size", "12px")
        .on("change", function() {
          bivariateVars.var1 = this.value;
          
          // If var1 now matches var2, update var2 to the first available option
          if (bivariateVars.var1 === bivariateVars.var2) {
            const availableOptions = continuousLayers.filter(l => l.id !== bivariateVars.var1);
            bivariateVars.var2 = availableOptions.length > 0 ? availableOptions[0].id : continuousLayers[0].id;
          }
          
          // Refresh Variable 2 dropdown options
          select2.selectAll("option").remove();
          select2.selectAll("option")
            .data(continuousLayers.filter(l => l.id !== bivariateVars.var1), d => d.id)
            .enter()
            .append("option")
            .attr("value", d => d.id)
            .property("selected", d => d.id === bivariateVars.var2)
            .text(d => d.label.split(" (")[0]);
          
          updateLayer(true);
        });
      
      select1.selectAll("option")
        .data(continuousLayers, d => d.id)
        .enter()
        .append("option")
        .attr("value", d => d.id)
        .property("selected", d => d.id === bivariateVars.var1)
        .text(d => d.label.split(" (")[0]);
      
      controls.append("span")
        .style("margin-left", "8px")
        .style("margin-right", "4px")
        .text("Variable 2:");
      
      const select2 = controls.append("select")
        .style("padding", "2px 6px")
        .style("border", "1px solid #ccc")
        .style("border-radius", "3px")
        .style("cursor", "pointer")
        .style("font-size", "12px")
        .on("change", function() {
          bivariateVars.var2 = this.value;
          updateLayer(true);
        });
      
      // Add layers, excluding the currently selected var1
      select2.selectAll("option")
        .data(continuousLayers.filter(l => l.id !== bivariateVars.var1), d => d.id)
        .enter()
        .append("option")
        .attr("class", "layer-option")
        .attr("value", d => d.id)
        .property("selected", d => d.id === bivariateVars.var2)
        .text(d => d.label.split(" (")[0]);
      
    } else {
      // Standard mode: layer toggle buttons
      buttons = controls.selectAll("button")
        .data(layerStates, d => d.id)
        .enter()
        .append("button")
        .text(d => (d.buttonLabel || d.label).split(" (")[0])
        .style("border", "1px solid #ccc")
        .style("padding", "2px 6px")
        .style("border-radius", "3px")
        .style("cursor", "pointer")
        .style("background", d => d.id === activeLayerId ? "#333" : "#fff")
        .style("color", d => d.id === activeLayerId ? "#fff" : "#333")
        .on("click", (event, d) => {
          if (d.id === activeLayerId) return;
          activeLayerId = d.id;
          activeLayer = d;
          sessionActiveLayerId = d.id; // Remember for next city switch
          updateLayer(true); // animate

          buttons
            .style("background", b => b.id === activeLayerId ? "#333" : "#fff")
            .style("color", b => b.id === activeLayerId ? "#fff" : "#333");
        });
    }
  }

  // ---- Correlation panel UI (only if ≥2 numeric layers) ----
  if (numericLayers.length >= 2) {
    // default to first 2
    corrXId = numericLayers[0].id;
    corrYId = numericLayers[1].id;

    corrPanel = container.append("div")
      .attr("class", "corr-panel")
      .style("position", "absolute")
      .style("top", "48px")
      .style("right", "16px")
      .style("background", "rgba(250,250,250,0.96)")
      .style("border-radius", "4px")
      .style("box-shadow", "0 1px 3px rgba(0,0,0,0.25)")
      .style("padding", "6px 8px")
      .style("font-size", "11px")
      .style("max-width", "260px")
      .style("display", "none");

    const header = corrPanel.append("div")
      .style("display", "flex")
      .style("align-items", "center")
      .style("justify-content", "space-between")
      .style("margin-bottom", "4px");

    header.append("span")
      .style("font-weight", "bold")
      .text("Feature correlation");

    const toggle = header.append("span")
      .style("cursor", "pointer")
      .style("font-size", "10px")
      .style("color", "#0077cc")
      .text("Hide");

    corrContent = corrPanel.append("div");

    toggle.on("click", () => {
      const hidden = corrContent.style("display") === "none";
      corrContent.style("display", hidden ? "block" : "none");
      toggle.text(hidden ? "Hide" : "Show");
    });

    // Controls (X / Y selectors)
    const controlRow = corrContent.append("div")
      .style("display", "flex")
      .style("gap", "4px")
      .style("align-items", "center")
      .style("margin-bottom", "4px");

    controlRow.append("span").text("X:");

    corrXSelect = controlRow.append("select")
      .style("flex", "1")
      .style("font-size", "11px");

    controlRow.append("span").text("Y:");

    corrYSelect = controlRow.append("select")
      .style("flex", "1")
      .style("font-size", "11px");

    function populateCorrSelect(select, chosenId) {
      select.selectAll("option").remove();
      select.selectAll("option")
        .data(numericLayers, d => d.id)
        .enter()
        .append("option")
        .attr("value", d => d.id)
        .property("selected", d => d.id === chosenId)
        .text(d => d.label.split(" (")[0]);
    }

    populateCorrSelect(corrXSelect, corrXId);
    populateCorrSelect(corrYSelect, corrYId);

    corrXSelect.on("change", function() {
      corrXId = this.value;
      if (corrXId === corrYId) {
        // pick a different Y if same
        const alt = numericLayers.find(l => l.id !== corrXId);
        if (alt) {
          corrYId = alt.id;
          corrYSelect.property("value", corrYId);
        }
      }
      requestCorrelationUpdate();
    });

    corrYSelect.on("change", function() {
      corrYId = this.value;
      if (corrYId === corrXId) {
        const alt = numericLayers.find(l => l.id !== corrYId);
        if (alt) {
          corrXId = alt.id;
          corrXSelect.property("value", corrXId);
        }
      }
      requestCorrelationUpdate();
    });

    // SVG for scatterplot
    corrSvg = corrContent.append("svg")
      .attr("width", 240)
      .attr("height", 170);

    // kick off initial draw
    requestCorrelationUpdate();
  }

  function updateCorrelationPlot() {
    if (!corrSvg || !corrPanel || !numericLayers.length || !corrXId || !corrYId) return;

    const xLayer = numericLayers.find(l => l.id === corrXId);
    const yLayer = numericLayers.find(l => l.id === corrYId);
    if (!xLayer || !yLayer) return;

    const xValsRaw = xLayer.values;
    const yValsRaw = yLayer.values;

    const xs = [];
    const ys = [];

    const n = Math.min(xValsRaw.length, yValsRaw.length);
    for (let i = 0; i < n; i++) {
      const vx = xValsRaw[i];
      const vy = yValsRaw[i];
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;
      xs.push(vx);
      ys.push(vy);
    }
    if (xs.length < 2) {
      corrSvg.selectAll("*").remove();
      corrSvg.append("text")
        .attr("x", 120)
        .attr("y", 85)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "#666")
        .text("Not enough data");
      return;
    }

    // Sample up to 500 points for the scatter
    const sampleIdxs = [];
    const maxPoints = 500;
    if (xs.length <= maxPoints) {
      for (let i = 0; i < xs.length; i++) sampleIdxs.push(i);
    } else {
      for (let i = 0; i < maxPoints; i++) {
        sampleIdxs.push(Math.floor(Math.random() * xs.length));
      }
    }

    // Use *display* values for axes (so temps obey °C/°F toggle)
    const dispX = [];
    const dispY = [];
    const isXTemp = xLayer.id === "lst_day" || xLayer.id === "lst_night";
    const isYTemp = yLayer.id === "lst_day" || yLayer.id === "lst_night";

    sampleIdxs.forEach(i => {
      let vx = xs[i];
      let vy = ys[i];
      if (isXTemp) vx = toDisplayTemp(vx);
      if (isYTemp) vy = toDisplayTemp(vy);
      dispX.push(vx);
      dispY.push(vy);
    });

    const r = computeCorrelation(xs, ys); // correlation unaffected by linear °C→°F

    const margin = { top: 16, right: 8, bottom: 24, left: 30 };
    const width  = +corrSvg.attr("width")  - margin.left - margin.right;
    const height = +corrSvg.attr("height") - margin.top  - margin.bottom;

    corrSvg.selectAll("*").remove();
    const g = corrSvg.append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleLinear()
      .domain(d3.extent(dispX))
      .nice()
      .range([0, width]);

    const yScale = d3.scaleLinear()
      .domain(d3.extent(dispY))
      .nice()
      .range([height, 0]);

    const xAxis = d3.axisBottom(xScale).ticks(4);
    const yAxis = d3.axisLeft(yScale).ticks(4);

    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(xAxis)
      .selectAll("text")
      .style("font-size", "9px");

    g.append("g")
      .call(yAxis)
      .selectAll("text")
      .style("font-size", "9px");

    // Points
    g.append("g")
      .selectAll("circle")
      .data(d3.range(dispX.length))
      .enter()
      .append("circle")
      .attr("cx", i => xScale(dispX[i]))
      .attr("cy", i => yScale(dispY[i]))
      .attr("r", 1.8)
      .attr("fill", "rgba(33,150,243,0.7)");

    // Axes labels
    g.append("text")
      .attr("x", width / 2)
      .attr("y", height + 18)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("fill", "#444")
      .text(xLayer.label.split(" (")[0] + (isXTemp ? ` (${tempSuffix()})` : ""));

    g.append("text")
      .attr("transform", `rotate(-90)`)
      .attr("x", -height / 2)
      .attr("y", -24)
      .attr("text-anchor", "middle")
      .attr("font-size", 9)
      .attr("fill", "#444")
      .text(yLayer.label.split(" (")[0] + (isYTemp ? ` (${tempSuffix()})` : ""));

    // Correlation label
    g.append("text")
      .attr("x", 0)
      .attr("y", -4)
      .attr("font-size", 10)
      .attr("fill", "#333")
      .text(`r = ${r != null ? r.toFixed(2) : "–"}`);
  }

  // ---------- 11. Apply active layer (colors + legend) ----------
  function updateLayer(animate = false, fadeInBackground = false) {
    if (!activeLayer && !bivariate) return;

    // Bivariate mode
    if (bivariate && bivariateVars) {
      const layer1 = layerStates.find(l => l.id === bivariateVars.var1);
      const layer2 = layerStates.find(l => l.id === bivariateVars.var2);
      
      if (!layer1 || !layer2) {
        console.error("Bivariate layers not found");
        return;
      }
      
      // Determine color palettes based on variable combination
      let bivariatePalette1, bivariatePalette2;
      
      // Check if both variables are temperature (day vs night comparison)
      const isDayVsNight = (layer1.id === 'lst_day' && layer2.id === 'lst_night') ||
                           (layer1.id === 'lst_night' && layer2.id === 'lst_day');
      
      if (isDayVsNight) {
        // Day vs Night temperature: use orange for day, purple for night
        bivariatePalette1 = (layer1.id === 'lst_day') ? createDayTempPalette() : createNightTempPalette();
        bivariatePalette2 = (layer2.id === 'lst_day') ? createDayTempPalette() : createNightTempPalette();
      } else {
        // Vegetation vs Temperature: use green for vegetation, yellow for temperature
        bivariatePalette1 = (layer1.id === 'lst_day' || layer1.id === 'lst_night') 
          ? createBrightOrangePalette() 
          : createBrightGreenPalette();
        bivariatePalette2 = (layer2.id === 'lst_day' || layer2.id === 'lst_night') 
          ? createBrightOrangePalette() 
          : createBrightGreenPalette();
      }
    
      const bivariateColor = createBivariateColorScale(bivariatePalette1, bivariatePalette2);
    
      const sel = animate
        ? rects.transition().duration(350)
        : rects;
      
      sel.attr("fill", d => {
        const v1 = layer1.values[d.idx];
        const v2 = layer2.values[d.idx];
        const hasValue = v1 != null && Number.isFinite(v1) && v2 != null && Number.isFinite(v2);
        
        if (!hasValue) {
          return (isTokyo || needsFullVerticalFlip) ? "#ebebeb" : "rgba(235,235,235,0.9)";
        }
        
        return bivariateColor(v1, v2, layer1.min, layer1.max, layer2.min, layer2.max);
      })
      .attr("fill-opacity", 1.0);
      
      // Handle background group opacity with CSS transitions
      if (isTokyo || needsFullVerticalFlip) {
        if (fadeInBackground) {
          backgroundG.style("opacity", 1.0);
          borderG.style("opacity", 0);
          setTimeout(() => {
            backgroundG.style("opacity", backgroundOpacity);
            borderG.style("opacity", 1.0);
          }, 100);
        } else {
          backgroundG.style("opacity", backgroundOpacity);
          borderG.style("opacity", 1.0);
        }
      }
      
      // Update legend for bivariate
      legendContainer.selectAll("*").remove();
      
      // Create continuous bivariate legend with gradient
      const legendSize = 120;
      
      // Reduce padding to minimize empty space
      const svgPadding = 100;
      const svgSize = legendSize + svgPadding;
      
      // Calculate background dimensions that will encompass legend and text
      const backgroundPadding = 70;
      const backgroundSize = legendSize + backgroundPadding;
      
      // When rotated 45°, the diagonal of the square becomes the height/width needed
      // diagonal = side * sqrt(2) ≈ side * 1.414
      const rotatedDiagonal = backgroundSize * 1.414;
      
      // Expand SVG to fit the rotated background with rounded corners
      const expandedSvgSize = Math.ceil(rotatedDiagonal) + 10; // Add 10px buffer
      const expandedCenterOffset = expandedSvgSize / 2;
      
      // SVG size to accommodate rotation and text labels
      const legendSvg = legendContainer.append("svg")
        .attr("width", expandedSvgSize)
        .attr("height", expandedSvgSize);
      
      // Add white background square rotated -45 degrees with rounded corners
      legendSvg.append("rect")
        .attr("x", expandedCenterOffset - backgroundSize / 2)
        .attr("y", expandedCenterOffset - backgroundSize / 2)
        .attr("width", backgroundSize)
        .attr("height", backgroundSize)
        .attr("rx", 12)
        .attr("ry", 12)
        .attr("fill", "white")
        .attr("transform", `rotate(-45, ${expandedCenterOffset}, ${expandedCenterOffset})`);
      
      // Create a group for the rotated legend
      const legendGroup = legendSvg.append("g")
        .attr("transform", `translate(${expandedCenterOffset}, ${expandedCenterOffset}) rotate(-45)`);
      
      // For bivariate legend, use same palette logic as main visualization
      let legendPalette1, legendPalette2;
      
      if (isDayVsNight) {
        // Day vs Night temperature
        legendPalette1 = (layer1.id === 'lst_day') ? createDayTempPalette() : createNightTempPalette();
        legendPalette2 = (layer2.id === 'lst_day') ? createDayTempPalette() : createNightTempPalette();
      } else {
        // Vegetation vs Temperature
        legendPalette1 = (layer1.id === 'lst_day' || layer1.id === 'lst_night') 
          ? createBrightOrangePalette() 
          : createBrightGreenPalette();
        legendPalette2 = (layer2.id === 'lst_day' || layer2.id === 'lst_night') 
          ? createBrightOrangePalette() 
          : createBrightGreenPalette();
      }
      
      const legendBivariateColor = createBivariateColorScale(legendPalette1, legendPalette2);
      
      // Create 4x4 discrete grid
      const gridResolution = 4;
      const cellSize = legendSize / gridResolution;
      
      for (let i = 0; i < gridResolution; i++) {
        for (let j = 0; j < gridResolution; j++) {
          // Calculate color for this bin using center of bin
          const norm1 = (i + 0.5) / gridResolution;
          const norm2 = (j + 0.5) / gridResolution;
          
          const color = legendBivariateColor(
            layer1.min + norm1 * (layer1.max - layer1.min),
            layer2.min + norm2 * (layer2.max - layer2.min),
            layer1.min, layer1.max, layer2.min, layer2.max
          );
          
          legendGroup.append("rect")
            .attr("x", j * cellSize - legendSize / 2)
            .attr("y", (gridResolution - 1 - i) * cellSize - legendSize / 2)
            .attr("width", cellSize)
            .attr("height", cellSize)
            .attr("fill", color)
            .attr("stroke", "#999")
            .attr("stroke-width", 0.5);
        }
      }
      
      // Add border around gradient
      legendGroup.append("rect")
        .attr("x", -legendSize / 2)
        .attr("y", -legendSize / 2)
        .attr("width", legendSize)
        .attr("height", legendSize)
        .attr("fill", "none")
        .attr("stroke", "#999")
        .attr("stroke-width", 1);
      
      const centerX = expandedSvgSize / 2;
      const centerY = expandedSvgSize / 2;
      const diagonal = legendSize * 0.707; // Distance from center to corner after rotation
      
      // Calculate diamond tip positions after -45 degree rotation
      // Bottom tip: (centerX, centerY + diagonal)
      // Right tip: (centerX + diagonal, centerY)
      // Left tip: (centerX - diagonal, centerY)
      
      const bottomTipX = centerX;
      const bottomTipY = centerY + diagonal;
      const rightTipX = centerX + diagonal;
      const rightTipY = centerY;
      const leftTipX = centerX - diagonal;
      const leftTipY = centerY;
      
      // Low/High labels for Variable 2 (bottom-right edge)
      // Start from bottom tip, move along edge toward right tip
      // Angled at 45 degrees (perpendicular to -45 degree edge)
      
      // Low: near bottom tip (starting point) - align start of text
      const offsetDistance = 15; // Distance away from the edge
      legendSvg.append("text")
        .attr("x", bottomTipX + diagonal * 0.1)
        .attr("y", bottomTipY - diagonal * 0.1 + offsetDistance)
        .attr("text-anchor", "start")
        .attr("font-size", 9)
        .attr("fill", "#666")
        .attr("transform", `rotate(-45, ${bottomTipX + diagonal * 0.1}, ${bottomTipY - diagonal * 0.1 + offsetDistance})`)
        .text("Low");
      
      // High: near right tip (ending point) - align start of text
      legendSvg.append("text")
        .attr("x", rightTipX - diagonal * 0.1)
        .attr("y", rightTipY + diagonal * 0.1 + offsetDistance)
        .attr("text-anchor", "start")
        .attr("font-size", 9)
        .attr("fill", "#666")
        .attr("transform", `rotate(-45, ${rightTipX - diagonal * 0.1}, ${rightTipY + diagonal * 0.1 + offsetDistance})`)
        .text("High");
      
      // Variable 2 axis label (bottom-right edge) - angled at -45 degrees, below High/Low
      // Position orthogonally from midpoint of bottom-right edge
      const axisOffsetDistance = offsetDistance + 15; // Extra distance below Low/High labels
      const midBottomRightX = (bottomTipX + rightTipX) / 2;
      const midBottomRightY = (bottomTipY + rightTipY) / 2;
      // Move perpendicular to edge (down-right for bottom-right edge at -45°)
      const axis2X = midBottomRightX + axisOffsetDistance * Math.cos(Math.PI / 4);
      const axis2Y = midBottomRightY + axisOffsetDistance * Math.sin(Math.PI / 4);
      
      legendSvg.append("text")
        .attr("x", axis2X)
        .attr("y", axis2Y)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "#333")
        .attr("transform", `rotate(-45, ${axis2X}, ${axis2Y})`)
        .text(layer2.label.split(" (")[0]);
      
      // Low/High labels for Variable 1 (bottom-left edge)
      // Start from bottom tip, move along edge toward left tip
      // Angled at -45 degrees (perpendicular to 45 degree edge)
      
      // Low: near bottom tip (starting point) - align end of text
      legendSvg.append("text")
        .attr("x", bottomTipX - diagonal * 0.1)
        .attr("y", bottomTipY - diagonal * 0.1 + offsetDistance)
        .attr("text-anchor", "end")
        .attr("font-size", 9)
        .attr("fill", "#666")
        .attr("transform", `rotate(45, ${bottomTipX - diagonal * 0.1}, ${bottomTipY - diagonal * 0.1 + offsetDistance})`)
        .text("Low");
      
      // High: near left tip (ending point) - align end of text
      legendSvg.append("text")
        .attr("x", leftTipX + diagonal * 0.1)
        .attr("y", leftTipY + diagonal * 0.1 + offsetDistance)
        .attr("text-anchor", "end")
        .attr("font-size", 9)
        .attr("fill", "#666")
        .attr("transform", `rotate(45, ${leftTipX + diagonal * 0.1}, ${leftTipY + diagonal * 0.1 + offsetDistance})`)
        .text("High");
      
      // Variable 1 axis label (bottom-left edge) - angled at 45 degrees, below High/Low
      // Position orthogonally from midpoint of bottom-left edge
      const midBottomLeftX = (bottomTipX + leftTipX) / 2;
      const midBottomLeftY = (bottomTipY + leftTipY) / 2;
      // Move perpendicular to edge (down-left for bottom-left edge at 45°)
      const axis1X = midBottomLeftX - axisOffsetDistance * Math.cos(Math.PI / 4);
      const axis1Y = midBottomLeftY + axisOffsetDistance * Math.sin(Math.PI / 4);
      
      legendSvg.append("text")
        .attr("x", axis1X)
        .attr("y", axis1Y)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", "#333")
        .attr("transform", `rotate(45, ${axis1X}, ${axis1Y})`)
        .text(layer1.label.split(" (")[0]);
      
      return;
    }

    // Standard univariate mode
    const colorScale = d3.scaleSequential(activeLayer.palette)
      .domain([activeLayer.min, activeLayer.max]);

    // Expose for painting so we can recolor a single rect
    activeLayer.colorScale = colorScale;

    if (enableNdviPainting && activeLayer.id === "ndvi") {
      svg.style("cursor", "crosshair");
    } else {
      svg.style("cursor", "default");
    }

    // Check if this is a land cover layer
    const isLandCover = activeLayer.id === "lc" || activeLayer.label === "Land Cover Type (grouped)";

    const sel = animate
      ? rects.transition().duration(350)
      : rects;

    sel
      .attr("fill", d => {
        const v = activeLayer.values[d.idx];
        const hasValue = v != null && Number.isFinite(v);

        // Use discrete color map for land cover
        if (isLandCover && hasValue) {
          const lcValue = Math.round(v);
          const discreteColor = landCoverColorMap[lcValue];
          
          // For cities with vertical flip or Tokyo: distinguish foreground from background
          if (isTokyo || needsFullVerticalFlip) {
            if (!d.wardId) {
              // Background pixels - use full opacity color (group opacity handles transparency)
              return discreteColor || "#ebebeb";
            }
            // Foreground/ward pixels get full opacity
            return discreteColor || "#f0f0f0";
          }
          
          // For other cities: no foreground/background distinction
          return discreteColor || "rgba(235,235,235,0.9)";
        }

        // For non-land-cover layers, use continuous color scale
        // For cities with vertical flip or Tokyo: distinguish foreground (wardId > 0) from background (wardId = 0)
        if (isTokyo || needsFullVerticalFlip) {
          if (!d.wardId) {
            // Background pixels - use full opacity color (group opacity handles transparency)
            if (!hasValue) {
              return "#ebebeb"; // No data background = light grey
            }
            return colorScale(v);
          }
          // Foreground/ward pixels get full opacity
          if (!hasValue) {
            return "#f0f0f0"; // No data in ward = light grey
          }
          return colorScale(v);
        }

        // For other cities: no foreground/background distinction
        if (!hasValue) {
          return "rgba(235,235,235,0.9)"; // No data = light grey
        }
        return colorScale(v); // All pixels get full opacity colormap
      })
      .attr("fill-opacity", 1.0);

    // Handle background group opacity with CSS transitions
    if (isTokyo || needsFullVerticalFlip) {
      if (fadeInBackground) {
        // Set initial full opacity on background group
        backgroundG.style("opacity", 1.0);
        // Set initial zero opacity on borders
        borderG.style("opacity", 0);
        
        // Trigger fade to target opacity after a brief delay
        setTimeout(() => {
          backgroundG.style("opacity", backgroundOpacity);
          borderG.style("opacity", 1.0);
        }, 100);
      } else {
        // Normal layer switch - just set the target opacity directly
        backgroundG.style("opacity", backgroundOpacity);
        borderG.style("opacity", 1.0);
      }
    }

    // Update legend based on whether this is a categorical layer
    legendContainer.selectAll("*").remove();

    if (activeLayer.categories) {
      // Categorical legend (e.g., Land Cover Type)
      const isLandCover = activeLayer.id === "lc" || activeLayer.label === "Land Cover Type";
      const legendTitle = legendContainer.append("div")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("margin-bottom", "6px")
        .style("color", "#333")
        .text(isLandCover ? activeLayer.label + " (grouped)" : activeLayer.label);

      const categoriesContainer = legendContainer.append("div")
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("gap", "1px");

      activeLayer.categories.forEach(cat => {
        const item = categoriesContainer.append("div")
          .style("display", "flex")
          .style("align-items", "center")
          .style("gap", "6px");

        item.append("div")
          .style("width", "16px")
          .style("height", "16px")
          .style("background-color", cat.color || colorScale(cat.value))
          .style("border", "1px solid #ccc")
          .style("flex-shrink", "0");

        item.append("div")
          .style("font-size", "10px")
          .style("color", "#333")
          .text(cat.label);
      });
    } else {
      // Continuous legend (vertical orientation)
      const legendWidth = 10;
      const legendHeight = 210;
      const textWidth = 50;

      const legendTitle = legendContainer.append("div")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("margin-bottom", "4px")
        .style("color", "#333")
        .style("text-align", "center")
        .text(activeLayer.label);

      const legendSvg = legendContainer.append("svg")
        .attr("width", textWidth + legendWidth + 5)
        .attr("height", legendHeight);

      const legendDefs = legendSvg.append("defs");
      const gradient = legendDefs.append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%").attr("x2", "0%")
        .attr("y1", "100%").attr("y2", "0%");

      const stops = 20;
      for (let i = 0; i <= stops; i++) {
        const t = i / stops;
        const v = activeLayer.min + t * (activeLayer.max - activeLayer.min);
        gradient.append("stop")
          .attr("offset", (t * 100) + "%")
          .attr("stop-color", colorScale(v));
      }

      legendSvg.append("rect")
        .attr("x", textWidth)
        .attr("y", 0)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .attr("fill", `url(#${gradientId})`);

      const isTempLegend =
        activeLayer.id === "lst_day" || activeLayer.id === "lst_night";

      const minDisplay = isTempLegend
        ? toDisplayTemp(activeLayer.min)
        : activeLayer.min;
      const maxDisplay = isTempLegend
        ? toDisplayTemp(activeLayer.max)
        : activeLayer.max;

      const legendUnit = isTempLegend
        ? ` ${tempSuffix()}`
        : (activeLayer.unit ? ` ${activeLayer.unit}` : "");

      legendSvg.append("text")
        .attr("x", textWidth - 5)
        .attr("y", legendHeight)
        .attr("dy", "-0.5em")
        .attr("font-size", 10)
        .attr("fill", "#333")
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .text(
          (minDisplay.toFixed(1) === "-0.0" ? "0.0" : minDisplay.toFixed(1)) +
          legendUnit
        );

      legendSvg.append("text")
        .attr("x", textWidth - 5)
        .attr("y", 0)
        .attr("dy", "0.5em")
        .attr("font-size", 10)
        .attr("fill", "#333")
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .text(
          (maxDisplay.toFixed(1) === "-0.0" ? "0.0" : maxDisplay.toFixed(1)) +
          legendUnit
        );
    }

    // Broadcast layer change so other components (like ward comparison) can react
    document.dispatchEvent(new CustomEvent("gridLayerChanged", {
      detail: {
        city: cityName,
        layerId: activeLayer.id,
        layer: activeLayer
      }
    }));

    // Also refresh correlation view if it exists
    requestCorrelationUpdate();
  }

  updateLayer(false, isInitialRender); // initial paint

  // ---------- 12. Pixel hover (tooltips + wardHover event + NDVI painting) ----------
  let isPainting = false;

  // Core: apply NDVI/LST updates to a single pixel (by pixel object)
  function applyPaintAtPixel(pixel, rectSel) {
    if (!enableNdviPainting || !simState) return;
    if (!pixel.wardId) return;  // ignore outside-city pixels

    const idx = pixel.idx;
    const oldNdvi = simState.currNdvi[idx];
    if (!Number.isFinite(oldNdvi)) return;

    const baseNdvi = simState.baseNdvi[idx];
    const step = simState.paintStep || DEFAULT_PAINT_DELTA;

    let newNdvi = oldNdvi + step;
    if (newNdvi > NDVI_MAX_CLAMP) newNdvi = NDVI_MAX_CLAMP;
    if (newNdvi <= oldNdvi + 1e-6) return;

    simState.currNdvi[idx] = newNdvi;

    const nPixels = simState.baseNdvi.length;

    // Ensure per-pixel delta buffers exist
    if (!simState.deltaDay || simState.deltaDay.length !== nPixels) {
      simState.deltaDay = new Float32Array(nPixels);
      simState.deltaNight = new Float32Array(nPixels);
    }
    if (!simState.touchedMask || simState.touchedMask.length !== nPixels) {
      simState.touchedMask = new Uint8Array(nPixels);
    }

    // --- Daytime update ---
    if (simState.baseLstDay && simState.currLstDay) {
      const resDay = estimateLstChangeFromNdvi({
        cityName,
        baseNdvi,
        newNdvi,
        target: "day"
      });
      if (resDay) {
        const oldDelta = simState.deltaDay[idx] || 0;
        const newDelta = resDay.newPred - simState.baseLstDay[idx];

        simState.currLstDay[idx] = resDay.newPred;
        simState.totalDeltaDay += (newDelta - oldDelta);
        simState.deltaDay[idx] = newDelta;
      }
    }

    // --- Nighttime update ---
    if (simState.baseLstNight && simState.currLstNight) {
      const resNight = estimateLstChangeFromNdvi({
        cityName,
        baseNdvi,
        newNdvi,
        target: "night"
      });
      if (resNight) {
        const oldDelta = simState.deltaNight[idx] || 0;
        const newDelta = resNight.newPred - simState.baseLstNight[idx];

        simState.currLstNight[idx] = resNight.newPred;
        simState.totalDeltaNight += (newDelta - oldDelta);
        simState.deltaNight[idx] = newDelta;
      }
    }

    // Mark pixel / ward as touched
    if (!simState.touchedMask[idx]) {
      simState.touchedMask[idx] = 1;
      simState.touchedCount += 1;
    }
    if (pixel.wardId && wardInfoMap.has(pixel.wardId)) {
      const w = wardInfoMap.get(pixel.wardId);
      const name = w && w.name ? w.name : `${subunit} ${pixel.wardId}`;
      simState.wardsTouched.add(name);
    }

    // Recolor this specific rect if we’re on NDVI
    if (activeLayer.id === "ndvi" && activeLayer.colorScale && rectSel && !rectSel.empty()) {
      rectSel.attr("fill", activeLayer.colorScale(newNdvi));
    }
  }

  // Wrapper: apply brush (center + neighborhood)
  function paintPixel(d, rectSel) {
    if (!enableNdviPainting || !simState) return;
    if (!isPainting) return;
    if (!activeLayer || activeLayer.id !== "ndvi") return;

    const radius = (simState.brushRadius != null)
      ? simState.brushRadius
      : DEFAULT_BRUSH_RADIUS;

    // Center pixel
    applyPaintAtPixel(d, rectSel);

    // Neighborhood (circular brush in grid space)
    if (radius > 0) {
      const r = radius;
      const r2 = r * r;

      for (let dr = -r; dr <= r; dr++) {
        for (let dc = -r; dc <= r; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = d.row + dr;
          const cc = d.col + dc;
          if (rr < 0 || rr >= rasterHeight || cc < 0 || cc >= rasterWidth) continue;
          if (dr * dr + dc * dc > r2) continue;

          const idx2 = rr * rasterWidth + cc;
          const neighborPixel = pixels[idx2];
          if (!neighborPixel || !neighborPixel.wardId) continue;

          const neighborRect = pixelG.select(`rect[data-idx='${idx2}']`);
          applyPaintAtPixel(neighborPixel, neighborRect);
        }
      }
    }

    updateSimSummary();
    requestCorrelationUpdate();
    requestWardStatsUpdate();
  }

  svg
    .on("mouseup", () => { isPainting = false; })
    .on("mouseleave", () => { isPainting = false; });

  rects
    .on("mousedown", function (event, d) {
      // Start painting only on NDVI layer with left-click
      if (enableNdviPainting && activeLayer && activeLayer.id === "ndvi" && event.button === 0) {
        isPainting = true;
        paintPixel(d, d3.select(this));
        event.preventDefault();
        event.stopPropagation(); // don’t start zoom/pan on this drag
      }
    })
    .on("mouseenter", function (event, d) {
      d3.select(this)
        .attr("stroke", "#000")
        .attr("stroke-width", 0.5);

      const ward = d.wardId ? wardInfoMap.get(d.wardId) : null;
      const html = tooltipFn({
        pixel: d,
        ward,
        activeLayer,
        allLayers: layerStates,
        subunit,
        cityName,
        tempUnit,
        tempSuffix,
        toDisplayTemp,
        simState
      });

      tooltip
        .style("opacity", 1)
        .html(html)
        .style("left", (event.pageX + 12) + "px")
        .style("top",  (event.pageY - 28) + "px");

      if (d.wardId) {
        document.dispatchEvent(new CustomEvent("wardHover", {
          detail: {
            city: cityName,
            wardId: d.wardId,
            ward
          }
        }));
      }

      // If already painting, this pixel should get updated too
      paintPixel(d, d3.select(this));
    })
    .on("mousemove", function (event, d) {
      tooltip
        .style("left", (event.pageX + 12) + "px")
        .style("top",  (event.pageY - 28) + "px");

      if (isPainting && enableNdviPainting && activeLayer && activeLayer.id === "ndvi") {
        paintPixel(d, d3.select(this));
        event.preventDefault();
        event.stopPropagation();
      }
    })
    .on("mouseleave", function (event, d) {
      d3.select(this).attr("stroke", null);
      tooltip.style("opacity", 0);

      document.dispatchEvent(new CustomEvent("wardHover", {
        detail: {
          city: cityName,
          wardId: null,
          ward: null
        }
      }));
    });

  // Title on the SVG for context (optional, small)
  // svg.append("text")
  //   .attr("x", width / 2)
  //   .attr("y", 20)
  //   .attr("text-anchor", "middle")
  //   .attr("font-size", 14)
  //   .text(`${cityName}: grid map`);

  // Optional callback & broadcast
  if (typeof onReady === "function") {
    onReady({ meta, wardMeta, layerStates });
  }

  document.dispatchEvent(new CustomEvent("gridLoaded", {
    detail: {
      city: cityName,
      meta,
      wards: wardMeta ? wardMeta.wards : null,
      layers: layerStates
    }
  }));

  // -------------------------------------------------------
  // NEW: expose a city-level controller
  // -------------------------------------------------------
  const controller = {
    /**
     * Change active layer by id, e.g. "ndvi", "lst_day", "lst_night", "lc".
     */
    setLayer(id, { animate = true, fadeInBackground = false } = {}) {
      const next = layerStates.find(l => l.id === id);
      if (!next) return;
      activeLayer = next;
      activeLayerId = next.id;
      //sessionActiveLayerId = next.id;
      updateLayer(animate, fadeInBackground);
    },

    /**
     * Set temperature unit for all temperature-like displays (C or F).
     */
    setTempUnit(unit) {
      if (unit !== "C" && unit !== "F") return;
      tempUnit = unit;
      updateUnitButtons();
      updateLayer(false);
      updateSimSummary();
    },

    /**
     * Show/hide temp unit toggle pill.
     */
    showUnitToggle(show) {
      if (unitControls) {
        unitControls.style("display", show ? "flex" : "none");
      }
    },

    /**
     * Show/hide correlation panel.
     */
    showCorrPanel(show) {
      if (corrPanel) {
        corrPanel.style("display", show ? "block" : "none");
      }
    },

    /**
     * Show/hide NDVI brush controls.
     * (We always created them when enableNdviPainting=true; this just toggles visibility.)
     */
    showBrushControls(show) {
      const brush = container.select(".ndvi-brush-controls");
      if (!brush.empty()) {
        brush.style("display", show ? "block" : "none");
      }
    },

    /**
     * Show/hide greenness simulator summary box.
     */
    showSimSummary(show) {
      const box = container.select(".ndvi-sim-summary");
      if (!box.empty()) {
        box.style("display", show ? "block" : "none");
      }
    },

    /**
     * Get current city-level state (for scrolly scenes to read if needed).
     */
    getState() {
      return {
        cityName,
        subunit,
        activeLayerId,
        tempUnit,
        bivariate,
        enableNdviPainting
      };
    },

    /**
     * Tear down this map (used when switching bivariate mode or fully destroying).
     */
    destroy() {
      tooltip.remove();
      container.selectAll("*").remove();
    }
  };

  broadcastWardStats();

  return controller;
}

// ------------------------------------------------------------------
// Multi-city wrapper: same map component, city toggle on top
// ------------------------------------------------------------------
export async function createMultiCityGridMap(config) {
  const {
    containerId,
    cityConfigs,            // [{ id, label, gridPath, wardStatsPath, cityName, subunit, layers, ... }]
    defaultCityId = null,
    bivariate = false,      // initial bivariate mode
    bivariateVars = null,   // { var1: "ndvi", var2: "lst_day" }
    enableNdviPainting = false
  } = config;

  if (!cityConfigs || !cityConfigs.length) {
    console.error("createMultiCityGridMap: no cityConfigs provided");
    return null;
  }

  const container = d3.select(containerId);
  const node = container.node();
  const width = node.clientWidth;
  const height = node.clientHeight;

  // Fallbacks so we never go negative / zero
  if (!height || height <= 0) {
    height = window.innerHeight || 800;  // reasonable default in scrolly layout
  }

  // Clear wrapper container
  container.selectAll("*").remove();

  // -------------------------------------------------------
  // Layout: controls row + inner map container
  // -------------------------------------------------------
  const controlsWrapper = container.append("div")
    .attr("class", "multi-city-controls-wrapper")
    .style("display", "flex")
    .style("justify-content", "space-between")
    .style("align-items", "center")
    .style("margin-bottom", "6px");

  const cityToggleControls = controlsWrapper.append("div")
    .attr("class", "city-toggle-controls")
    .style("display", "flex")
    .style("gap", "8px")
    .style("align-items", "center")
    .style("font-size", "13px");

  cityToggleControls.append("span").text("City:");

  const innerId = containerId.replace("#", "") + "-inner";
  const innerSelector = "#" + innerId;

  const inner = container.append("div")
    .attr("id", innerId)
    .style("position", "relative")
    .style("width", "100%")
    .style("height", height + "px");

  // City image + captions you were updating before
  const cityImages = {
    "tokyo": "images/tokyo_wards.png",
    "london": "images/london_boroughs.jpg",
    "nyc": "images/new_york_city_boroughs.jpg",
    "san-diego": "images/san_diego_county.png",
    "sandiego": "images/san_diego_county.png"
  };

  const cityCaptions = {
    "tokyo": "Map of Tokyo Wards",
    "london": "Map of London Boroughs",
    "nyc": "Map of New York City Boroughs",
    "san-diego": "Map of San Diego County",
    "sandiego": "Map of San Diego County"
  };

  let currentCityId = defaultCityId || cityConfigs[0].id;
  let currentCityController = null;
  let bivariateMode = !!bivariate;
  let currentBivariateVars = bivariateVars || null;

  const cityButtons = cityToggleControls.selectAll("button")
    .data(cityConfigs, d => d.id)
    .enter()
    .append("button")
    .text(d => d.label || d.cityName || d.id)
    .style("border", "1px solid #ccc")
    .style("padding", "2px 6px")
    .style("border-radius", "3px")
    .style("cursor", "pointer");

  function updateCityButtonStyles() {
    cityButtons
      .style("background", d => d.id === currentCityId ? "#333" : "#fff")
      .style("color", d => d.id === currentCityId ? "#fff" : "#333");
  }

  async function renderCurrentCity(enablelc = false) {
    const cityConf = cityConfigs.find(c => c.id === currentCityId);
    if (!cityConf) return;

    // Tear down old city map
    if (currentCityController) {
      currentCityController.destroy();
      currentCityController = null;
    }

    // Update the hook image/caption if present
    const imgElement = document.getElementById("cityImage");
    const captionElement = document.getElementById("cityImageCaption");
    const imagePath = cityImages[currentCityId];
    if (imgElement && imagePath) {
      imgElement.src = imagePath;
      imgElement.alt = cityCaptions[currentCityId] || "City Map";
    }
    if (captionElement) {
      captionElement.textContent = cityCaptions[currentCityId] || "City Map";
    }

    // Build the city grid map and capture its controller
    currentCityController = await createCityGridMap({
      containerId: innerSelector,
      gridPath: cityConf.gridPath,
      wardStatsPath: cityConf.wardStatsPath,
      cityName: cityConf.cityName || cityConf.label || cityConf.id,
      subunit: cityConf.subunit,
      layers: cityConf.layers,
      showLayerToggle: cityConf.showLayerToggle ?? true,
      defaultActiveId: cityConf.defaultActiveId,
      tooltipFormatter: cityConf.tooltipFormatter,
      onReady: cityConf.onReady,
      isInitialRender: true,
      bivariate: bivariateMode,
      bivariateVars: currentBivariateVars,
      enableNdviPainting: enableNdviPainting && (cityConf.enableNdviPainting ?? true),
      enablelc: enablelc
    });

    updateCityButtonStyles();
    return currentCityController;
  }

  cityButtons.on("click", async (event, d) => {
    if (d.id === currentCityId) return;
    currentCityId = d.id;
    await renderCurrentCity();
  });

  updateCityButtonStyles();
  await renderCurrentCity();

  // -------------------------------------------------------
  // Return high-level controller for scrolly to drive
  // -------------------------------------------------------
  const mapController = {
    /**
     * Switch active city (Tokyo, London, etc.).
     */
    async setCity(id) {
      if (id === currentCityId) return;
      if (!cityConfigs.find(c => c.id === id)) return;
      currentCityId = id;
      await renderCurrentCity();
    },

    /**
     * Change active layer in the current city, e.g. "lst_night".
     */
    setLayer(id, opts = {}) {
      if (!currentCityController) return;
      currentCityController.setLayer(id, opts);
    },

    /**
     * Turn bivariate mode on/off.
     * This re-renders the current city with the new mode.
     */
    async setBivariate(on, vars) {
      const newMode = !!on;
      const modeChanged = bivariateMode !== newMode;
      
      bivariateMode = newMode;
      if (vars) currentBivariateVars = vars;
      
      // Only re-render if the mode actually changed
      if (modeChanged) {
        await renderCurrentCity();
      }
    },

    async setlcBorder() {
        renderCurrentCity(true);
    },

    /**
     * Set temp unit (delegates to city controller).
     */
    setTempUnit(unit) {
      if (!currentCityController) return;
      currentCityController.setTempUnit(unit);
    },

    /**
     * Show/hide fine-grained controls inside the current city map.
     */
    setControlsVisibility(opts = {}) {
      const {
        showLayerToggle,
        showUnitToggle,
        showCorrPanel,
        showBrushControls,
        showSimSummary,
        showCityToggle
      } = opts;

      if (typeof showCityToggle === "boolean") {
        cityToggleControls.style("display", showCityToggle ? "flex" : "none");
      }

      if (!currentCityController) return;

      if (typeof showUnitToggle === "boolean") {
        currentCityController.showUnitToggle(showUnitToggle);
      }
      if (typeof showCorrPanel === "boolean") {
        currentCityController.showCorrPanel(showCorrPanel);
      }
      if (typeof showBrushControls === "boolean") {
        currentCityController.showBrushControls(showBrushControls);
      }
      if (typeof showSimSummary === "boolean") {
        currentCityController.showSimSummary(showSimSummary);
      }

      // NOTE: layer toggle buttons live inside createCityGridMap and currently
      // are always built if showLayerToggle=true. If you want to hide the
      // entire layer toggle row, you can add a class selector and style toggle
      // there later (or we can extend the city controller further).
      // For now we leave showLayerToggle to your existing per-city config.
    },

    /**
     * Current high-level state (for debugging or subtle transitions).
     */
    getState() {
      return {
        currentCityId,
        bivariate: bivariateMode,
        bivariateVars: currentBivariateVars,
        cityState: currentCityController ? currentCityController.getState() : null
      };
    },

    /**
     * Fully destroy the multi-city wrapper and current city map.
     */
    destroy() {
      if (currentCityController) currentCityController.destroy();
      container.selectAll("*").remove();
    }
  };

  return mapController;
}

