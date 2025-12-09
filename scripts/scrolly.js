import { createMultiCityGridMap } from "./genericMap.js";

// compare.js and intercity.js still auto-initialize on #wardCompare and #cityCompare.
// We’ll just show/hide those containers via CSS from here.

// Optional: if you later refactor compare.js / intercity.js into exported
// functions, you can import and call them here instead.

let mapController = null;

// ------------------------------------
// Scene text content for overlay
// ------------------------------------
const SCENE_TEXT = [
  {
    title: "Heat isn’t evenly shared within a city.",
    body: "Focusing on nighttime land surface temperature (LST) in London, we map out a distribution of temperature across each borough (neighborhood). Each small square is a 1 km grid cell; borough borders are outlined. Notice how some boroughs stay warmer than others even after sundown."
  },
  {
    title: "Within-city inequality: borough by borough.",
    body: "To make easier comparisons between boroughs, we link a comparison chart to accompany the map. Hover over any borough in London to see the average of nighttime temperatures, and how it compares to an across-city average."
  },
  {
    title: "Day vs. night: heat that lingers.",
    body: "Switching between daytime and nighttime temperatures reveals where heat builds up most in the afternoon. Notice how many hot-at-night boroughs stay hot during the day, but this is only applicable to central London."
  },
  {
    title: "Where does greenness fit in?",
    body: "We can now map NDVI, a satellite measure of vegetation. Comparing vegetation to daytime and nighttime temperature, greener areas cool more quickly throughout the day; bare or human-built-up surfaces stay consistently hotter. "
  },
  {
    title: "Across cities, the story repeats.",
    body: "London isn’t the only city that sees this trend in greenness and temperature change. Zooming out, you can now switch between Tokyo, London, New York, and San Diego. Keeping all active features, we can perform a similar analysis of London and view the temperature contrast."
  },
  {
    title: "A ‘what-if’ greenness simulator.",
    body: "How can introducing more green spaces benefit metropolitan areas? Our simulation allows us to do this analysis. With our vegetation tab active, you can “paint” and add more vegetation to specific neighborhoods. We can estimate how much local daytime and nighttime temperatures would change if those pixels really became greener."
  },
  {
    title: "Comparing neighborhoods across cities.",
    body: "With a simulated view of each city, you can now compare neighborhoods across the four cities. The intra-city chart stays linked to the map so London’s boroughs remain interpretable while we bring others into view."
  },
  {
    title: "Greenness vs heat: a two-dimensional view.",
    body: "Finally, we combine NDVI and daytime temperature into a single bivariate map. Each color encodes a joint state: greener & cooler, greener & hotter, bare & hot, and so on. Below, the inter-city chart summarizes how each city’s pixels fall into those regimes."
  }
];

// ------------------------------------
// Layer controls helper (external)
// ------------------------------------
function setLayerControls(layers, activeId) {
  const container = d3.select("#layerControls");
  container.selectAll("*").remove();

  if (!layers || !layers.length) {
    container.style("display", "none");
    return;
  }

  container.style("display", "flex");

  const buttons = container.selectAll("button")
    .data(layers, d => d.id);

  const enter = buttons.enter()
    .append("button")
    .text(d => d.label)
    .on("click", (event, d) => {
      mapController.setLayer(d.id, { animate: true });
      setLayerControls(layers, d.id);
    });

  const merged = enter.merge(buttons);
  merged.classed("active", d => d.id === activeId);

  buttons.exit().remove();

  // Don't call setLayer here - it will be called by the scene or button click
}

// ------------------------------------
// Comparison panel visibility
// ------------------------------------
function showWardCompare(show) {
  d3.select("#wardCompare").style("display", show ? "block" : "none");
}

function showCityCompare(show) {
  d3.select("#cityCompare").style("display", show ? "block" : "none");
}
function showUhiCompare(show) {
  d3.select("#uhiCompare").style("display", show ? "block" : "none");
}

// ------------------------------------
// Overlay text update
// ------------------------------------
function setSceneText(index) {
  const t = SCENE_TEXT[index];
  if (!t) return;
  d3.select("#sceneTitle").text(t.title);
  d3.select("#sceneBody").text(t.body);
}

