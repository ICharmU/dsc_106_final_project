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
    title: "Land cover can also influence heat",
    body: "We'll now map land cover. Comparing land cover to daytime and nighttime temperature, areas that are associated with high greenery (forests and grasslands), show consistently low temperatures throughout the day"
  },
  {
    title: "A ‘what-if’ greenness simulator.",
    body: "How can introducing more green spaces benefit metropolitan areas? Our simulation allows us to do this analysis. With our vegetation tab active, you can “paint” and add more vegetation to specific neighborhoods. We can estimate how much local daytime and nighttime temperatures would change if those pixels really became greener through a feature correlation plot."
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
  const panel = d3.select("#wardCompare");
  panel.classed("is-visible", !!show);
}

function showCityCompare(show) {
  const panel = d3.select("#cityCompare");
  panel.classed("is-visible", !!show);
}

function showUhiCompare(show) {
  const panel = d3.select("#uhiCompare");
  panel.classed("is-visible", !!show);
}

// ------------------------------------
// Overlay text update
// ------------------------------------
function setSceneText(index) {
  const t = SCENE_TEXT[index];
  if (!t) return;

  const overlay = d3.select("#overlayText");

  overlay.transition()
    .duration(120)
    .style("opacity", 0)
    .on("end", () => {
      d3.select("#sceneTitle").text(t.title);
      d3.select("#sceneBody").text(t.body);

      overlay.transition()
        .duration(180)
        .style("opacity", 1);
    });
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

        // Clear inline overrides so CSS (including masonry/media queries)
        // can re-apply the default position + size.
        panel.style.left = "";
        panel.style.top = "";
        panel.style.right = "";
        panel.style.bottom = "";
        panel.style.width = "";
        panel.style.height = "";
      });
    }
  });
}

