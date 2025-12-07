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
    16: 'Barren',
    17: 'Water Bodies'
};

// Generate land cover categories for legend
function getLandCoverCategories(min, max, palette) {
  const categories = [];
  for (let value = Math.ceil(min); value <= Math.floor(max); value++) {
    if (landCoverTypes[value] && value > 0) { // Skip "No Data"
      categories.push({
        value: value,
        label: landCoverTypes[value]
      });
    }
  }
  return categories;
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

    tooltipFormatter = null, // optional custom formatter
    onReady = null           // optional callback after draw
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

  const rects = pixelG.selectAll("rect")
    .data(pixels)
    .enter()
    .append("rect")
    .attr("x", d => xOffset + d.col * cellWidth)
    .attr("y", d => yOffset + d.row * cellHeight)
    .attr("width", cellWidth + 0.01)
    .attr("height", cellHeight + 0.01);

  // ---------- 7. Ward borders (pixel-aligned) ----------
  // COMMENTED OUT - showing only background
  // ---------- 7. Ward borders (pixel-aligned) ----------
  const borderG = rootG.append("g")
    .attr("class", "grid-ward-borders")
    .attr("stroke", "#111")
    .attr("stroke-width", 0.8)
    .attr("fill", "none")
    .attr("pointer-events", "none")
    .attr("filter", "url(#wardShadowGrid)");

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

  // Create a container div for the legend that can be rebuilt as needed
  const legendContainer = container.append("div")
    .attr("class", "legend-container")
    .style("position", "absolute")
    .style("left", legendMargin + "px")

    .style("bottom", legendMargin + "px")
    .style("background", "rgba(255,255,255,0.9)")
    .style("padding", "8px")
    .style("border-radius", "4px")
    .style("box-shadow", "0 2px 4px rgba(0,0,0,0.1)")
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
        updateLayer(true); // animate

        buttons
          .style("background", b => b.id === activeLayerId ? "#333" : "#fff")
          .style("color", b => b.id === activeLayerId ? "#fff" : "#333");
      });
  }

  // ---------- 11. Apply active layer (colors + legend) ----------
  function updateLayer(animate = false) {
    if (!activeLayer) return;

    const colorScale = d3.scaleSequential(activeLayer.palette)
      .domain([activeLayer.min, activeLayer.max]);

    const sel = animate
      ? rects.transition().duration(350)
      : rects;

    sel
      .attr("fill", d => {
        const v = activeLayer.values[d.idx];
        const hasValue = v != null && Number.isFinite(v);

        // For cities with vertical flip or Tokyo: distinguish foreground (wardId > 0) from background (wardId = 0)
        if (isTokyo || needsFullVerticalFlip) {
          if (!d.wardId) {
            // Background pixels with adjustable opacity
            if (!hasValue) {
              return "rgba(235,235,235,0.9)"; // No data background = light grey
            }
            const c = d3.color(colorScale(v));
            c.opacity = backgroundOpacity;
            return c;
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

    // Update legend based on whether this is a categorical layer
    legendContainer.selectAll("*").remove();

    if (activeLayer.categories) {
      // Categorical legend (e.g., Land Cover Type)
      const legendTitle = legendContainer.append("div")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("margin-bottom", "6px")
        .style("color", "#333")
        .text(activeLayer.label);

      const categoriesContainer = legendContainer.append("div")
        .style("display", "flex")
        .style("flex-direction", "column")
        .style("gap", "3px");

      activeLayer.categories.forEach(cat => {
        const item = categoriesContainer.append("div")
          .style("display", "flex")
          .style("align-items", "center")
          .style("gap", "6px");

        item.append("div")
          .style("width", "16px")
          .style("height", "16px")
          .style("background-color", colorScale(cat.value))
          .style("border", "1px solid #ccc")
          .style("flex-shrink", "0");

        item.append("div")
          .style("font-size", "10px")
          .style("color", "#333")
          .text(cat.label);
      });
    } else {
      // Continuous legend (existing behavior)
      const legendWidth = 210;
      const legendHeight = 10;

      const legendTitle = legendContainer.append("div")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .style("margin-bottom", "4px")
        .style("color", "#333")
        .style("text-align", "center")
        .text(activeLayer.label);

      const legendSvg = legendContainer.append("svg")
        .attr("width", legendWidth)
        .attr("height", legendHeight + 20);

      const legendDefs = legendSvg.append("defs");
      const gradient = legendDefs.append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%").attr("x2", "100%")
        .attr("y1", "0%").attr("y2", "0%");

      const stops = 20;
      for (let i = 0; i <= stops; i++) {
        const t = i / stops;
        const v = activeLayer.min + t * (activeLayer.max - activeLayer.min);
        gradient.append("stop")
          .attr("offset", (t * 100) + "%")
          .attr("stop-color", colorScale(v));
      }

      legendSvg.append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .attr("fill", `url(#${gradientId})`);

      legendSvg.append("text")
        .attr("x", 0)
        .attr("y", legendHeight + 14)
        .attr("font-size", 10)
        .attr("fill", "#333")
        .text(activeLayer.min.toFixed(1) + (activeLayer.unit ? " " + activeLayer.unit : ""));

      legendSvg.append("text")
        .attr("x", legendWidth)
        .attr("y", legendHeight + 14)
        .attr("font-size", 10)
        .attr("fill", "#333")
        .attr("text-anchor", "end")
        .text(activeLayer.max.toFixed(1) + (activeLayer.unit ? " " + activeLayer.unit : ""));
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

  updateLayer(false); // initial paint

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
    defaultCityId = null
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

  // --- controls row ("City: [Tokyo] [London] ...") ---
  const controls = container.append("div")
    .attr("class", "city-toggle-controls")
    .style("display", "flex")
    .style("gap", "8px")
    .style("align-items", "center")
    .style("margin-bottom", "6px")
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
      onReady: cityConf.onReady
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
// ------------------------------------------------------------------
createMultiCityGridMap({
  containerId: "#heatInequalityMap",
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