// -------------------------------------------------------------
// City configs – add more cities here later
// -------------------------------------------------------------
const CITY_COMPARE_CONFIGS = [
  {
    id: "tokyo",
    name: "Tokyo",
    wardStatsPath: "data/tokyo/tokyo_wards.json"
  }
];

// Human-friendly labels for known metrics (fallback = raw key)
const METRIC_LABELS = {
  pixel_count: "Pixel count (area proxy)",

  ndvi_min: "NDVI min",
  ndvi_q1: "NDVI 25th percentile",
  ndvi_median: "NDVI median",
  ndvi_q3: "NDVI 75th percentile",
  ndvi_max: "NDVI max",
  ndvi_mean: "NDVI mean",
  ndvi_std: "NDVI std dev",

  lst_day_min: "Daytime LST min (°C)",
  lst_day_q1: "Daytime LST 25th percentile (°C)",
  lst_day_median: "Daytime LST median (°C)",
  lst_day_q3: "Daytime LST 75th percentile (°C)",
  lst_day_max: "Daytime LST max (°C)",
  lst_day_mean: "Daytime LST mean (°C)",
  lst_day_std: "Daytime LST std dev (°C)",

  lst_night_min: "Nighttime LST min (°C)",
  lst_night_q1: "Nighttime LST 25th percentile (°C)",
  lst_night_median: "Nighttime LST median (°C)",
  lst_night_q3: "Nighttime LST 75th percentile (°C)",
  lst_night_max: "Nighttime LST max (°C)",
  lst_night_mean: "Nighttime LST mean (°C)",
  lst_night_std: "Nighttime LST std dev (°C)"
};

function metricLabel(key) {
  return METRIC_LABELS[key] || key;
}

// -------------------------------------------------------------
// Main entry
// -------------------------------------------------------------
(async function initWardCompare() {
  const cityConfig = CITY_COMPARE_CONFIGS[0]; // for now: Tokyo only
  if (!cityConfig) return;

  const wardResp = await fetch(cityConfig.wardStatsPath);
  const wardJson = await wardResp.json();

  const wards = wardJson.wards || [];
  if (!wards.length) return;

  // Infer metric keys: all numeric fields (except id) from the first ward
  const sample = wards[0];
  const numericKeys = Object.keys(sample)
    .filter(k => typeof sample[k] === "number" && k !== "id");

  // Recommended defaults: greenness vs nighttime heat
  const defaultX = "ndvi_mean";
  const defaultY = "lst_night_mean";

  const xMetricDefault = numericKeys.includes(defaultX) ? defaultX : numericKeys[0];
  const yMetricDefault = numericKeys.includes(defaultY) ? defaultY : numericKeys[1] || numericKeys[0];

  buildWardCompareUI({
    cityName: wardJson.city || cityConfig.name,
    wards,
    metricKeys: numericKeys,
    xMetricDefault,
    yMetricDefault
  });
})().catch(err => console.error("Error initializing wardCompare:", err));

