async function renderNDVICity(config) {
  const {
    containerId,
    dataPath,         // grid JSON
    wardStatsPath,    // ward stats JSON 
    cityName = "City"
  } = config;

  const container = d3.select(containerId);
  const node = container.node();
  const width = node.clientWidth;
  const height = node.clientHeight;

  container.selectAll("*").remove();

  // Load grid + ward stats
  const gridResp = await fetch(dataPath);
  const meta = await gridResp.json();

  let wardMeta = null;
  if (wardStatsPath) {
    const wardResp = await fetch(wardStatsPath);
    wardMeta = await wardResp.json();
  }

  const rasterWidth = meta.width;
  const rasterHeight = meta.height;
  const bbox = meta.bbox;
  const ndviValues = meta.ndvi;
  const wardIds = meta.ward_ids;
  const dataMin = meta.ndvi_min;
  const dataMax = meta.ndvi_max;

  let ndviMin = dataMin;
  let ndviMax = dataMax;

  if (!isFinite(ndviMin) || !isFinite(ndviMax)) {
    ndviMin = 0.0;
    ndviMax = 0.8;
  }

  const padding = 0.02;
  ndviMin -= padding;
  ndviMax += padding;

  const colorScale = d3.scaleSequential(d3.interpolateYlGn)
    .domain([ndviMin, ndviMax]);

  const cellWidth = width / rasterWidth;
  const cellHeight = height / rasterHeight;

  const wardInfoMap = new Map();
  if (wardMeta && wardMeta.wards) {
    wardMeta.wards.forEach(w => {
      wardInfoMap.set(w.id, w);
    });
  }

  // Build per-pixel objects
  const pixels = new Array(rasterWidth * rasterHeight);

  for (let idx = 0; idx < pixels.length; idx++) {
    const row = Math.floor(idx / rasterWidth);
    const col = idx % rasterWidth;

    const lon = bbox[0] + (col + 0.5) * (bbox[2] - bbox[0]) / rasterWidth;
    const lat = bbox[1] + (row + 0.5) * (bbox[3] - bbox[1]) / rasterHeight;

    const value = ndviValues[idx];
    const wardId = wardIds[idx];

    pixels[idx] = { row, col, lon, lat, value, wardId };
  }

  const svg = container.append("svg")
    .attr("width", width)
    .attr("height", height)
    .style("display", "block")
    .style("shape-rendering", "crispEdges");

  const rootG = svg.append("g").attr("class", "ndvi-root");

  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .translateExtent([[0, 0], [width, height]])
    .on("zoom", (event) => {
      rootG.attr("transform", event.transform);
    });

  svg.call(zoom);

  const defs = svg.append("defs");
  const shadow = defs.append("filter")
    .attr("id", "wardShadow")
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

  // NDVI pixel grid
  const pixelG = rootG.append("g").attr("class", "ndvi-pixels");

  const rects = pixelG.selectAll("rect")
    .data(pixels)
    .enter()
    .append("rect")
    .attr("x", d => d.col * cellWidth)
    .attr("y", d => d.row * cellHeight)
    .attr("width", cellWidth + 0.01)
    .attr("height", cellHeight + 0.01)
    .attr("fill", d => colorScale(d.value))
    .attr("fill-opacity", d => d.wardId ? 1.0 : 0.35);

  // Pixel-perfect ward borders
  const borderG = rootG.append("g")
    .attr("class", "ward-borders")
    .attr("stroke", "#111")
    .attr("stroke-width", 0.8)
    .attr("fill", "none")
    .attr("pointer-events", "none")
    .attr("filter", "url(#wardShadow)");

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

  // Tooltip with ward names
  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "ndvi-tooltip")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("background", "rgba(0,0,0,0.8)")
    .style("color", "#fff")
    .style("padding", "4px 8px")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("opacity", 0);

  rects
    .on("mouseenter", function (event, d) {
      d3.select(this)
        .attr("stroke", "#000")
        .attr("stroke-width", 0.5);

      let wardLine;
      let wardObj = null;

      if (d.wardId && wardInfoMap.has(d.wardId)) {
        wardObj = wardInfoMap.get(d.wardId);
        wardLine = `Ward: ${wardObj.name} (ID: ${d.wardId})<br>`;
      } else if (d.wardId) {
        wardLine = `Ward ID: ${d.wardId}<br>`;
      } else {
        wardLine = `<span style="opacity:0.7">Outside 23 wards</span><br>`;
      }

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${cityName}</strong><br>` +
          wardLine +
          `NDVI: ${d.value.toFixed(3)}<br>` +
          `Lon: ${d.lon.toFixed(3)}, Lat: ${d.lat.toFixed(3)}`
        );

      // Dispatch wardHover event for other components
      if (d.wardId) {
        document.dispatchEvent(new CustomEvent("wardHover", {
          detail: {
            city: cityName,
            wardId: d.wardId,
            ward: wardObj
          }
        }));
      }
    })
    .on("mousemove", function (event) {
      tooltip
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseleave", function (event, d) {
      d3.select(this).attr("stroke", null);
      tooltip.style("opacity", 0);

      // clear wardHover on exit
      document.dispatchEvent(new CustomEvent("wardHover", {
        detail: {
          city: cityName,
          wardId: null,
          ward: null
        }
      }));
    });

  // Legend (numeric low/high)
  const legendWidth = 200;
  const legendHeight = 10;
  const legendMargin = 16;

  const legendSvg = container.append("svg")
    .attr("width", legendWidth)
    .attr("height", legendHeight + 32)
    .style("position", "absolute")
    .style("left", legendMargin + "px")
    .style("bottom", legendMargin + "px");

  const lDefs = legendSvg.append("defs");
  const gradient = lDefs.append("linearGradient")
    .attr("id", "ndvi-gradient")
    .attr("x1", "0%").attr("x2", "100%")
    .attr("y1", "0%").attr("y2", "0%");

  const legendStops = 20;
  for (let i = 0; i <= legendStops; i++) {
    const t = i / legendStops;
    const v = ndviMin + t * (ndviMax - ndviMin);
    gradient.append("stop")
      .attr("offset", (t * 100) + "%")
      .attr("stop-color", colorScale(v));
  }

  legendSvg.append("text")
    .attr("x", legendWidth / 2)
    .attr("y", 10)
    .attr("font-size", 11)
    .attr("fill", "#333")
    .attr("text-anchor", "middle")
    .text("NDVI");

  legendSvg.append("rect")
    .attr("x", 0)
    .attr("y", 14)
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .attr("fill", "url(#ndvi-gradient)");

  legendSvg.append("text")
    .attr("x", 0)
    .attr("y", legendHeight + 28)
    .attr("font-size", 11)
    .attr("fill", "#333")
    .text(dataMin.toFixed(2));

  legendSvg.append("text")
    .attr("x", legendWidth)
    .attr("y", legendHeight + 28)
    .attr("font-size", 11)
    .attr("fill", "#333")
    .attr("text-anchor", "end")
    .text(dataMax.toFixed(2));

  document.dispatchEvent(new CustomEvent("ndviLoaded", {
    detail: {
      city: cityName,
      ndviValues,
      rasterWidth,
      rasterHeight,
      bbox,
      wardIds,
      wards: wardMeta ? wardMeta.wards : null
    }
  }));
}

renderNDVICity({
  containerId: "#ndviMap",
  dataPath: "data/tokyo/tokyo_ndvi_preprocessed.json",
  wardStatsPath: "data/tokyo/tokyo_wards.json",
  cityName: "Tokyo"
}).catch(err => console.error("Error loading NDVI map:", err));