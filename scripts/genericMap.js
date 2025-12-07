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
  'Various Forests': { values: [1, 2, 3, 4, 5], color: '#1c861cff' },      
  'Grasslands': { values: [6, 7, 8, 9, 10], color: '#6ab51aff' },          
  'Wetlands': { values: [11], color: '#46987aff' },                       
  'Croplands': { values: [12, 14], color: '#FFD700' },                 
  'Urban': { values: [13], color: '#808080' },                          
  'Water/Snow/Ice': { values: [17], color: '#246bb2ff' },    // Barren and Water Bodies were swapped during preprocessing
  'Barren': { values: [15, 16], color: '#de8124ff' },           
};

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
    isInitialRender = false  // flag for city switch transitions
  } = config;

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

  if (!rasterWidth || !rasterHeight || !bbox) {
    console.error("Grid JSON missing width/height/bbox:", gridPath);
    return;
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
    const vals = meta[def.valueKey];
    if (!vals || vals.length !== rasterWidth * rasterHeight) {
      console.warn(
        `Layer "${def.id}" missing or wrong length in`,
        gridPath,
        `(key=${def.valueKey})`
      );
      return null;
    }

    let minVal, maxVal;
    if (def.domain && def.domain.length === 2) {
      [minVal, maxVal] = def.domain;
    } else {
      const explicitMin = def.minKey ? meta[def.minKey] : undefined;
      const explicitMax = def.maxKey ? meta[def.maxKey] : undefined;
      minVal = (typeof explicitMin === "number")
        ? explicitMin
        : d3.min(vals);
      maxVal = (typeof explicitMax === "number")
        ? explicitMax
        : d3.max(vals);
    }

    const layerState = {
      ...def,
      values: vals,
      min: minVal,
      max: maxVal
    };

    // Add categories for land cover layers
    if (def.id === "lc" || def.label === "Land Cover Type") {
      layerState.categories = getLandCoverCategories(minVal, maxVal, def.palette);
    }

    return layerState;
  }).filter(Boolean);

  if (!layerStates.length) {
    console.error("No valid layers for grid map:", gridPath);
    return;
  }

  // Use session memory for layer selection if available, otherwise use config default
  let activeLayerId = sessionActiveLayerId || defaultActiveId || layerStates[0].id;

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

    pixels[idx] = { idx, row, col, lon, lat, wardId };
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

  // ---------- 5. SVG, zoom root, shadow filter ----------
  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("display", "block")
    .style("shape-rendering", "crispEdges");

  const rootG = svg.append("g").attr("class", "grid-root");

  const zoom = d3.zoom()
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
    .attr("height", cellHeight + 0.01);

  const foregroundRects = foregroundG.selectAll("rect")
    .data(foregroundPixels)
    .enter()
    .append("rect")
    .attr("x", d => xOffset + d.col * cellWidth)
    .attr("y", d => yOffset + d.row * cellHeight)
    .attr("width", cellWidth + 0.01)
    .attr("height", cellHeight + 0.01);
  
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

  // Generate borders based on the pixels' assigned wardIds
  // For flipped cities, pixels have already been assigned flipped wardIds
  // So we compare neighbors in the normal grid and draw at normal positions
  for (let row = 0; row < rasterHeight; row++) {
    for (let col = 0; col < rasterWidth; col++) {
      const idx = row * rasterWidth + col;
      const wId = pixels[idx].wardId;
      if (!wId) continue;

      // right edge - compare with neighbor to the right
      if (col < rasterWidth - 1) {
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
      if (row < rasterHeight - 1) {
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
      let val = `${v.toFixed(2)}${layer.unit ? " " + layer.unit : ""}`;
      if (layer.id === "lc") {
        const lcCode = Math.round(v);
        val = landCoverTypes[lcCode] || `Class ${lcCode}`;
      }
      rows += `<span style="color:${active ? "#fff" : "#ccc"}">` +
        `${layer.label}: `+ val + `</span><br>`;
    });

    return (
      `<strong>${cityName}</strong><br>` +
      wardLine +
      rows +
      `Lon: ${pixel.lon.toFixed(3)}, Lat: ${pixel.lat.toFixed(3)}`
    );
  };

  const tooltipFn = tooltipFormatter || defaultTooltipFormatter;

  // ---------- 9. Legend ----------
  const legendMargin = 16;
  const safeContainerId = containerId.replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `grid-layer-gradient-${safeContainerId}`;

  // Position legend: bivariate centered between wall and map, univariate 10px left of map
  const legendLeft = bivariate ? xOffset / 2 : xOffset - 10;
  const legendTransform = bivariate ? "translate(-50%, -50%)" : "translate(-100%, -50%)";

  // Create a container div for the legend that can be rebuilt as needed
  const legendContainer = container.append("div")
    .attr("class", "legend-container")
    .style("position", "absolute")
    .style("left", `${legendLeft}px`)
    .style("top", "50%")
    .style("transform", legendTransform)
    .style("padding", "0px")
    .style("max-height", "300px")
    .style("overflow-y", "auto");

  // ---------- 10. Layer toggle buttons ----------
  let activeLayer = layerStates.find(l => l.id === activeLayerId) || layerStates[0];
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
      const centerOffset = svgSize / 2;
      
      // SVG size to accommodate rotation and text labels
      const legendSvg = legendContainer.append("svg")
        .attr("width", svgSize)
        .attr("height", svgSize);
      
      // Create a group for the rotated legend
      const legendGroup = legendSvg.append("g")
        .attr("transform", `translate(${centerOffset}, ${centerOffset}) rotate(-45)`);
      
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
      
      const centerX = svgSize / 2;
      const centerY = svgSize / 2;
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

      legendSvg.append("text")
        .attr("x", textWidth - 5)
        .attr("y", legendHeight)
        .attr("dy", "-0.5em")
        .attr("font-size", 10)
        .attr("fill", "#333")
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .text((activeLayer.min.toFixed(1) === "-0.0" ? "0.0" : activeLayer.min.toFixed(1)) + (activeLayer.unit ? " " + activeLayer.unit : ""));

      legendSvg.append("text")
        .attr("x", textWidth - 5)
        .attr("y", 0)
        .attr("dy", "0.5em")
        .attr("font-size", 10)
        .attr("fill", "#333")
        .attr("text-anchor", "end")
        .attr("dominant-baseline", "middle")
        .text((activeLayer.max.toFixed(1) === "-0.0" ? "0.0" : activeLayer.max.toFixed(1)) + (activeLayer.unit ? " " + activeLayer.unit : ""));
    }

    // Broadcast layer change so other components (like ward comparison) can react
    document.dispatchEvent(new CustomEvent("gridLayerChanged", {
      detail: {
        city: cityName,
        layerId: activeLayer.id,
        layer: activeLayer
      }
    }));
  }

  updateLayer(false, isInitialRender); // initial paint

  // ---------- 12. Pixel hover (tooltips + wardHover event) ----------
  rects
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
        subunit
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
    })
    .on("mousemove", function (event) {
      tooltip
        .style("left", (event.pageX + 12) + "px")
        .style("top",  (event.pageY - 28) + "px");
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
}

// ------------------------------------------------------------------
// Multi-city wrapper: same map component, city toggle on top
// ------------------------------------------------------------------
async function createMultiCityGridMap(config) {
  const {
    containerId,
    cityConfigs,           // [{ id, label, gridPath, wardStatsPath, cityName, layers, ... }]
    defaultCityId = null,
    bivariate = false,     // enable bivariate mode
    bivariateVars = null   // { var1: "ndvi", var2: "lst_day" }
  } = config;

  if (!cityConfigs || !cityConfigs.length) {
    console.error("createMultiCityGridMap: no cityConfigs provided");
    return;
  }

  const container = d3.select(containerId);
  const node = container.node();
  const width = node.clientWidth;
  const height = node.clientHeight;

  // Clear everything in the outer .viz container
  container.selectAll("*").remove();

  // --- Wrapper for controls row to position city controls left and toggle right ---
  const controlsWrapper = container.append("div")
    .style("display", "flex")
    .style("justify-content", "space-between")
    .style("align-items", "center")
    .style("margin-bottom", "6px");

  // --- controls row ("City: [Tokyo] [London] ...") ---
  const controls = controlsWrapper.append("div")
    .attr("class", "city-toggle-controls")
    .style("display", "flex")
    .style("gap", "8px")
    .style("align-items", "center")
    .style("font-size", "13px");

  controls.append("span").text("City:");

  // City image mapping
  const cityImages = {
    "tokyo": "images/tokyo_wards.png",
    "london": "images/london_boroughs.jpg",
    "nyc": "images/new_york_city_boroughs.jpg",
    "san-diego": "images/san_diego_county.png",
    "sandiego": "images/san_diego_county.png"
  };

  // City caption mapping
  const cityCaptions = {
    "tokyo": "Map of Tokyo Wards",
    "london": "Map of London Boroughs",
    "nyc": "Map of New York City Boroughs",
    "san-diego": "Map of San Diego County",
    "sandiego": "Map of San Diego County"
  };

  // Inner div where the actual grid map will live
  const innerId = containerId.replace("#", "") + "-inner";
  const innerSelector = "#" + innerId;

  const inner = container.append("div")
    .attr("id", innerId)
    .style("position", "relative")
    .style("width", "100%")
    .style("height", (height - 40) + "px"); // leave room for controls

  let currentCityId = defaultCityId || cityConfigs[0].id;

  const buttons = controls.selectAll("button")
    .data(cityConfigs, d => d.id)
    .enter()
    .append("button")
    .text(d => d.label || d.cityName || d.id)
    .style("border", "1px solid #ccc")
    .style("padding", "2px 6px")
    .style("border-radius", "3px")
    .style("cursor", "pointer");

  // --- Toggle button on the right side ---
  const toggleContainer = controlsWrapper.append("div")
    .style("display", "flex")
    .style("gap", "8px")
    .style("align-items", "center");

  // Add appropriate toggle button based on bivariate mode
  const toggleButton = toggleContainer.append("button")
    .text(bivariate ? "Toggle Univariate" : "Toggle Multivariate")
    .style("border", "1px solid #666")
    .style("padding", "2px 8px")
    .style("border-radius", "3px")
    .style("cursor", "pointer")
    .style("background", "#f0f0f0")
    .style("color", "#333")
    .style("font-size", "13px")
    .on("click", function() {
      // Toggle between bivariate and univariate modes
      // Rebuild the entire visualization with opposite mode
      createMultiCityGridMap({
        ...config,
        defaultCityId: currentCityId,
        bivariate: !bivariate
      });
    });

  function updateButtonStyles() {
    buttons
      .style("background", d => d.id === currentCityId ? "#333" : "#fff")
      .style("color", d => d.id === currentCityId ? "#fff" : "#333");
  }

  async function renderCurrentCity() {
    const cityConf = cityConfigs.find(c => c.id === currentCityId);
    if (!cityConf) return;

    // Update the existing HTML city image
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

    await createCityGridMap({
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
      bivariate: bivariate,
      bivariateVars: bivariateVars
    });
  }

  buttons.on("click", async (event, d) => {
    if (d.id === currentCityId) return;
    currentCityId = d.id;
    updateButtonStyles();
    await renderCurrentCity();
  });

  updateButtonStyles();
  await renderCurrentCity();
}

// ------------------------------------------------------------------
// 2.2 Concrete instantiations for Tokyo
// ------------------------------------------------------------------

// (A) Greenness section: NDVI-only, no toggle
// createCityGridMap({
//   containerId: "#ndviMap",
//   gridPath: "data/tokyo/tokyo_grid.json",
//   wardStatsPath: "data/tokyo/tokyo_wards.json",
//   cityName: "Tokyo",

//   layers: [
//     {
//       id: "ndvi",
//       valueKey: "ndvi",
//       minKey: "ndvi_min",
//       maxKey: "ndvi_max",
//       label: "Greenness (Vegetation)",
//       unit: "",
//       palette: d3.interpolateYlGn
//     }
//   ],
//   showLayerToggle: false
// }).catch(err => console.error("Error rendering NDVI map:", err));

// (A) Greenness section: NDVI-only, but toggle between Tokyo & London
createMultiCityGridMap({
  containerId: "#ndviMap",
  defaultCityId: "tokyo",
  cityConfigs: [
    {
      id: "tokyo",
      label: "Tokyo",
      gridPath: "data/tokyo/tokyo_grid.json",
      wardStatsPath: "data/tokyo/tokyo_wards.json",
      cityName: "Tokyo",
      subunit: "Ward",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Greenness (Vegetation)",
          unit: "",
          palette: d3.interpolateYlGn
        }
      ],
      showLayerToggle: false
    },
    {
      id: "london",
      label: "London",
      gridPath: "data/london/london_grid.json",
      wardStatsPath: "data/london/london_boroughs.json",
      cityName: "London",
      subunit: "Borough",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Greenness (Vegetation)",
          unit: "",
          palette: d3.interpolateYlGn
        }
      ],
      showLayerToggle: false
    },
    {
      id: "nyc",
      label: "New York City",
      gridPath: "data/nyc/nyc_grid.json",
      wardStatsPath: "data/nyc/nyc_boroughs.json",
      cityName: "New York City",
      subunit: "Borough",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Greenness (Vegetation)",
          unit: "",
          palette: d3.interpolateYlGn
        }
      ],
      showLayerToggle: false
    },
    {
      id: "san-diego",
      label: "San Diego County",
      gridPath: "data/san-diego/sandiego_grid.json",
      wardStatsPath: "data/san-diego/sandiego_boroughs.json",
      cityName: "San Diego County",
      subunit: "City",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Greenness (Vegetation)",
          unit: "",
          palette: d3.interpolateYlGn
        }
      ],
      showLayerToggle: false
    }
  ]
}).catch(err => console.error("Error rendering multi-city NDVI map:", err));

