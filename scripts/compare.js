// Simple ward comparison panel linked to the generic grid map.
// - City toggles (Tokyo / London)
// - One metric per feature (NDVI / LST)
// - Reacts to gridLayerChanged + wardHover events from genericMap.js

// -------------------------------------------------------------
// City configs – extend later if needed
// -------------------------------------------------------------
const CITY_COMPARE_CONFIGS = [
  {
    id: "tokyo",
    name: "Tokyo",
    wardStatsPath: "data/tokyo/tokyo_wards.json"
  },
  {
    id: "london",
    name: "London",
    wardStatsPath: "data/london/london_boroughs.json"
  },
  {
    id: "nyc",
    name: "New York City",
    wardStatsPath: "data/nyc/nyc_boroughs.json"
  },
  {
    id: "san-diego",
    name: "San Diego County",
    wardStatsPath: "data/san-diego/sandiego_boroughs.json"
  }
];

// -------------------------------------------------------------
// Metric options *independent* of map layers
// -------------------------------------------------------------
const METRIC_OPTIONS = [
  {
    key: "ndvi_mean",
    label: "Ward-average greenness (NDVI)"
  },
  {
    key: "lst_day_mean",
    label: "Ward-average daytime land surface temperature (°C)"
  },
  {
    key: "lst_night_mean",
    label: "Ward-average nighttime land surface temperature (°C)"
  }
];

const METRIC_BY_KEY = new Map(METRIC_OPTIONS.map(m => [m.key, m]));

// -------------------------------------------------------------
// Global-ish state for the ward comparison view
// -------------------------------------------------------------
const wardsByCity = new Map();  // cityId -> wards[]
let activeCityId = "tokyo";

let activeMetricKey = METRIC_OPTIONS[0].key;
let activeMetricLabel = METRIC_OPTIONS[0].label;

let barSvg = null;
let barsSelection = null;
let barTooltip = null;
let barHighlightId = null;

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
function cityIdFromName(name) {
  const s = (name || "").toLowerCase();
  if (s.includes("tokyo")) return "tokyo";
  if (s.includes("london")) return "london";
  if (s.includes("new york city")) return "nyc";
  if (s.includes("san diego county")) return "san-diego";
  return null;
}

function getCityConfig(id) {
  return CITY_COMPARE_CONFIGS.find(c => c.id === id);
}

function highlightBar(wardId) {
  barHighlightId = wardId;
  if (!barsSelection) return;

  barsSelection
    .attr("stroke-width", d => (wardId && d.id === wardId) ? 2 : 0.5)
    .attr("stroke", d => (wardId && d.id === wardId) ? "#000" : "#333")
    .attr("opacity", d => (wardId && d.id !== wardId) ? 0.35 : 0.9);
}

// -------------------------------------------------------------
// Build static shell: controls + SVG container
// -------------------------------------------------------------
function buildWardCompareShell() {
  const container = d3.select("#wardCompare");
  container.selectAll("*").remove();

  const node = container.node();
  const width = node.clientWidth;
  const height = node.clientHeight;

  const controls = container.append("div")
    .attr("class", "ward-compare-simple-controls")
    .style("display", "flex")
    .style("align-items", "baseline")
    .style("gap", "16px")
    .style("margin-bottom", "8px")
    .style("font-size", "13px");

  // ---- City toggle buttons ----
  const cityCtrl = controls.append("div");
  cityCtrl.append("span").text("City: ");

  const cityButtons = cityCtrl.selectAll("button")
    .data(CITY_COMPARE_CONFIGS, d => d.id)
    .enter()
    .append("button")
    .text(d => d.name)
    .style("border", "1px solid #ccc")
    .style("padding", "2px 6px")
    .style("border-radius", "3px")
    .style("cursor", "pointer");

  function updateCityButtonStyles() {
    cityButtons
      .style("background", d => d.id === activeCityId ? "#333" : "#fff")
      .style("color", d => d.id === activeCityId ? "#fff" : "#333");
  }

  cityButtons.on("click", (event, d) => {
    if (d.id === activeCityId) return;
    activeCityId = d.id;
    updateCityButtonStyles();
    updateChart();
  });

  updateCityButtonStyles();

  // ---- Metric dropdown (independent of maps) ----
  const metricCtrl = controls.append("div");
  metricCtrl.append("span").text("Comparing neighborhoods by: ");

  const metricSelect = metricCtrl.append("select")
    .style("padding", "2px 4px")
    .style("border-radius", "3px")
    .style("border", "1px solid #ccc");

  metricSelect.selectAll("option")
    .data(METRIC_OPTIONS, d => d.key)
    .enter()
    .append("option")
    .attr("value", d => d.key)
    .text(d => d.label);

  metricSelect.property("value", activeMetricKey);

  metricSelect.on("change", function () {
    const key = this.value;
    const info = METRIC_BY_KEY.get(key);
    if (!info) return;

    activeMetricKey = info.key;
    activeMetricLabel = info.label;
    updateChart();
  });

  // ---- Tooltip (shared) ----
  barTooltip = d3.select("body")
    .append("div")
    .attr("class", "ward-compare-tooltip-simple")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("background", "rgba(0,0,0,0.8)")
    .style("color", "#fff")
    .style("padding", "4px 8px")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("opacity", 0);

  // ---- SVG for the bar chart ----
  const svgHeight = height - 40;
  barSvg = container.append("svg")
    .attr("width", width)
    .attr("height", svgHeight);
}

