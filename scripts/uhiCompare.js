// Urban Heat Island comparison panel:
//   - City buttons (same cities as other panels)
//   - Groups wards into "Urban (built-up)" vs "Non-urban" using lc_mode
//   - Uses wardStatsUpdated (so reacts to NDVI painting)
//   - Shows grouped bars: day vs night LST for each group

// ---------------------------------------------
// City configs (reuse your existing set)
// ---------------------------------------------
const UHI_CITY_CONFIGS = [
  {
    id: "tokyo",
    name: "Tokyo"
  },
  {
    id: "london",
    name: "London"
  },
  {
    id: "nyc",
    name: "New York City"
  },
  {
    id: "san-diego",
    name: "San Diego County"
  }
];

// lc_mode → "urbanness" category
function lcModeToGroup(lcCode) {
  if (lcCode === 13) return "Urban (built-up)";
  // You can refine this later:
  // forests, grasslands, croplands, etc.
  return "Non-urban";
}

function uhiCityIdFromName(name) {
  const s = (name || "").toLowerCase();
  if (s.includes("tokyo")) return "tokyo";
  if (s.includes("london")) return "london";
  if (s.includes("new york")) return "nyc";
  if (s.includes("san diego")) return "san-diego";
  return null;
}

// Per-city ward metadata (from gridLoaded)
const wardMetaByCity = new Map(); // cityId -> wards[]
const wardMetricsByCity = new Map();   // cityId -> metricsByWardId

// Per-city UHI aggregates
// cityId -> { groups: [ { key, label, meanDay, meanNight, count } ] }
const uhiStatsByCity = new Map();

let uhiActiveCityId = "london";

let uhiSvg = null;
let uhiResizeObserver = null;

// ---------------------------------------------
// UI shell + resize
// ---------------------------------------------
function buildUhiShell() {
  const container = d3.select("#uhiCompare .panel-body");
  container.selectAll("*").remove();

  const node = container.node();
  let width = node.clientWidth;
  let height = node.clientHeight;

  if (!width || !height) {
    width = parseFloat(container.style("width")) || 360;
    height = parseFloat(container.style("height")) || 260;
  }

  // Controls row (city buttons)
  const controls = container.append("div")
    .attr("class", "uhi-controls")
    .style("display", "flex")
    .style("align-items", "baseline")
    .style("gap", "12px")
    .style("margin-bottom", "6px")
    .style("font-size", "13px");

  const cityCtrl = controls.append("div");
  cityCtrl.append("span").text("City: ");

  const cityButtons = cityCtrl.selectAll("button")
    .data(UHI_CITY_CONFIGS, d => d.id)
    .enter()
    .append("button")
    .text(d => d.name)
    .style("border", "1px solid #ccc")
    .style("padding", "2px 6px")
    .style("border-radius", "3px")
    .style("cursor", "pointer");

  function updateCityButtonStyles() {
    cityButtons
      .style("background", d => d.id === uhiActiveCityId ? "#333" : "#fff")
      .style("color", d => d.id === uhiActiveCityId ? "#fff" : "#333");
  }

  cityButtons.on("click", (event, d) => {
    if (d.id === uhiActiveCityId) return;
    uhiActiveCityId = d.id;
    updateCityButtonStyles();
    updateUhiChart();
  });

  updateCityButtonStyles();

  // Summary text placeholder
  container.append("div")
    .attr("class", "uhi-summary")
    .style("font-size", "12px")
    .style("margin-bottom", "4px")
    .style("color", "#333");

  // SVG for the grouped bar chart
  const svgHeight = Math.max(120, height - 48);
  uhiSvg = container.append("svg")
    .attr("width", width)
    .attr("height", svgHeight || 220);
}

function rebuildUhiForSize() {
  const containerNode = document.querySelector("#uhiCompare .panel-body");
  if (!containerNode) return;

  const w = containerNode.clientWidth;
  const h = containerNode.clientHeight;
  if (!w || !h) return;

  buildUhiShell();
  updateUhiChart();

  const scale = Math.max(0.75, Math.min(1.15, w / 360));
  d3.select("#uhiCompare .panel-body")
    .style("font-size", `${12 * scale}px`);
}

