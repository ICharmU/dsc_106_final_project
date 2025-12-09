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

/** 
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
      subunit: "Neighborhood",
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
      subunit: "Neighborhood",
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

// ------------------------------------------------------------------
// Multi-city greenness vs temperature map WITH what-if simulator
// ------------------------------------------------------------------

fetch("data/models/ndvi_lst_response_curves.json")
  .then(resp => resp.json())
  .then(models => {
    ndviLstModels = models;

    // Factory for a small "What if NDVI +0.10?" block that
    // gets appended *after* the main tooltip.
    function makeWhatIfTooltip(cityName) {
      return ({ pixel, activeLayer, allLayers, tempUnit, tempSuffix }) => {
        // Find NDVI at this pixel (current value, possibly already painted)
        let ndviVal = null;
        allLayers.forEach(layer => {
          const v = layer.values[pixel.idx];
          if (v == null || !Number.isFinite(v)) return;
          if (layer.id === "ndvi") ndviVal = v;
        });

        if (ndviVal == null || !Number.isFinite(ndviVal)) return "";

        const newNdvi = ndviVal + 0.10;

        // Target temperature layer: whichever is active, default to "day"
        let target = null;
        if (activeLayer.id === "lst_day") target = "day";
        else if (activeLayer.id === "lst_night") target = "night";
        else target = "day";

        const res = estimateLstChangeFromNdvi({
          cityName,
          baseNdvi: ndviVal,
          newNdvi,
          target
        });

        if (!res) return "";

        // res.delta is in °C; convert to display unit (°C or °F)
        const factor = tempUnit === "C" ? 1 : 9 / 5;
        const deltaDisp = res.delta * factor;
        const sign = deltaDisp >= 0 ? "+" : "";
        const srcLabel = res.source === "city-curve"
          ? "city-specific curve"
          : "pooled model";

        return (
          `<div style="margin-top:4px;border-top:1px solid rgba(255,255,255,0.2);padding-top:3px;font-size:11px;opacity:0.9">` +
          `<strong>What if NDVI +0.10?</strong><br>` +
          `${target === "day" ? "Daytime" : "Nighttime"} LST change: ` +
          `${sign}${deltaDisp.toFixed(2)} ${tempSuffix()} ` +
          `<span style="opacity:0.7">(${srcLabel})</span>` +
          `</div>`
        );
      };
    }

    // Now build the actual map, wiring the tooltipFormatter per city
    return createMultiCityGridMap({
      containerId: "#ndvi_heatMap",
      enableNdviPainting: true,
      cityConfigs: [
        {
          id: "tokyo",
          label: "Tokyo",
          gridPath: "data/tokyo/tokyo_grid.json",
          wardStatsPath: "data/tokyo/tokyo_wards.json",
          cityName: "Tokyo",
          subunit: "Ward",
          enableNdviPainting: true, 
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
          showLayerToggle: true,
          tooltipFormatter: makeWhatIfTooltip("Tokyo")
        },
        {
          id: "london",
          label: "London",
          gridPath: "data/london/london_grid.json",
          wardStatsPath: "data/london/london_boroughs.json",
          cityName: "London",
          subunit: "Borough",
          enableNdviPainting: true, 
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
          showLayerToggle: true,
          tooltipFormatter: makeWhatIfTooltip("London")
        },
        {
          id: "nyc",
          label: "New York City",
          gridPath: "data/nyc/nyc_grid.json",
          wardStatsPath: "data/nyc/nyc_boroughs.json",
          cityName: "New York City",
          subunit: "Borough",
          enableNdviPainting: true, 
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
          showLayerToggle: true,
          tooltipFormatter: makeWhatIfTooltip("New York City")
        },
        {
          id: "sandiego",
          label: "San Diego County",
          gridPath: "data/san-diego/sandiego_grid.json",
          wardStatsPath: "data/san-diego/sandiego_boroughs.json",
          cityName: "San Diego County",
          subunit: "Neighborhood",
          enableNdviPainting: true, 
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
          showLayerToggle: true,
          tooltipFormatter: makeWhatIfTooltip("San Diego County")
        }
      ],
      defaultCityId: "tokyo"
    });
  })
  .catch(err => console.error("Error rendering multi-city NDVI/LST map with models:", err));

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
      subunit: "Neighborhood",
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
      subunit: "Neighborhood",
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
 */