// -------------------------------------------------------------
// Core: draw or redraw the bar chart
// -------------------------------------------------------------
function updateChart() {
  if (!barSvg) return;

  const wards = wardsByCity.get(activeCityId) || [];
  const metricKey = activeMetricKey;

  const data = wards.filter(w => Number.isFinite(w[metricKey]));
  if (!data.length) {
    barSvg.selectAll("*").remove();
    return;
  }

  const width = +barSvg.attr("width");
  const height = +barSvg.attr("height");

  const margin = { top: 30, right: 20, bottom: 30, left: 130 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  barSvg.selectAll("*").remove();

  const g = barSvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Sort wards by metric (descending)
  const sorted = data.slice().sort((a, b) => b[metricKey] - a[metricKey]);

  const y = d3.scaleBand()
    .domain(sorted.map(d => d.name || ("Ward " + d.id)))
    .range([0, innerH])
    .padding(0.15);

  const x = d3.scaleLinear()
    .domain(d3.extent(sorted, d => d[metricKey])).nice()
    .range([0, innerW]);

  const color = d3.scaleSequential(d3.interpolateTurbo)
    .domain(d3.extent(sorted, d => d[metricKey]));

  // Axes
  g.append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(4));

  g.append("g")
    .attr("class", "y-axis")
    .call(d3.axisLeft(y).tickSize(0))
    .selectAll("text")
    .style("font-size", 10);

  // Bars
  barsSelection = g.selectAll("rect")
    .data(sorted, d => d.id)
    .join("rect")
    .attr("x", 0)
    .attr("y", d => y(d.name || ("Ward " + d.id)))
    .attr("height", y.bandwidth())
    .attr("width", d => x(d[metricKey]))
    .attr("fill", d => color(d[metricKey]))
    .attr("stroke", "#333")
    .attr("stroke-width", 0.5)
    .attr("opacity", 0.9);

  const cityConfig = getCityConfig(activeCityId);

  // Title
  barSvg.append("text")
    .attr("x", width / 2)
    .attr("y", 18)
    .attr("text-anchor", "middle")
    .attr("font-size", 13)
    .text(
      `${cityConfig ? cityConfig.name : activeCityId}: ` +
      `neighborhoods by ${activeMetricLabel}`
    );

  // Interaction: hover bars -> tooltip + broadcast wardHover
  barsSelection
    .on("mouseenter", (event, d) => {
      highlightBar(d.id);

      barTooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.name || ("Ward " + d.id)}</strong><br>` +
          `${activeMetricLabel}: ${d[metricKey].toFixed(2)}`
        )
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");

      const cfg = getCityConfig(activeCityId);
      document.dispatchEvent(new CustomEvent("wardHover", {
        detail: {
          city: cfg ? cfg.name : activeCityId,
          wardId: d.id,
          ward: d
        }
      }));
    })
    .on("mousemove", (event) => {
      barTooltip
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseleave", () => {
      highlightBar(null);
      barTooltip.style("opacity", 0);

      const cfg = getCityConfig(activeCityId);
      document.dispatchEvent(new CustomEvent("wardHover", {
        detail: {
          city: cfg ? cfg.name : activeCityId,
          wardId: null,
          ward: null
        }
      }));
    });

  // Re-apply any current highlight (e.g. from map hover)
  highlightBar(barHighlightId);
}

// -------------------------------------------------------------
// Init: load ward stats, build shell, hook into map events
// -------------------------------------------------------------
(async function initWardCompareSimple() {
  // 1) Load ward stats for each city
  await Promise.all(
    CITY_COMPARE_CONFIGS.map(async (config) => {
      const resp = await fetch(config.wardStatsPath);
      const json = await resp.json();
      wardsByCity.set(config.id, json.wards || []);
    })
  );

  // 2) Build static UI and first chart
  buildWardCompareShell();
  updateChart();

  // 3) React ONLY to wardHover events from the map (pixel hover)
  //    (No more gridLayerChanged -> metric coupling)
  document.addEventListener("wardHover", (evt) => {
    const detail = evt.detail || {};
    const cityId = cityIdFromName(detail.city);
    if (cityId !== activeCityId) return;

    highlightBar(detail.wardId || null);
  });
})().catch(err => console.error("Error initializing simple ward compare:", err));