// ------------------------------------
// Panel behavior: expand / collapse only
// ------------------------------------
function initPanels() {
  const panels = Array.from(document.querySelectorAll(".comparison-panel"));
  const mapWrapper = document.getElementById("mapWrapper");
  const layout = document.getElementById("scrollyLayout");

  if (!panels.length) return;

  function applyFocusState(focusedPanel) {
    // Clear previous state
    panels.forEach(panel => {
      panel.classList.remove("focused", "shrunk");
    });
    layout.classList.remove("focus-left", "focus-right");

    if (!focusedPanel) {
      // Reset: everyone equal, map full height
      if (mapWrapper) mapWrapper.classList.remove("map-compressed");
      return;
    }

    // One panel is focused, others shrunk
    panels.forEach(panel => {
      if (panel === focusedPanel) {
        panel.classList.add("focused");
      } else {
        panel.classList.add("shrunk");
      }
    });

    // Decide which side to enlarge, based on which rail contains the panel
    const rail = focusedPanel.closest("#leftRail, #rightRail");
    if (rail) {
      if (rail.id === "leftRail") {
        layout.classList.add("focus-left");
      } else if (rail.id === "rightRail") {
        layout.classList.add("focus-right");
      }
    }

    if (mapWrapper) {
      mapWrapper.classList.add("map-compressed");
    }
  }

  panels.forEach(panel => {
    const header = panel.querySelector(".panel-header");
    if (!header) return;

    // collapse button: just folds body
    const hideBtn = panel.querySelector(".panel-hide");
    if (hideBtn) {
      hideBtn.addEventListener("click", () => {
        panel.classList.toggle("collapsed");
      });
    }

    // expand/focus button: mirrors your old toggleSVGSize logic
    const expandBtn = panel.querySelector(".panel-expand");
    if (expandBtn) {
      expandBtn.addEventListener("click", () => {
        const isFocused = panel.classList.contains("focused");
        if (isFocused) {
          // clicking again on the focused one clears focus
          applyFocusState(null);
        } else {
          applyFocusState(panel);
        }
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
  async () => {
    setSceneText(0);
    mapController.setBivariate(false);
    if (currentCity !== "london") {
      await mapController.setCity("london");
      currentCity = "london";
    }
    mapController.setLayer("lst_night", { animate: false });
    await mapController.setlcBorder(false);

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
  async () => {
    setSceneText(1);
    mapController.setBivariate(false);
    if (currentCity !== "london") {
      await mapController.setCity("london");
      currentCity = "london";
    }
    await mapController.setlcBorder(false);

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

    mapController.setLayer("lst_night", { animate: true });

    showWardCompare(true);
    showCityCompare(false);
    showUhiCompare(false); 
  },

  // 2: Day vs night heat (still London)
  async () => {
    setSceneText(2);
    mapController.setBivariate(false);
    if (currentCity !== "london") {
      await mapController.setCity("london");
      currentCity = "london";
    }
    await mapController.setlcBorder(false);

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
  async () => {
    setSceneText(3);
    mapController.setBivariate(false);
    if (currentCity !== "london") {
      await mapController.setCity("london");
      currentCity = "london";
    }
    mapController.setLayer("ndvi", { animate: true });
    await mapController.setlcBorder(false);

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
  async () => {
    setSceneText(4);
    mapController.setBivariate(false);
    if (currentCity !== "tokyo") {
      await mapController.setCity("tokyo");
      currentCity = "tokyo";
    }
    mapController.setLayer("ndvi", { animate: true });
    await mapController.setlcBorder(false);

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

  // 5: Land cover
  async () => {
    setSceneText(5);
    mapController.setBivariate(false);
    if (currentCity !== "tokyo") {
      await mapController.setCity("tokyo");
      currentCity = "tokyo";
    }
    await mapController.setlcBorder(false);
    mapController.setLayer("lc", { animate: true });
    mapController.setTempUnit("C");

    // 🔑 now city toggle row makes sense
    mapController.setControlsVisibility({
      showCityToggle: true,
      showUnitToggle: true,
      showCorrPanel: false,
      showBrushControls: false,
      showSimSummary: false
    });

    setLayerControls(
      [
        { id: "lc",   label: "Land Cover Type" },
        { id: "lst_day",   label: "Daytime Temp." },
        { id: "lst_night", label: "Nighttime Temp." }
      ],
      "lc"
    );

    showWardCompare(false);
    showCityCompare(false);
  },

  // 6: What-if greenness simulator – NDVI, painting on
  async () => {
    setSceneText(6);
    mapController.setBivariate(false);
    if (currentCity !== "tokyo") {
      await mapController.setCity("tokyo");
      currentCity = "tokyo";
    }
    await mapController.setlcBorder(false);
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

  // 7: Inter-neighborhood across cities
  async () => {
    setSceneText(7);
    await mapController.setBivariate(false); // Wait for bivariate→univariate switch to complete
    if (currentCity !== "tokyo") {
      await mapController.setCity("tokyo");
      currentCity = "tokyo";
    }

    await mapController.setlcBorder(false);
    // Immediately set the layer after turning off bivariate
    mapController.setLayer("lst_day", { animate: true });

    mapController.setControlsVisibility({
      showCityToggle: true,
      showUnitToggle: true,
      showCorrPanel: true,
      showBrushControls: true,
      showSimSummary: true
    });

    setLayerControls(
      [
        { id: "lst_day",   label: "Daytime Temp." },
        { id: "ndvi",      label: "Vegetation" }
      ],
      "lst_day"
    );

    showWardCompare(true);
    showCityCompare(true);
    showUhiCompare(true);
  },

  // 8: Final bivariate view + inter-city chart
  async () => {
    setSceneText(8);
    if (currentCity !== "tokyo") {
      await mapController.setCity("tokyo");
      currentCity = "tokyo";
    }
    await mapController.setBivariate(true, { var1: "ndvi", var2: "lst_day" });
    await mapController.setlcBorder(true);

    mapController.setControlsVisibility({
      showCityToggle: true,
      showUnitToggle: true,
      showCorrPanel: false,     // too much when bivariate
      showBrushControls: true,
      showSimSummary: true
    });

    setLayerControls([], null);

    showWardCompare(true);
    showCityCompare(true);
    showUhiCompare(true);
  }
];

// ------------------------------------
// Scrollama wiring
// ------------------------------------
function initScroller() {
  const Scrollama = window.scrollama;
  if (!Scrollama) {
    console.error("Scrollama is not available on window. Check script order.");
    return;
  }

  const scroller = Scrollama();
  console.log("[scrolly] Scrollama initialized");

  scroller
    .setup({
      step: "#scrollTriggers .step",
      offset: 0.6,
      debug: false   // show markers
    })
    .onStepEnter(async response => {
      const idx = Number(response.element.dataset.scene);
      const direction = response.direction;
      console.log("[scrolly] step enter:", idx, "direction:", direction);
      
      // Update scene number before triggering the scene
      if (mapController) {
        mapController.setSceneNumber(idx);
      }

      const fn = scenes[idx];
      if (fn && mapController) {
        try {
          console.log("[scrolly] running scene", idx);
          await fn();
        } catch (err) {
          console.error("[scrolly] error in scene", idx, err);
        }
      } else {
        console.warn("[scrolly] no scene fn or mapController for idx", idx);
      }
    });

  window.addEventListener("resize", () => {
    console.log("[scrolly] resize");
    scroller.resize();
  });
}

// ------------------------------------
// Boot
// ------------------------------------
(async function main() {
  try {
    console.log("[scrolly] main() starting");

    // 1. Initialize map + controller
    await initMainMap();
    console.log("[scrolly] map initialized", !!mapController);

    // 2. Expose globally for other scripts
    window.mapController = mapController;
  
    // Set initial scene number before applying the scene
    //mapController.setSceneNumber(activeSceneIndex);

    // 3. Set default temp unit if method exists
    if (mapController && typeof mapController.setTempUnit === "function") {
      mapController.setTempUnit("C");
      console.log("[scrolly] setTempUnit -> C");
    } else {
      console.warn("[scrolly] mapController.setTempUnit missing");
    }

    // 4. Panels (expand/collapse behavior)
    initPanels();
    console.log("[scrolly] panels initialized");

    // 5. Scrollama wiring
    initScroller();
    console.log("[scrolly] scroller initialized");

    // 6. Force scene 0 on load so overlay isn’t blank
    if (scenes[0] && mapController) {
      console.log("[scrolly] running initial scene 0");
      await scenes[0]();
    }

    // 7. Reset button: full page reset
    const resetBtn = document.getElementById("mapResetButton");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        window.location.reload();
      });
    }
  } catch (err) {
    console.error("[scrolly] fatal error in main()", err);
  }

  // Add hover behavior to overlayText to allow tooltip interaction
  const overlayText = document.getElementById("overlayText");
  if (overlayText) {
    let checkInterval = null;
    
    overlayText.addEventListener("mouseenter", () => {
      // Fade out and disable pointer events
      overlayText.style.opacity = "0";
      overlayText.style.pointerEvents = "none";
      
      // Start checking mouse position
      checkInterval = setInterval(() => {
        const rect = overlayText.getBoundingClientRect();
        const mouseX = window.event?.clientX || 0;
        const mouseY = window.event?.clientY || 0;
        
        // Check if mouse is outside the box
        const isOutside = mouseX < rect.left || mouseX > rect.right || 
                         mouseY < rect.top || mouseY > rect.bottom;
        
        if (isOutside) {
          // Fade back in and restore pointer events
          overlayText.style.opacity = "1";
          overlayText.style.pointerEvents = "auto";
          clearInterval(checkInterval);
          checkInterval = null;
        }
      }, 50); // Check every 50ms
    });
    
    // Track mouse position globally for the interval check
    document.addEventListener("mousemove", (e) => {
      window.event = e;
    });
  }
})();