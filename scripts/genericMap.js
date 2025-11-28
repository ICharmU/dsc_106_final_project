async function createCityGridMap(config) {
  const {
    containerId,
    gridPath,
    wardStatsPath = null,
    cityName = "City",

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
  //   label: "NDVI (greenness)",
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

    return {
      ...def,
      values: vals,
      min: minVal,
      max: maxVal
    };
  }).filter(Boolean);

  if (!layerStates.length) {
    console.error("No valid layers for grid map:", gridPath);
    return;
  }

  let activeLayerId = defaultActiveId || layerStates[0].id;

  // ---------- 3. Build pixel objects ----------
  const pixels = new Array(rasterWidth * rasterHeight);
  const [minLon, minLat, maxLon, maxLat] = bbox;

  const cellWidth  = width / rasterWidth;
  const cellHeight = height / rasterHeight;

  for (let idx = 0; idx < pixels.length; idx++) {
    const row = Math.floor(idx / rasterWidth);
    const col = idx % rasterWidth;

    const lon = minLon + (col + 0.5) * (maxLon - minLon) / rasterWidth;
    const lat = minLat + (row + 0.5) * (maxLat - minLat) / rasterHeight;

    const wardId = wardIds[idx] || 0;

    pixels[idx] = { idx, row, col, lon, lat, wardId };
  }

  // ---------- 4. SVG, zoom root, shadow filter ----------
  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("display", "block")
    .style("shape-rendering", "crispEdges");

  const rootG = svg.append("g").attr("class", "grid-root");

  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .translateExtent([[0, 0], [width, height]])
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

  // ---------- 5. Pixel grid (draw once) ----------
  const pixelG = rootG.append("g").attr("class", "grid-pixels");

  const rects = pixelG.selectAll("rect")
    .data(pixels)
    .enter()
    .append("rect")
    .attr("x", d => d.col * cellWidth)
    .attr("y", d => d.row * cellHeight)
    .attr("width", cellWidth + 0.01)
    .attr("height", cellHeight + 0.01);

  // ---------- 6. Ward borders (pixel-aligned) ----------
  const borderG = rootG.append("g")
    .attr("class", "grid-ward-borders")
    .attr("stroke", "#111")
    .attr("stroke-width", 0.8)
    .attr("fill", "none")
    .attr("pointer-events", "none")
    .attr("filter", "url(#wardShadowGrid)");

  for (let row = 0; row < rasterHeight; row++) {
    for (let col = 0; col < rasterWidth; col++) {
      const idx = row * rasterWidth + col;
      const wId = wardIds[idx];
      if (!wId) continue;

      // right edge
      if (col < rasterWidth - 1) {
        const wRight = wardIds[idx + 1];
        if (wRight !== wId) {
          const x = (col + 1) * cellWidth;
          const y1 = row * cellHeight;
          const y2 = (row + 1) * cellHeight;
          borderG.append("line")
            .attr("x1", x).attr("y1", y1)
            .attr("x2", x).attr("y2", y2);
        }
      }

      // bottom edge
      if (row < rasterHeight - 1) {
        const wDown = wardIds[idx + rasterWidth];
        if (wDown !== wId) {
          const y = (row + 1) * cellHeight;
          const x1 = col * cellWidth;
          const x2 = (col + 1) * cellWidth;
          borderG.append("line")
            .attr("x1", x1).attr("y1", y)
            .attr("x2", x2).attr("y2", y);
        }
      }
    }
  }

  // ---------- 7. Tooltip ----------
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
  const defaultTooltipFormatter = ({ pixel, ward, activeLayer, allLayers }) => {
    const wardLine = ward
      ? `Ward: ${ward.name || ("ID " + pixel.wardId)}<br>`
      : `<span style="opacity:0.7">Outside city wards</span><br>`;

    let rows = "";
    allLayers.forEach(layer => {
      const v = layer.values[pixel.idx];
      if (v == null || !Number.isFinite(v)) return;
      const active = (layer.id === activeLayer.id);
      rows += `<span style="color:${active ? "#fff" : "#ccc"}">` +
        `${layer.label}: ${v.toFixed(2)}${layer.unit ? " " + layer.unit : ""}` +
        `</span><br>`;
    });

    return (
      `<strong>${cityName}</strong><br>` +
      wardLine +
      rows +
      `Lon: ${pixel.lon.toFixed(3)}, Lat: ${pixel.lat.toFixed(3)}`
    );
  };

  const tooltipFn = tooltipFormatter || defaultTooltipFormatter;

  // ---------- 8. Legend ----------
  const legendWidth  = 210;
  const legendHeight = 10;
  const legendMargin = 16;

  const legendSvg = container.append("svg")
    .attr("width", legendWidth)
    .attr("height", legendHeight + 36)
    .style("position", "absolute")
    .style("left", legendMargin + "px")
    .style("bottom", legendMargin + "px");

  const legendDefs = legendSvg.append("defs");
  const gradient = legendDefs.append("linearGradient")
    .attr("id", "grid-layer-gradient")
    .attr("x1", "0%").attr("x2", "100%")
    .attr("y1", "0%").attr("y2", "0%");

  const legendRect = legendSvg.append("rect")
    .attr("x", 0)
    .attr("y", 16)
    .attr("width", legendWidth)
    .attr("height", legendHeight);

  const legendLabel = legendSvg.append("text")
    .attr("x", legendWidth / 2)
    .attr("y", 12)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", "#333");

  const legendMinText = legendSvg.append("text")
    .attr("x", 0)
    .attr("y", legendHeight + 32)
    .attr("font-size", 11)
    .attr("fill", "#333");

  const legendMaxText = legendSvg.append("text")
    .attr("x", legendWidth)
    .attr("y", legendHeight + 32)
    .attr("font-size", 11)
    .attr("fill", "#333")
    .attr("text-anchor", "end");

  // ---------- 9. Layer toggle buttons ----------
  let activeLayer = layerStates.find(l => l.id === activeLayerId) || layerStates[0];
  activeLayerId = activeLayer.id;

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

  // ---------- 10. Apply active layer (colors + legend) ----------
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
        if (v == null || !Number.isFinite(v)) return "transparent";
        if (!d.wardId) {
          const c = d3.color(colorScale(v));
          c.opacity = 0.30;
          return c;
        }
        return colorScale(v);
      })
      .attr("fill-opacity", d => d.wardId ? 1.0 : 1.0);

    // Legend gradient
    gradient.selectAll("stop").remove();
    const stops = 20;
    for (let i = 0; i <= stops; i++) {
      const t = i / stops;
      const v = activeLayer.min + t * (activeLayer.max - activeLayer.min);
      gradient.append("stop")
        .attr("offset", (t * 100) + "%")
        .attr("stop-color", colorScale(v));
    }

    legendRect.attr("fill", "url(#grid-layer-gradient)");
    legendLabel.text(activeLayer.label);
    legendMinText.text(
      activeLayer.min.toFixed(1) + (activeLayer.unit ? " " + activeLayer.unit : "")
    );
    legendMaxText.text(
      activeLayer.max.toFixed(1) + (activeLayer.unit ? " " + activeLayer.unit : "")
    );

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

  // ---------- 11. Pixel hover (tooltips + wardHover event) ----------
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
        allLayers: layerStates
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
  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("font-size", 14)
    .text(`${cityName}: grid map`);

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

    await createCityGridMap({
      containerId: innerSelector,
      gridPath: cityConf.gridPath,
      wardStatsPath: cityConf.wardStatsPath,
      cityName: cityConf.cityName || cityConf.label || cityConf.id,
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
//       label: "NDVI (greenness)",
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
          label: "NDVI (greenness)",
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
          label: "NDVI (greenness)",
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
          label: "NDVI (greenness)",
          unit: "",
          palette: d3.interpolateYlGn
        }
      ],
      showLayerToggle: false
    },
    {
      id: "san-diego",
      label: "San Diego",
      gridPath: "data/san-diego/sandiego_grid.json",
      wardStatsPath: "data/san-diego/sandiego_boroughs.json",
      cityName: "San Diego",
      subunit: "Borough",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "NDVI (greenness)",
          unit: "",
          palette: d3.interpolateYlGn
        }
      ],
      showLayerToggle: false
    }
  ]
}).catch(err => console.error("Error rendering multi-city NDVI map:", err));

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
//       label: "NDVI (greenness)",
//       unit: "",
//       palette: d3.interpolateYlGn
//     },
//     {
//       id: "lst_day",
//       valueKey: "lst_day_C",
//       minKey: "lst_day_min",
//       maxKey: "lst_day_max",
//       label: "Daytime LST (°C)",
//       unit: "°C",
//       palette: d3.interpolateInferno
//     },
//     {
//       id: "lst_night",
//       valueKey: "lst_night_C",
//       minKey: "lst_night_min",
//       maxKey: "lst_night_max",
//       label: "Nighttime LST (°C)",
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
          label: "NDVI (greenness)",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime LST (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime LST (°C)",
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
          label: "NDVI (greenness)",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime LST (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime LST (°C)",
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
      subunit: "Ward",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "NDVI (greenness)",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime LST (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime LST (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    },
    {
      id: "sandiego",
      label: "San Diego",
      gridPath: "data/san-diego/sandiego_grid.json",
      wardStatsPath: "data/san-diego/sandiego_boroughs.json",
      cityName: "San Diego",
      subunit: "Ward",
      layers: [
        {
          id: "ndvi",
          valueKey: "ndvi",
          minKey: "ndvi_min",
          maxKey: "ndvi_max",
          label: "NDVI (greenness)",
          unit: "",
          palette: d3.interpolateYlGn
        },
        {
          id: "lst_day",
          valueKey: "lst_day_C",
          minKey: "lst_day_min",
          maxKey: "lst_day_max",
          label: "Daytime LST (°C)",
          unit: "°C",
          palette: d3.interpolateInferno
        },
        {
          id: "lst_night",
          valueKey: "lst_night_C",
          minKey: "lst_night_min",
          maxKey: "lst_night_max",
          label: "Nighttime LST (°C)",
          unit: "°C",
          palette: d3.interpolateMagma
        }
      ],
      showLayerToggle: true
    }
  ],
  defaultCityId: "tokyo"
}).catch(err => console.error("Error rendering multi-city NDVI/LST map:", err));