// ---------------------------------------------
// Aggregate ward stats → UHI stats per city
// ---------------------------------------------
function recomputeUhiStatsForCity(cityId) {
  const wards = wardMetaByCity.get(cityId);
  const metricsByWardId = wardMetricsByCity.get(cityId);
  if (!wards || !wards.length || !metricsByWardId) return;

  const buckets = new Map(); // key -> { key, label, sumDay, sumNight, count }

  wards.forEach(w => {
    const m = metricsByWardId[w.id];
    if (!m) return;

    const lcCode = w.lc_mode != null ? Math.round(w.lc_mode) : null;
    const groupKey = lcModeToGroup(lcCode);
    const label = groupKey;

    let b = buckets.get(groupKey);
    if (!b) {
      b = { key: groupKey, label, sumDay: 0, sumNight: 0, count: 0 };
      buckets.set(groupKey, b);
    }

    if (Number.isFinite(m.lst_day_mean)) {
      b.sumDay += m.lst_day_mean;
    }
    if (Number.isFinite(m.lst_night_mean)) {
      b.sumNight += m.lst_night_mean;
    }
    if (Number.isFinite(m.lst_day_mean) || Number.isFinite(m.lst_night_mean)) {
      b.count += 1;
    }
  });

  const groups = Array.from(buckets.values())
    .filter(g => g.count > 0)
    .map(g => ({
      key: g.key,
      label: g.label,
      meanDay: g.sumDay / g.count,
      meanNight: g.sumNight / g.count,
      count: g.count
    }));

  uhiStatsByCity.set(cityId, { groups });
}

// ---------------------------------------------
// Draw / update the chart
// ---------------------------------------------
function updateUhiChart() {
  if (!uhiSvg) return;

  const stats = uhiStatsByCity.get(uhiActiveCityId);
  const container = d3.select("#uhiCompare .panel-body");
  const summary = container.select(".uhi-summary");

  if (!stats || !stats.groups || !stats.groups.length) {
    uhiSvg.selectAll("*").remove();
    summary.text("Waiting for ward stats… try hovering or painting on the map.");
    return;
  }

  const groups = stats.groups;
  const width = +uhiSvg.attr("width");
  const height = +uhiSvg.attr("height");

  const margin = { top: 24, right: 16, bottom: 40, left: 48 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  uhiSvg.selectAll("*").remove();

  const g = uhiSvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const groupLabels = groups.map(d => d.label);
  const x0 = d3.scaleBand()
    .domain(groupLabels)
    .range([0, innerW])
    .padding(0.3);

  const x1 = d3.scaleBand()
    .domain(["Day", "Night"])
    .range([0, x0.bandwidth()])
    .padding(0.15);

  // y based on °C; you can broaden domain if you want
  const allVals = [];
  groups.forEach(d => {
    if (Number.isFinite(d.meanDay)) allVals.push(d.meanDay);
    if (Number.isFinite(d.meanNight)) allVals.push(d.meanNight);
  });

  // Convert temperatures to display unit
  const displayVals = allVals.map(v => window.mapController ? window.mapController.toDisplayTemp(v) : v);
  
  const y = d3.scaleLinear()
    .domain(d3.extent(displayVals)).nice()
    .range([innerH, 0]);

  const color = d3.scaleOrdinal()
    .domain(["Day", "Night"])
    .range(["#EF6C00", "#1E88E5"]); // daytime orange, night blue

  // Axes
  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x0))
    .selectAll("text")
    .style("font-size", 11);

  g.append("g")
    .call(d3.axisLeft(y).ticks(4))
    .selectAll("text")
    .style("font-size", 11);

  // Y-axis label with temperature unit
  const tempUnit = window.mapController ? window.mapController.tempSuffix() : "°C";
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("y", 0 - margin.left + 10)
    .attr("x", 0 - (innerH / 2))
    .attr("dy", "1em")
    .style("text-anchor", "middle")
    .style("font-size", "11px")
    .text(`Temperature ${tempUnit}`);

  // Bars
  const groupG = g.selectAll(".uhi-group")
    .data(groups, d => d.key)
    .enter()
    .append("g")
    .attr("class", "uhi-group")
    .attr("transform", d => `translate(${x0(d.label)},0)`);

  const series = [
    { key: "day", label: "Day", accessor: d => d.meanDay },
    { key: "night", label: "Night", accessor: d => d.meanNight }
  ];

  series.forEach(s => {
    groupG.append("rect")
      .attr("x", d => x1(s.label))
      .attr("y", d => {
        const val = s.accessor(d);
        const displayVal = window.mapController ? window.mapController.toDisplayTemp(val) : val;
        return y(displayVal);
      })
      .attr("width", x1.bandwidth())
      .attr("height", d => {
        const val = s.accessor(d);
        const displayVal = window.mapController ? window.mapController.toDisplayTemp(val) : val;
        return innerH - y(displayVal);
      })
      .attr("fill", color(s.label))
      .append("title")
      .text(d => {
        const val = s.accessor(d);
        const displayVal = window.mapController ? window.mapController.toDisplayTemp(val) : val;
        const suffix = window.mapController ? window.mapController.tempSuffix() : "°C";
        return `${s.label}: ${displayVal.toFixed(2)} ${suffix}`;
      });
  });

  // Legend
  const legend = g.append("g")
    .attr("transform", `translate(${innerW - 80},0)`);

  ["Day", "Night"].forEach((name, i) => {
    const row = legend.append("g")
      .attr("transform", `translate(0,${i * 16})`);

    row.append("rect")
      .attr("width", 10)
      .attr("height", 10)
      .attr("fill", color(name));

    row.append("text")
      .attr("x", 14)
      .attr("y", 8)
      .attr("font-size", 10)
      .text(name);
  });

  // Axis labels
  g.append("text")
    .attr("x", innerW / 2)
    .attr("y", innerH + 30)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .text("Neighborhood type (by dominant land cover)");

  const axisTempUnit = window.mapController ? window.mapController.tempSuffix() : "°C";
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -36)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .text(`Average land surface temperature ${axisTempUnit}`);

  // Simple UHI summary: Urban – Non-urban, day & night (if both exist)
  const urban = groups.find(g => g.key === "Urban (built-up)");
  const nonUrban = groups.find(g => g.key !== "Urban (built-up)");

  if (urban && nonUrban) {
    const dayDiff = (urban.meanDay - nonUrban.meanDay);
    const nightDiff = (urban.meanNight - nonUrban.meanNight);

    // Convert differences to display temperature
    const dayDiffDisplay = window.mapController ? window.mapController.toDisplayTemp(urban.meanDay) - window.mapController.toDisplayTemp(nonUrban.meanDay) : dayDiff;
    const nightDiffDisplay = window.mapController ? window.mapController.toDisplayTemp(urban.meanNight) - window.mapController.toDisplayTemp(nonUrban.meanNight) : nightDiff;
    const summaryTempUnit = window.mapController ? window.mapController.tempSuffix() : "°C";

    summary.html(
      `<strong>UHI signal:</strong> ` +
      `Day: ${(dayDiffDisplay >= 0 ? "+" : "") + dayDiffDisplay.toFixed(2)} ${summaryTempUnit}; ` +
      `Night: ${(nightDiffDisplay >= 0 ? "+" : "") + nightDiffDisplay.toFixed(2)} ${summaryTempUnit} ` +
      `(Urban minus non-urban wards)`
    );
  } else {
    summary.text("Not enough wards with valid data to compute a clear UHI contrast.");
  }
}