// ------------------------------------------------------------------
// Heat section: LST-only (day vs night) per city
// ------------------------------------------------------------------
createMultiCityGridMap({
  containerId: "#lstMap",
  defaultCityId: "tokyo",
  cityConfigs: [
    {
      id: "tokyo",
      label: "Tokyo",
      gridPath: "data/tokyo/tokyo_grid.json",
      wardStatsPath: "data/tokyo/tokyo_wards.json",
      cityName: "Tokyo",
      subunit: "Ward",
      layers: [
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "london",
      label: "London",
      gridPath: "data/london/london_grid.json",
      wardStatsPath: "data/london/london_boroughs.json",
      cityName: "London",
      subunit: "Borough",
      layers: [
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "nyc",
      label: "New York City",
      gridPath: "data/nyc/nyc_grid.json",
      wardStatsPath: "data/nyc/nyc_boroughs.json",
      cityName: "New York City",
      subunit: "Borough",
      layers: [
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "sandiego",
      label: "San Diego County",
      gridPath: "data/san-diego/sandiego_grid.json",
      wardStatsPath: "data/san-diego/sandiego_boroughs.json",
      cityName: "San Diego County",
      subunit: "City",
      layers: [
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    }
  ]
}).catch(err => console.error("Error rendering LST-only heat map:", err));

// (B) Greenness vs temperature section: NDVI + LST layers with toggle
// createCityGridMap({
//   containerId: "#ndvi_heatMap",
//   gridPath: "data/tokyo/tokyo_grid.json",
//   wardStatsPath: "data/tokyo/tokyo_wards.json",
//   cityName: "Tokyo",

//   layers: [
//     {
//       id: "ndvi",
//       valueKey: "ndvi",
//       minKey: "ndvi_min",
//       maxKey: "ndvi_max",
//       label: "Greenness (Vegetation)",
//       unit: "",
//       palette: d3.interpolateYlGn
//     },
//     {
//       id: "lst_day",
//       valueKey: "lst_day_C",
//       minKey: "lst_day_min",
//       maxKey: "lst_day_max",
//       label: "Daytime Temperature (°C)",
//       unit: "°C",
//       palette: d3.interpolateInferno
//     },
//     {
//       id: "lst_night",
//       valueKey: "lst_night_C",
//       minKey: "lst_night_min",
//       maxKey: "lst_night_max",
//       label: "Nighttime Temperature (°C)",
//       unit: "°C",
//       palette: d3.interpolateMagma
//     }
//   ],
//   showLayerToggle: true
//   // You can pass a custom tooltipFormatter here later if you want
// }).catch(err => console.error("Error rendering NDVI/LST map:", err));

// Multi-city greenness vs temperature map (Tokyo <-> London toggle)
createMultiCityGridMap({
  containerId: "#ndvi_heatMap",
  cityConfigs: [
    {
      id: "tokyo",
      label: "Tokyo",
      gridPath: "data/tokyo/tokyo_grid.json",
      wardStatsPath: "data/tokyo/tokyo_wards.json",
      cityName: "Tokyo",
      subunit: "Ward",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Greenness (Vegetation)",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "london",
      label: "London",
      gridPath: "data/london/london_grid.json",
      wardStatsPath: "data/london/london_boroughs.json",
      cityName: "London",
      subunit: "Borough",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Greenness (Vegetation)",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "nyc",
      label: "New York City",
      gridPath: "data/nyc/nyc_grid.json",
      wardStatsPath: "data/nyc/nyc_boroughs.json",
      cityName: "New York City",
      subunit: "Borough",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Greenness (Vegetation)",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "sandiego",
      label: "San Diego County",
      gridPath: "data/san-diego/sandiego_grid.json",
      wardStatsPath: "data/san-diego/sandiego_boroughs.json",
      cityName: "San Diego County",
      subunit: "City",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Greenness (Vegetation)",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    }
  ],
  defaultCityId: "tokyo"
}).catch(err => console.error("Error rendering multi-city NDVI/LST map:", err));

// ------------------------------------------------------------------
// Land Cover vs Temperature map (all cities)
// ------------------------------------------------------------------
createMultiCityGridMap({
  containerId: "#lctMap",
  defaultCityId: "tokyo",
  cityConfigs: [
    {
      id: "tokyo",
      label: "Tokyo",
      gridPath: "data/tokyo/tokyo_grid.json",
      wardStatsPath: "data/tokyo/tokyo_wards.json",
      cityName: "Tokyo",
      subunit: "Ward",
      layers: [
        {
          id: "lc",
          valueKey: "lc",
          minKey: "lc_min",
          maxKey: "lc_max",
          label: "Land Cover Type",
          unit: "",
          palette: d3.interpolateTurbo
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "london",
      label: "London",
      gridPath: "data/london/london_grid.json",
      wardStatsPath: "data/london/london_boroughs.json",
      cityName: "London",
      subunit: "Borough",
      layers: [
        {
          id: "lc",
          valueKey: "lc",
          minKey: "lc_min",
          maxKey: "lc_max",
          label: "Land Cover Type",
          unit: "",
          palette: d3.interpolateTurbo
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "nyc",
      label: "New York City",
      gridPath: "data/nyc/nyc_grid.json",
      wardStatsPath: "data/nyc/nyc_boroughs.json",
      cityName: "New York City",
      subunit: "Borough",
      layers: [
        {
          id: "lc",
          valueKey: "lc",
          minKey: "lc_min",
          maxKey: "lc_max",
          label: "Land Cover Type",
          unit: "",
          palette: d3.interpolateTurbo
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "sandiego",
      label: "San Diego County",
      gridPath: "data/san-diego/sandiego_grid.json",
      wardStatsPath: "data/san-diego/sandiego_boroughs.json",
      cityName: "San Diego County",
      subunit: "City",
      layers: [
        {
          id: "lc",
          valueKey: "lc",
          minKey: "lc_min",
          maxKey: "lc_max",
          label: "Land Cover Type",
          unit: "",
          palette: d3.interpolateTurbo
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    }
  ]
}).catch(err => console.error("Error rendering land cover vs temperature map:", err));

// ------------------------------------------------------------------
// Heat Inequality Map (all cities, including land cover)
// Now supports toggling between univariate and bivariate modes
// ------------------------------------------------------------------
createMultiCityGridMap({
  containerId: "#heatInequalityMap",
  bivariate: false,  // Start in univariate mode (set to true to start in bivariate)
  bivariateVars: { var1: "ndvi", var2: "lst_day" },
  cityConfigs: [
    {
      id: "tokyo",
      label: "Tokyo",
      gridPath: "data/tokyo/tokyo_grid.json",
      wardStatsPath: "data/tokyo/tokyo_wards.json",
      cityName: "Tokyo",
      subunit: "Ward",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Vegetation",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        },
        {
          id: "lc",
          valueKey: "lc",
          minKey: "lc_min",
          maxKey: "lc_max",
          label: "Land Cover Type",
          unit: "",
          palette: d3.interpolateTurbo
        }
      ],
      showLayerToggle: true
    },
    {
      id: "london",
      label: "London",
      gridPath: "data/london/london_grid.json",
      wardStatsPath: "data/london/london_boroughs.json",
      cityName: "London",
      subunit: "Borough",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Vegetation",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        },
        {
          id: "lc",
          valueKey: "lc",
          minKey: "lc_min",
          maxKey: "lc_max",
          label: "Land Cover Type",
          unit: "",
          palette: d3.interpolateTurbo
        }
      ],
      showLayerToggle: true
    },
    {
      id: "nyc",
      label: "New York City",
      gridPath: "data/nyc/nyc_grid.json",
      wardStatsPath: "data/nyc/nyc_boroughs.json",
      cityName: "New York City",
      subunit: "Borough",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Vegetation",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        },
        {
          id: "lc",
          valueKey: "lc",
          minKey: "lc_min",
          maxKey: "lc_max",
          label: "Land Cover Type",
          unit: "",
          palette: d3.interpolateTurbo
        }
      ],
      showLayerToggle: true
    },
    {
      id: "sandiego",
      label: "San Diego County",
      gridPath: "data/san-diego/sandiego_grid.json",
      wardStatsPath: "data/san-diego/sandiego_boroughs.json",
      cityName: "San Diego County",
      subunit: "City",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "Vegetation",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime Temperature (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        },
        {
          id: "lc",
          valueKey: "lc",
          minKey: "lc_min",
          maxKey: "lc_max",
          label: "Land Cover Type",
          unit: "",
          palette: d3.interpolateTurbo
        }
      ],
      showLayerToggle: true
    }
  ],
  defaultCityId: "london"
}).catch(err => console.error("Error rendering heat inequality map:", err));