// -------------------------------------------------------------
// UI + visualization
// -------------------------------------------------------------
function buildWardCompareUI({ cityName, wards, metricKeys, xMetricDefault, yMetricDefault }) {
  const container = d3.select("#wardCompare");
  container.selectAll("*").remove();

  const node = container.node();
  const width = node.clientWidth;
  const height = node.clientHeight;

  // ---- 1. Layout: controls + two SVGs side by side ----
  const controls = container.append("div")
    .attr("class", "ward-compare-controls")
    .style("display", "flex")
    .style("gap", "12px")
    .style("align-items", "center")
    .style("margin-bottom", "8px")
    .style("font-size", "13px");

  controls.append("span").text("Compare wards by:");

  const xSelect = controls.append("label")
    .text("X: ")
    .append("select");

  const ySelect = controls.append("label")
    .style("margin-left", "8px")
    .text("Y: ")
    .append("select");

  // color metric: by default, same as Y
  const colorSelect = controls.append("label")
    .style("margin-left", "8px")
    .text("Color: ")
    .append("select");

  metricKeys.forEach(k => {
    xSelect.append("option")
      .attr("value", k)
      .text(metricLabel(k));

    ySelect.append("option")
      .attr("value", k)
      .text(metricLabel(k));

    colorSelect.append("option")
      .attr("value", k)
      .text(metricLabel(k));
  });

  xSelect.property("value", xMetricDefault);
  ySelect.property("value", yMetricDefault);
  colorSelect.property("value", yMetricDefault);

  const wrapper = container.append("div")
    .attr("class", "ward-compare-wrapper")
    .style("display", "flex")
    .style("gap", "16px")
    .style("height", (height - 40) + "px");

  const scatterWidth = width * 0.65;
  const mapWidth = width * 0.35;

  const scatterSvg = wrapper.append("svg")
    .attr("width", scatterWidth)
    .attr("height", height - 40);

  const mapSvg = wrapper.append("svg")
    .attr("width", mapWidth)
    .attr("height", height - 40);

  // Shared tooltip
  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "ward-compare-tooltip")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("background", "rgba(0,0,0,0.8)")
    .style("color", "#fff")
    .style("padding", "4px 8px")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("opacity", 0);

  // Precompute map bounds from ward bboxes
  const lonMin = d3.min(wards, w => w.bbox[0]);
  const latMin = d3.min(wards, w => w.bbox[1]);
  const lonMax = d3.max(wards, w => w.bbox[2]);
  const latMax = d3.max(wards, w => w.bbox[3]);

  function update() {
    const xKey = xSelect.property("value");
    const yKey = ySelect.property("value");
    const cKey = colorSelect.property("value");

    drawScatter({
      svg: scatterSvg,
      cityName,
      wards,
      xKey,
      yKey,
      cKey,
      tooltip
    });

    drawWardMap({
      svg: mapSvg,
      cityName,
      wards,
      lonMin,
      lonMax,
      latMin,
      latMax,
      colorKey: cKey,
      tooltip
    });
  }

  xSelect.on("change", update);
  ySelect.on("change", update);
  colorSelect.on("change", update);

  update(); // initial render
}