// ---------------------------------------------
// Init: hook into map events
// ---------------------------------------------
(function initUhiCompare() {
  const panelBody = document.querySelector("#uhiCompare .panel-body");
  if (!panelBody) {
    console.warn("UHI panel #uhiCompare .panel-body not found; skipping init.");
    return;
  }

  buildUhiShell();

  // Keep track of ward metadata from gridLoaded
  document.addEventListener("gridLoaded", (evt) => {
    const detail = evt.detail || {};
    const cityName = detail.city;
    const wards = detail.wards || [];
    const cityId = uhiCityIdFromName(cityName);
    if (!cityId) return;

    wardMetaByCity.set(cityId, wards);

    // If we already have metrics, recompute and update
    if (wardMetricsByCity.get(cityId)) {
        recomputeUhiStatsForCity(cityId);
        if (cityId === uhiActiveCityId) {
        updateUhiChart();
        }
    }
    });

  // React to wardStatsUpdated – this already encodes NDVI / LST changes
  document.addEventListener("wardStatsUpdated", (evt) => {
    const detail = evt.detail || {};
    const cityName = (detail.cityName || "").toLowerCase();
    const metricsByWardId = detail.metricsByWardId || {};

    const cityId = uhiCityIdFromName(cityName);
    if (!cityId) return;

    wardMetricsByCity.set(cityId, metricsByWardId);

    if (wardMetaByCity.get(cityId)) {
        recomputeUhiStatsForCity(cityId);
        if (cityId === uhiActiveCityId) {
        updateUhiChart();
        }
    }
  });

  // Listen for temperature unit changes
  document.addEventListener("tempUnitChanged", (evt) => {
    // Refresh the chart when temperature unit changes
    if (uhiActiveCityId && uhiStatsByCity.get(uhiActiveCityId)) {
      updateUhiChart();
    }
  });

  // Resize observer
  if (!uhiResizeObserver) {
    uhiResizeObserver = new ResizeObserver(() => {
      rebuildUhiForSize();
    });
    uhiResizeObserver.observe(panelBody);
  }

  // Initial empty chart
  updateUhiChart();
})();//.catch(err => console.error("Error initializing UHI compare:", err));