// ------------------------------------
// Floating panel behavior (drag + hide)
// ------------------------------------
function initFloatingPanels() {
  const panels = document.querySelectorAll(".comparison-panel");

  panels.forEach(panel => {
    const header = panel.querySelector(".panel-header");
    if (!header) return;

    let isDragging = false;
    let startX, startY, startLeft, startTop;

    header.addEventListener("mousedown", (e) => {
      // Skip if click is on a button in the header
      if (e.target.closest(".panel-btn")) return;
      if (e.button !== 0) return; // left mouse only

      isDragging = true;

      const rect = panel.getBoundingClientRect();

      // Make sure the panel is fixed relative to the viewport
      panel.style.position = "fixed";
      panel.style.left = rect.left + "px";
      panel.style.top = rect.top + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.zIndex = "1000"; // stay above the map

      startLeft = rect.left;
      startTop = rect.top;
      startX = e.clientX;
      startY = e.clientY;

      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${startLeft + dx}px`;
      panel.style.top = `${startTop + dy}px`;
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.userSelect = "";
    });

    // Collapse button
    const hideBtn = panel.querySelector(".panel-hide");
    if (hideBtn) {
      hideBtn.addEventListener("click", () => {
        panel.classList.toggle("collapsed");
      });
    }

    // Reset panel button: back to default size/position
    const resetBtn = panel.querySelector(".panel-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        panel.classList.remove("collapsed");
        // Remove any inline drag/resize overrides
        panel.style.left = "";
        panel.style.top = "";
        panel.style.right = "16px";
        panel.style.bottom = "16px";
        panel.style.width = "420px";
        panel.style.height = "280px";

        // Let the ResizeObserver reflow the chart
      });
    }
  });
}

async function initMainMap() {
  // This config is basically your "heat inequality" + NDVI painting superset.
  mapController = await createMultiCityGridMap({
    containerId: "#mainMap",
    enableNdviPainting: true,
    bivariate: false,
    bivariateVars: { var1: "ndvi", var2: "lst_day" },
    defaultCityId: "london",
    cityConfigs: [
      {
        id: "tokyo",
        label: "Tokyo",
        gridPath: "data/tokyo/tokyo_grid.json",
        wardStatsPath: "data/tokyo/tokyo_wards.json",
        cityName: "Tokyo",
        subunit: "Ward",
        enableNdviPainting: true,
        showLayerToggle: false,
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
        
      },
      {
        id: "london",
        label: "London",
        gridPath: "data/london/london_grid.json",
        wardStatsPath: "data/london/london_boroughs.json",
        cityName: "London",
        subunit: "Borough",
        enableNdviPainting: true,
        showLayerToggle: false,
        defaultActiveId: "lst_night",
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
        
      },
      {
        id: "nyc",
        label: "New York City",
        gridPath: "data/nyc/nyc_grid.json",
        wardStatsPath: "data/nyc/nyc_boroughs.json",
        cityName: "New York City",
        subunit: "Borough",
        enableNdviPainting: true,
        showLayerToggle: false,
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
        
      },
      {
        id: "sandiego",
        label: "San Diego County",
        gridPath: "data/san-diego/sandiego_grid.json",
        wardStatsPath: "data/san-diego/sandiego_boroughs.json",
        cityName: "San Diego County",
        subunit: "Neighborhood",
        enableNdviPainting: true,
        showLayerToggle: false,
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
        
      }
    ]
  });
}

// -----------------------------------------------------
// Scene definitions – across-city, intra-city early
// -----------------------------------------------------
let currentCity = null; // Track the current city to avoid unnecessary re-renders

const scenes = [
  // 0: Hook – London, nighttime heat, no extra controls
  () => {
    setSceneText(0);
    mapController.setBivariate(false);
    if (currentCity !== "london") {
      mapController.setCity("london");
      currentCity = "london";
    }
    mapController.setTempUnit("C");
    mapController.setLayer("lst_night", { animate: false });

    // 🔑 Only temp-unit pill, nothing else yet
    mapController.setControlsVisibility({
      showCityToggle: false,
      showUnitToggle: true,
      showCorrPanel: false,
      showBrushControls: false,
      showSimSummary: false
    });

    setLayerControls([], null);
    showWardCompare(false);
    showCityCompare(false);
    showUhiCompare(false); 
  },

  // 1: Intra-city inequality – wardCompare visible
  () => {
    setSceneText(1);
    mapController.setBivariate(false);
    if (currentCity !== "london") {
      mapController.setCity("london");
      currentCity = "london";
    }
    mapController.setLayer("lst_night", { animate: true });
    mapController.setTempUnit("C");

    mapController.setControlsVisibility({
      showCityToggle: false,
      showUnitToggle: true,
      showCorrPanel: false,      // still off
      showBrushControls: false,
      showSimSummary: false
    });

    setLayerControls(
      [
        { id: "lst_night", label: "Nighttime Temp." },
        { id: "lst_day",   label: "Daytime Temp." }
      ],
      "lst_night"
    );

    showWardCompare(true);
    showCityCompare(false);
    showUhiCompare(false); 
  },

  // 2: Day vs night heat (still London)
  () => {
    setSceneText(2);
    mapController.setBivariate(false);
    if (currentCity !== "london") {
      mapController.setCity("london");
      currentCity = "london";
    }
    mapController.setTempUnit("C");

    mapController.setControlsVisibility({
      showCityToggle: false,
      showUnitToggle: true,
      showCorrPanel: false,
      showBrushControls: false,
      showSimSummary: false
    });

    setLayerControls(
      [
        { id: "lst_night", label: "Nighttime Temp." },
        { id: "lst_day",   label: "Daytime Temp." }
      ],
      "lst_day"
    );

    mapController.setLayer("lst_day", { animate: true });

    showWardCompare(true);
    showCityCompare(false);
    showUhiCompare(true); 
  },

  // 3: NDVI + correlation – London
  () => {
    setSceneText(3);
    mapController.setBivariate(false);
    if (currentCity !== "london") {
      mapController.setCity("london");
      currentCity = "london";
    }
    mapController.setLayer("ndvi", { animate: true });

    // 🔑 correlation panel becomes relevant here
    mapController.setControlsVisibility({
      showCityToggle: false,
      showUnitToggle: true,
      showCorrPanel: true,
      showBrushControls: false,
      showSimSummary: false
    });

    setLayerControls(
      [
        { id: "ndvi",      label: "Vegetation" },
        { id: "lst_day",   label: "Daytime Temp." },
        { id: "lst_night", label: "Nighttime Temp." }
      ],
      "ndvi"
    );

    showWardCompare(true);
    showCityCompare(false);
    showUhiCompare(true);
  },

  // 4: Across-city, daytime LST
  () => {
    setSceneText(4);
    mapController.setBivariate(false);
    if (currentCity !== "tokyo") {
      mapController.setCity("tokyo");
      currentCity = "tokyo";
    }
    mapController.setLayer("ndvi", { animate: true });
    mapController.setTempUnit("C");

    // 🔑 now city toggle row makes sense
    mapController.setControlsVisibility({
      showCityToggle: true,
      showUnitToggle: true,
      showCorrPanel: true,
      showBrushControls: false,
      showSimSummary: false
    });

    setLayerControls(
      [
        { id: "ndvi",      label: "Vegetation" },
        { id: "lst_day",   label: "Daytime Temp." },
        { id: "lst_night", label: "Nighttime Temp." }
      ],
      "ndvi"
    );

    showWardCompare(true);
    showCityCompare(false);
    showUhiCompare(true);
  },

  // 5: What-if greenness simulator – NDVI, painting on
  () => {
    setSceneText(5);
    mapController.setBivariate(false);
    if (currentCity !== "tokyo") {
      mapController.setCity("tokyo");
      currentCity = "tokyo";
    }
    mapController.setLayer("ndvi", { animate: true });

    // 🔑 enable NDVI brush + sim summary
    mapController.setControlsVisibility({
      showCityToggle: true,
      showUnitToggle: true,
      showCorrPanel: true,
      showBrushControls: true,
      showSimSummary: true
    });

    setLayerControls(
      [
        { id: "ndvi",      label: "Vegetation" },
        { id: "lst_day",   label: "Daytime Temp." },
        { id: "lst_night", label: "Nighttime Temp." }
      ],
      "ndvi"
    );

    showWardCompare(true);
    showCityCompare(false);
    showUhiCompare(true);
  },

  // 6: Inter-neighborhood across cities
  () => {
    setSceneText(6);
    mapController.setBivariate(false);
    if (currentCity !== "tokyo") {
      mapController.setCity("tokyo");
      currentCity = "tokyo";
    }

    mapController.setControlsVisibility({
      showCityToggle: true,
      showUnitToggle: true,
      showCorrPanel: true,
      showBrushControls: false,
      showSimSummary: false
    });

    setLayerControls(
      [
        { id: "lst_day",   label: "Daytime Temp." },
        { id: "ndvi",      label: "Vegetation" }
      ],
      "lst_day"
    );

    mapController.setLayer("lst_day", { animate: true });

    showWardCompare(true);
    showCityCompare(false);
    showUhiCompare(true);
  },

  // 7: Final bivariate view + inter-city chart
  () => {
    setSceneText(7);
    if (currentCity !== "tokyo") {
      mapController.setCity("tokyo");
      currentCity = "tokyo";
    }
    mapController.setBivariate(true, { var1: "ndvi", var2: "lst_day" });
    mapController.setTempUnit("C");

    mapController.setControlsVisibility({
      showCityToggle: true,
      showUnitToggle: true,
      showCorrPanel: false,     // too much when bivariate
      showBrushControls: false,
      showSimSummary: false
    });

    setLayerControls([], null);

    showWardCompare(false);
    showCityCompare(true);
    showUhiCompare(true);
  }
];

// ------------------------------------
// Scrollama wiring
// ------------------------------------
function initScroller() {
  const scroller = scrollama();

  scroller
    .setup({
      step: "#scrollTriggers .step",
      offset: 0.6,
      debug: false
    })
    .onStepEnter(response => {
      const idx = Number(response.element.dataset.scene);
      const direction = response.direction; // 'up' or 'down'
      
      // When scrolling down, show the scene we're entering
      // When scrolling up, show the scene we're entering (going back to)
      // Both are the same - just trigger the scene for the step we're entering
      const fn = scenes[idx];
      if (fn && mapController) fn();
    });

  window.addEventListener("resize", () => scroller.resize());
}

// ------------------------------------
// Boot
// ------------------------------------
(async function main() {
  await initMainMap();
  initFloatingPanels();
  initScroller();

  // Initial scene state (top of page)
  scenes[0] && scenes[0]();

  // Global reset: reload to restore brushes, scenes, panel positions, etc.
  const resetBtn = document.getElementById("mapResetButton");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      window.location.reload();
    });
  }
})();