// -------------------------------------------------------------
// Scatterplot: ward-level metric X vs metric Y
// -------------------------------------------------------------
function drawScatter({ svg, cityName, wards, xKey, yKey, cKey, tooltip }) {
  svg.selectAll("*").remove();

  const width = +svg.attr("width");
  const height = +svg.attr("height");

  const margin = { top: 30, right: 20, bottom: 50, left: 60 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Filter wards with finite values
  const data = wards.filter(w =>
    Number.isFinite(w[xKey]) && Number.isFinite(w[yKey]) && Number.isFinite(w[cKey])
  );

  const x = d3.scaleLinear()
    .domain(d3.extent(data, d => d[xKey])).nice()
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain(d3.extent(data, d => d[yKey])).nice()
    .range([innerH, 0]);

  const color = d3.scaleSequential(d3.interpolateTurbo)
    .domain(d3.extent(data, d => d[cKey]));

  const rScale = d3.scaleSqrt()
    .domain(d3.extent(data, d => d.pixel_count || 1))
    .range([3, 9]);

  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).ticks(5));

  g.append("g")
    .call(d3.axisLeft(y).ticks(5));

  g.append("text")
    .attr("x", innerW / 2)
    .attr("y", innerH + 40)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .text(metricLabel(xKey));

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -45)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .text(metricLabel(yKey));

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 18)
    .attr("text-anchor", "middle")
    .attr("font-size", 13)
    .text(`${cityName}: ward-level ${metricLabel(xKey)} vs ${metricLabel(yKey)}`);

  const points = g.selectAll("circle")
    .data(data, d => d.id)
    .join("circle")
    .attr("cx", d => x(d[xKey]))
    .attr("cy", d => y(d[yKey]))
    .attr("r", d => rScale(d.pixel_count || 1))
    .attr("fill", d => color(d[cKey]))
    .attr("fill-opacity", 0.9)
    .attr("stroke", "#333")
    .attr("stroke-width", 0.6);

  function setHighlight(id) {
    points
      .attr("stroke-width", d => d.id === id ? 2 : 0.6)
      .attr("stroke", d => d.id === id ? "#000" : "#333");
  }

  points
    .on("mouseenter", (event, d) => {
      setHighlight(d.id);

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.name || ("Ward " + d.id)}</strong><br>` +
          `${metricLabel(xKey)}: ${d[xKey].toFixed(2)}<br>` +
          `${metricLabel(yKey)}: ${d[yKey].toFixed(2)}<br>` +
          `${metricLabel(cKey)} (color): ${d[cKey].toFixed(2)}`
        );

      tooltip
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");

      // Broadcast wardHover so the map / NDVI view can respond
      document.dispatchEvent(new CustomEvent("wardHover", {
        detail: {
          city: cityName,
          wardId: d.id,
          ward: d
        }
      }));
    })
    .on("mousemove", (event) => {
      tooltip
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseleave", () => {
      setHighlight(null);
      tooltip.style("opacity", 0);

      document.dispatchEvent(new CustomEvent("wardHover", {
        detail: {
          city: cityName,
          wardId: null,
          ward: null
        }
      }));
    });
}

// -------------------------------------------------------------
// Mini "map": ward centroids colored by a metric
// -------------------------------------------------------------
function drawWardMap({ svg, cityName, wards, lonMin, lonMax, latMin, latMax, colorKey, tooltip }) {
  svg.selectAll("*").remove();

  const width = +svg.attr("width");
  const height = +svg.attr("height");

  const margin = { top: 30, right: 20, bottom: 30, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear()
    .domain([lonMin, lonMax])
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain([latMin, latMax])
    .range([innerH, 0]); // lat increases upwards

  const data = wards.filter(w =>
    w.centroid && Number.isFinite(w.centroid.lon) &&
    Number.isFinite(w.centroid.lat) &&
    Number.isFinite(w[colorKey])
  );

  const color = d3.scaleSequential(d3.interpolateTurbo)
    .domain(d3.extent(data, d => d[colorKey]));

  const r = 5;

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", 18)
    .attr("text-anchor", "middle")
    .attr("font-size", 13)
    .text(`${cityName}: wards colored by ${metricLabel(colorKey)}`);

  const circles = g.selectAll("circle")
    .data(data, d => d.id)
    .join("circle")
    .attr("cx", d => x(d.centroid.lon))
    .attr("cy", d => y(d.centroid.lat))
    .attr("r", r)
    .attr("fill", d => color(d[colorKey]))
    .attr("stroke", "#222")
    .attr("stroke-width", 0.7)
    .attr("fill-opacity", 0.9);

  function setHighlight(id) {
    circles
      .attr("stroke-width", d => d.id === id ? 2 : 0.7)
      .attr("stroke", d => d.id === id ? "#000" : "#222");
  }

  circles
    .on("mouseenter", (event, d) => {
      setHighlight(d.id);

      tooltip
        .style("opacity", 1)
        .html(
          `<strong>${d.name || ("Ward " + d.id)}</strong><br>` +
          `${metricLabel(colorKey)}: ${d[colorKey].toFixed(2)}`
        )
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");

      document.dispatchEvent(new CustomEvent("wardHover", {
        detail: {
          city: cityName,
          wardId: d.id,
          ward: d
        }
      }));
    })
    .on("mousemove", (event) => {
      tooltip
        .style("left", (event.pageX + 12) + "px")
        .style("top", (event.pageY - 28) + "px");
    })
    .on("mouseleave", () => {
      setHighlight(null);
      tooltip.style("opacity", 0);

      document.dispatchEvent(new CustomEvent("wardHover", {
        detail: {
          city: cityName,
          wardId: null,
          ward: null
        }
      }));
    });

  // simple border box for context
  g.append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", innerW)
    .attr("height", innerH)
    .attr("fill", "none")
    .attr("stroke", "#ccc")
    .attr("stroke-width", 1);
}