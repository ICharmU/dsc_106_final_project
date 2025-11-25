// London Boroughs Map using Leaflet.js
class LondonBoroughsMap {
    constructor() {
        this.map = null;
        this.boroughsLayer = null;
        this.ndviOverlay = null;
        this.svg = null;
        this.g = null;
        this.plotSvg = null;
        this.boroughNDVIData = {}; // Store NDVI values for each borough
        this.boroughsGeoJSON = null; // Store borough boundaries
    }

    async init() {
        try {
            // Initialize the map
            this.map = L.map('londonViz', {
                center: [51.5074, -0.1278], // London center
                zoom: 10,
                zoomControl: true,
                attributionControl: false
            });

            // Add base map tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 18,
                attribution: '© OpenStreetMap contributors'
            }).addTo(this.map);

            // Set up D3 SVG overlay for NDVI data (load first so it's underneath)
            this.setupD3Overlay();

            // Load London boroughs GeoJSON data FIRST (so we have boundaries for pixel assignment)
            await this.loadBoroughsData();

            // Load and display NDVI data (this will assign pixels to boroughs)
            await this.loadNDVIData();

            // Initialize the borough plot
            this.initializeBoroughPlot();

            console.log("London Boroughs map initialized successfully");
        } catch (error) {
            console.error("Error initializing London Boroughs map:", error);
        }
    }

    async loadBoroughsData() {
        // Try multiple GeoJSON sources for London boroughs
        const sources = [
            'https://raw.githubusercontent.com/radoi90/london-boroughs-geojson/master/london_boroughs.geojson',
            'https://opendata.arcgis.com/datasets/8edafbe3276d4b56aec60991cbddda50_4.geojson',
            'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/json/administrative/eng/lad.json'
        ];

        for (let source of sources) {
            try {
                console.log(`Attempting to load from: ${source}`);
                const response = await fetch(source);
                
                if (response.ok) {
                    const boroughsData = await response.json();
                    
                    // Filter for London boroughs if needed
                    if (source.includes('lad.json')) {
                        // This source has all UK local authorities, filter for London
                        boroughsData.features = boroughsData.features.filter(feature => 
                            feature.properties.LAD13NM && 
                            (feature.properties.LAD13NM.includes('London') ||
                             ['Westminster', 'Camden', 'Islington', 'Hackney', 'Tower Hamlets', 
                              'Greenwich', 'Lewisham', 'Southwark', 'Lambeth', 'Wandsworth',
                              'Hammersmith and Fulham', 'Kensington and Chelsea', 'Brent',
                              'Ealing', 'Hounslow', 'Richmond upon Thames', 'Kingston upon Thames',
                              'Merton', 'Sutton', 'Croydon', 'Bromley', 'Bexley', 'Havering',
                              'Barking and Dagenham', 'Redbridge', 'Newham', 'Waltham Forest',
                              'Haringey', 'Enfield', 'Barnet', 'Harrow', 'Hillingdon', 'City of London'].includes(feature.properties.LAD13NM))
                        );
                    }
                    
                    console.log(`Successfully loaded ${boroughsData.features.length} boroughs`);
                    this.createBoroughsLayer(boroughsData);
                    return;
                } else {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            } catch (sourceError) {
                console.warn(`Failed to load from ${source}:`, sourceError);
            }
        }
        
        // If all sources fail, throw error
        throw new Error("All GeoJSON data sources failed to load. Please check network connectivity and data source availability.");
    }



    createBoroughsLayer(data) {
        // Store borough boundaries for later use
        this.boroughsGeoJSON = data;
        
        // Normalize borough names for consistency
        this.boroughsGeoJSON.features.forEach(feature => {
            const props = feature.properties;
            // Ensure 'name' property exists consistently
            if (!props.name) {
                props.name = props.NAME || props.LAD13NM || 'Unknown';
            }
        });
        
        // Get population values for color scaling
        const populations = data.features.map(f => f.properties.population || 0);
        const minPop = Math.min(...populations);
        const maxPop = Math.max(...populations);

        // Create the boroughs layer
        this.boroughsLayer = L.geoJSON(data, {
            style: (feature) => {
                return {
                    fillColor: 'transparent', // No fill color
                    weight: 2, // Border thickness
                    opacity: 1, // Full opacity for borders
                    color: '#000000', // Black border color
                    dashArray: '',
                    fillOpacity: 0 // No fill opacity
                };
            },
            onEachFeature: (feature, layer) => {
                const boroughName = feature.properties.name;
                
                // Add hover effects and tooltip
                layer.on({
                    mouseover: (e) => {
                        const layer = e.target;
                        layer.setStyle({
                            weight: 5,
                            color: '#666',
                            dashArray: '',
                            fillOpacity: 0.8
                        });
                        layer.bringToFront();
                        
                        // Show tooltip with borough name and pixel count
                        const pixelCount = this.boroughNDVIData[boroughName]?.length || 0;
                        
                        const tooltip = d3.select("body")
                            .selectAll(".borough-tooltip")
                            .data([boroughName]);
                        
                        tooltip.enter()
                            .append("div")
                            .attr("class", "borough-tooltip")
                            .style("position", "absolute")
                            .style("background", "rgba(0,0,0,0.85)")
                            .style("color", "white")
                            .style("padding", "8px 12px")
                            .style("border-radius", "4px")
                            .style("font-size", "13px")
                            .style("font-family", "Arial, sans-serif")
                            .style("pointer-events", "none")
                            .style("z-index", "2000")
                            .style("box-shadow", "0 2px 4px rgba(0,0,0,0.3)");
                        
                        d3.select(".borough-tooltip")
                            .style("left", (e.originalEvent.pageX + 15) + "px")
                            .style("top", (e.originalEvent.pageY - 10) + "px")
                            .style("opacity", 1)
                            .html(`<strong>${boroughName}</strong><br/>${pixelCount} pixels`);
                    },
                    mouseout: (e) => {
                        this.boroughsLayer.resetStyle(e.target);
                        d3.select(".borough-tooltip").style("opacity", 0);
                    },
                    mousemove: (e) => {
                        // Update tooltip position as mouse moves
                        d3.select(".borough-tooltip")
                            .style("left", (e.originalEvent.pageX + 15) + "px")
                            .style("top", (e.originalEvent.pageY - 10) + "px");
                    },
                    click: (e) => {
                        // Display borough details without zooming
                        this.displayBoroughDetails(feature.properties);
                    }
                });
            }
        }).addTo(this.map);

        // Bring borough layer to front to ensure it's on top
        this.boroughsLayer.bringToFront();

        // Fit map to borough bounds
        this.map.fitBounds(this.boroughsLayer.getBounds(), { padding: [10, 10] });

        // Add legend
        this.addLegend(minPop, maxPop);
    }

    getColor(intensity) {
        // Color scale from light orange to dark red
        const colors = [
            '#feedde',
            '#fdd0a2',
            '#fdae6b',
            '#fd8d3c',
            '#f16913',
            '#d94801',
            '#8c2d04'
        ];
        
        const index = Math.floor(intensity * (colors.length - 1));
        return colors[Math.min(index, colors.length - 1)];
    }

    addLegend(minPop, maxPop) {
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'info legend');
            const grades = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
            
            div.innerHTML = '<h4>Population Density</h4>';
            
            for (let i = 0; i < grades.length; i++) {
                const intensity = grades[i];
                const pop = Math.round(minPop + (maxPop - minPop) * intensity);
                
                div.innerHTML +=
                    '<i style="background:' + this.getColor(intensity) + '; width: 18px; height: 18px; float: left; margin-right: 8px; opacity: 0.7; border: 1px solid #ccc;"></i> ' +
                    pop.toLocaleString() + (grades[i + 1] ? '&ndash;' + Math.round(minPop + (maxPop - minPop) * grades[i + 1]).toLocaleString() + '<br>' : '+');
            }
            
            return div;
        }.bind(this);

        legend.addTo(this.map);
    }

    setupD3Overlay() {
        // Create SVG overlay on the map - use overlayPane which sits between tiles and vectors
        this.svg = d3.select(this.map.getPanes().overlayPane)
            .append("svg")
            .style("pointer-events", "auto")
            .style("z-index", "200"); // Lower z-index so boroughs appear on top

        this.g = this.svg.append("g")
            .attr("class", "ndvi-overlay");

        // Update SVG on map events
        const reset = () => {
            const bounds = this.map.getBounds();
            const topLeft = this.map.latLngToLayerPoint(bounds.getNorthWest());
            const bottomRight = this.map.latLngToLayerPoint(bounds.getSouthEast());

            this.svg.attr("width", bottomRight.x - topLeft.x)
                .attr("height", bottomRight.y - topLeft.y)
                .style("left", topLeft.x + "px")
                .style("top", topLeft.y + "px");

            this.g.attr("transform", `translate(${-topLeft.x},${-topLeft.y})`);
        };

        this.map.on("viewreset", reset);
        this.map.on("zoomend", reset);
        reset();
    }

    async loadNDVIData() {
        try {
            console.log("Loading NDVI data from GeoTIFF...");
            
            // Load the GeoTIFF file
            const response = await fetch('data/london/london_NDVI_2020_summer.tif');
            if (!response.ok) {
                throw new Error(`Failed to load NDVI data: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
            const image = await tiff.getImage();
            
            // Get image metadata
            const width = image.getWidth();
            const height = image.getHeight();
            const bbox = image.getBoundingBox();
            
            console.log(`NDVI image dimensions: ${width}x${height}`);
            console.log(`Bounding box:`, bbox);

            // Read the raster data
            const rasters = await image.readRasters();
            const rawData = rasters[0]; // First band

            // Check if data needs scaling (common for MODIS NDVI data)
            console.log("Raw data sample:", rawData.slice(0, 10));
            
            // Convert MODIS NDVI values to proper scale
            // MODIS NDVI is typically stored with scale factor (often 0.0001 and range 0-10000)
            const data = new Float32Array(rawData.length);
            for (let i = 0; i < rawData.length; i++) {
                if (rawData[i] === null || rawData[i] === undefined || isNaN(rawData[i]) || rawData[i] < -1000 || rawData[i] > 10000) {
                    data[i] = NaN; // No data values
                } else {
                    // Convert from MODIS scale (0-10000) to standard NDVI (-1 to 1)
                    const ndvi = rawData[i] * 0.0001;
                    // Clamp to valid NDVI range
                    data[i] = Math.max(-1, Math.min(1, ndvi));
                }
            }

            console.log("Scaled data sample:", data.slice(0, 10));

            // Validate data after scaling
            this.validateNDVIData(data, width, height);

            // Create grid of squares for visualization
            this.createNDVIGrid(data, width, height, bbox);
            
        } catch (error) {
            console.error("Error loading NDVI data:", error);
            throw new Error(`Failed to load NDVI overlay: ${error.message}`);
        }
    }

    validateNDVIData(data, width, height) {
        let validCount = 0;
        let nanCount = 0;
        let nullCount = 0;
        let outOfRangeCount = 0;
        let validValues = [];
        
        console.log("Validating NDVI data...");
        console.log(`Total pixels: ${data.length}`);
        console.log(`Expected pixels (width × height): ${width * height}`);
        
        // Sample first 1000 values for detailed analysis
        const sampleSize = Math.min(1000, data.length);
        console.log(`Analyzing first ${sampleSize} values:`);
        
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            
            if (value === null || value === undefined) {
                nullCount++;
            } else if (isNaN(value)) {
                nanCount++;
            } else if (value < -1 || value > 1) {
                outOfRangeCount++;
                if (i < sampleSize) {
                    console.log(`Out of range value at index ${i}: ${value}`);
                }
            } else {
                validCount++;
                if (validValues.length < 100) {
                    validValues.push(value);
                }
            }
            
            // Log sample of raw values
            if (i < 20) {
                console.log(`data[${i}] = ${value} (type: ${typeof value})`);
            }
        }
        
        console.log(`Data validation results:`);
        console.log(`- Valid values: ${validCount} (${(validCount/data.length*100).toFixed(2)}%)`);
        console.log(`- NaN values: ${nanCount} (${(nanCount/data.length*100).toFixed(2)}%)`);
        console.log(`- Null values: ${nullCount} (${(nullCount/data.length*100).toFixed(2)}%)`);
        console.log(`- Out of range values: ${outOfRangeCount} (${(outOfRangeCount/data.length*100).toFixed(2)}%)`);
        
        if (validValues.length > 0) {
            const min = Math.min(...validValues);
            const max = Math.max(...validValues);
            const avg = validValues.reduce((a, b) => a + b, 0) / validValues.length;
            console.log(`Valid value statistics: min=${min.toFixed(3)}, max=${max.toFixed(3)}, avg=${avg.toFixed(3)}`);
            console.log(`Sample valid values:`, validValues.slice(0, 10));
        }
        
        if (validCount === 0) {
            throw new Error("No valid NDVI values found in the dataset. All values are NaN, null, or out of range.");
        }
        
        if (validCount < data.length * 0.1) {
            console.warn(`Warning: Only ${(validCount/data.length*100).toFixed(2)}% of values are valid. This may result in sparse visualization.`);
        }
        
        return {
            validCount,
            nanCount,
            nullCount,
            outOfRangeCount,
            validPercentage: validCount / data.length * 100
        };
    }

    createNDVIGrid(data, width, height, bbox) {
        // Calculate cell size
        const cellWidth = (bbox[2] - bbox[0]) / width;
        const cellHeight = (bbox[3] - bbox[1]) / height;
        
        // Sample data at reduced resolution for performance
        const sampleFactor = Math.max(1, Math.floor(Math.min(width, height) / 100));
        const squares = [];

        // Get valid NDVI values for color scale
        const validValues = [];
        let skippedCount = 0;
        
        for (let i = 0; i < data.length; i += sampleFactor) {
            const value = data[i];
            if (value !== null && value !== undefined && !isNaN(value) && value >= -1 && value <= 1) {
                validValues.push(value);
            } else {
                skippedCount++;
            }
        }

        console.log(`Sampled ${Math.floor(data.length / sampleFactor)} pixels, found ${validValues.length} valid values, skipped ${skippedCount}`);

        if (validValues.length === 0) {
            throw new Error("No valid NDVI values found after sampling. Cannot create visualization.");
        }

        const minNDVI = Math.min(...validValues);
        const maxNDVI = Math.max(...validValues);
        console.log(`NDVI range from valid samples: ${minNDVI.toFixed(3)} to ${maxNDVI.toFixed(3)}`);

        // Create binned NDVI classes based on vegetation interpretation (matching heat_inequality.js)
        const ndviBins = [
            { min: -1.0, max: -0.1, color: '#ffffff' },
            { min: -0.1, max: 0.0, color: '#ce7e45' },
            { min: 0.0, max: 0.1, color: '#df923d' },
            { min: 0.1, max: 0.2, color: '#f1b555' },
            { min: 0.2, max: 0.3, color: '#fcd163' },
            { min: 0.3, max: 0.4, color: '#99b718' },
            { min: 0.4, max: 0.5, color: '#74a901' },
            { min: 0.5, max: 0.6, color: '#66a000' },
            { min: 0.6, max: 0.7, color: '#529400' },
            { min: 0.7, max: 0.8, color: '#207401' },
            { min: 0.8, max: 0.9, color: '#056201' },
            { min: 0.9, max: 1.0, color: '#004c00' }
        ];
        
        // Function to get color for any NDVI value
        function getNDVIColor(value) {
            if (isNaN(value) || value === null || value === undefined) {
                return '#000000';
            }
            for (let i = 0; i < ndviBins.length; i++) {
                if (value >= ndviBins[i].min && (i === ndviBins.length - 1 ? value <= ndviBins[i].max : value < ndviBins[i].max)) {
                    return ndviBins[i].color;
                }
            }
            if (value < ndviBins[0].min) return ndviBins[0].color;
            if (value > ndviBins[ndviBins.length - 1].max) return ndviBins[ndviBins.length - 1].color;
            return '#808080';
        }
        
        const colorScale = getNDVIColor;

        // Create squares from sampled data
        let createdSquares = 0;
        let skippedSquares = 0;
        
        for (let y = 0; y < height; y += sampleFactor) {
            for (let x = 0; x < width; x += sampleFactor) {
                const index = y * width + x;
                const value = data[index];
                
                // Skip invalid values with detailed logging for first few
                if (value === null || value === undefined || isNaN(value) || value < -1 || value > 1) {
                    skippedSquares++;
                    if (skippedSquares <= 5) {
                        console.log(`Skipping pixel at (${x},${y}), index ${index}: value=${value}, type=${typeof value}`);
                    }
                    continue;
                }
                
                createdSquares++;

                // Calculate geographic coordinates
                const lon1 = bbox[0] + (x * cellWidth);
                const lat1 = bbox[1] + ((height - y - 1) * cellHeight); // Flip Y coordinate
                const lon2 = lon1 + (cellWidth * sampleFactor);
                const lat2 = lat1 + (cellHeight * sampleFactor);

                squares.push({
                    x1: lon1,
                    y1: lat1,
                    x2: lon2,
                    y2: lat2,
                    value: value,
                    color: colorScale(value)
                });
            }
        }

        console.log(`Processing complete: created ${createdSquares} squares, skipped ${skippedSquares} invalid pixels`);
        console.log(`Final squares array length: ${squares.length}`);

        if (squares.length === 0) {
            throw new Error("No valid squares could be created from NDVI data. All sampled pixels contain invalid values.");
        }

        this.renderNDVISquares(squares);
        this.addNDVILegend(minNDVI, maxNDVI, colorScale);
        
        // Assign pixels to boroughs
        this.assignPixelsToBoroughs(squares);
    }

    renderNDVISquares(squares) {
        // Clear existing squares
        this.g.selectAll(".ndvi-square").remove();

        // Function to update square positions
        const updateSquares = () => {
            this.g.selectAll(".ndvi-square")
                .attr("x", d => this.map.latLngToLayerPoint([d.y1, d.x1]).x)
                .attr("y", d => this.map.latLngToLayerPoint([d.y2, d.x1]).y)
                .attr("width", d => {
                    const p1 = this.map.latLngToLayerPoint([d.y1, d.x1]);
                    const p2 = this.map.latLngToLayerPoint([d.y1, d.x2]);
                    return Math.abs(p2.x - p1.x);
                })
                .attr("height", d => {
                    const p1 = this.map.latLngToLayerPoint([d.y1, d.x1]);
                    const p2 = this.map.latLngToLayerPoint([d.y2, d.x1]);
                    return Math.abs(p2.y - p1.y);
                });
        };

        // Create squares
        this.g.selectAll(".ndvi-square")
            .data(squares)
            .enter()
            .append("rect")
            .attr("class", "ndvi-square")
            .style("fill", d => d.color)
            .style("opacity", 0.7)
            .style("stroke", "none")
            .on("mouseover", function(event, d) {
                d3.select(this).style("stroke", "#333").style("stroke-width", 1);
                
                // Show tooltip
                const tooltip = d3.select("body")
                    .selectAll(".ndvi-tooltip")
                    .data([d]);
                
                tooltip.enter()
                    .append("div")
                    .attr("class", "ndvi-tooltip")
                    .style("position", "absolute")
                    .style("background", "rgba(0,0,0,0.8)")
                    .style("color", "white")
                    .style("padding", "5px")
                    .style("border-radius", "3px")
                    .style("font-size", "12px")
                    .style("pointer-events", "none")
                    .style("z-index", "1000");
                
                d3.select(".ndvi-tooltip")
                    .style("left", (event.pageX + 10) + "px")
                    .style("top", (event.pageY - 10) + "px")
                    .style("opacity", 1)
                    .html(`NDVI: ${d.value.toFixed(3)}<br/>Vegetation: ${d.value > 0.3 ? 'Dense' : d.value > 0.1 ? 'Moderate' : 'Sparse'}`);
            })
            .on("mouseout", function(event, d) {
                d3.select(this).style("stroke", "none");
                d3.select(".ndvi-tooltip").style("opacity", 0);
            });

        // Initial positioning
        updateSquares();

        // Update on map events
        this.map.on("viewreset zoomend", updateSquares);
    }

    addNDVILegend(minNDVI, maxNDVI, colorScale) {
        const ndviLegend = L.control({ position: 'bottomleft' });

        ndviLegend.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'info ndvi-legend');
            const steps = 5;
            
            div.innerHTML = '<h4>NDVI (Vegetation)</h4>';
            
            for (let i = 0; i <= steps; i++) {
                const value = minNDVI + (maxNDVI - minNDVI) * i / steps;
                const color = colorScale(value);
                const label = value.toFixed(2);
                
                div.innerHTML +=
                    `<div style="margin: 2px 0;">
                        <i style="background:${color}; width: 18px; height: 18px; float: left; margin-right: 8px; border: 1px solid #ccc;"></i>
                        ${label}
                    </div>`;
            }
            
            div.innerHTML += '<div style="clear: both; font-size: 10px; color: #666; margin-top: 5px;">Higher values = more vegetation</div>';
            
            return div;
        };

        ndviLegend.addTo(this.map);
    }

    assignPixelsToBoroughs(squares) {
        if (!this.boroughsGeoJSON) {
            console.warn("Borough boundaries not loaded yet");
            return;
        }

        console.log("Assigning pixels to boroughs...");
        console.log(`Total squares to process: ${squares.length}`);
        console.log(`Total boroughs: ${this.boroughsGeoJSON.features.length}`);
        
        // Initialize NDVI data storage for each borough
        this.boroughsGeoJSON.features.forEach(feature => {
            const boroughName = feature.properties.name;
            this.boroughNDVIData[boroughName] = [];
            console.log(`Initialized borough: ${boroughName}`);
        });

        // Check each pixel (square) against each borough
        let assignedCount = 0;
        let multiAssignedCount = 0;
        
        squares.forEach((square, index) => {
            // Check all 5 points: 4 corners + center
            // This ensures we catch pixels that partially overlap with a borough
            const testPoints = [
                [square.x1, square.y1],           // bottom-left corner
                [square.x2, square.y1],           // bottom-right corner
                [square.x1, square.y2],           // top-left corner
                [square.x2, square.y2],           // top-right corner
                [(square.x1 + square.x2) / 2, (square.y1 + square.y2) / 2]  // center
            ];
            
            let boroughsForThisPixel = new Set();
            
            // Check which borough(s) contain any part of this pixel
            this.boroughsGeoJSON.features.forEach(feature => {
                const boroughName = feature.properties.name;
                
                // Check if any of the test points fall within the borough
                const pixelOverlaps = testPoints.some(point => 
                    this.isPointInPolygon(point, feature.geometry)
                );
                
                if (pixelOverlaps) {
                    boroughsForThisPixel.add(boroughName);
                }
            });
            
            // Add pixel value to all overlapping boroughs
            boroughsForThisPixel.forEach(boroughName => {
                this.boroughNDVIData[boroughName].push(square.value);
            });
            
            if (boroughsForThisPixel.size > 0) {
                assignedCount++;
                if (boroughsForThisPixel.size > 1) {
                    multiAssignedCount++;
                }
            }
            
            // Log progress for first few pixels
            if (index < 10) {
                const centerLng = (square.x1 + square.x2) / 2;
                const centerLat = (square.y1 + square.y2) / 2;
                console.log(`Pixel ${index} at (${centerLng.toFixed(4)}, ${centerLat.toFixed(4)}), bounds: [${square.x1.toFixed(4)}, ${square.y1.toFixed(4)}, ${square.x2.toFixed(4)}, ${square.y2.toFixed(4)}], NDVI=${square.value.toFixed(3)}, Boroughs: ${Array.from(boroughsForThisPixel).join(', ') || 'none'}`);
            }
        });

        // Log summary statistics
        console.log(`Pixel assignment complete:`);
        console.log(`- Total pixels: ${squares.length}`);
        console.log(`- Assigned to at least one borough: ${assignedCount} (${(assignedCount/squares.length*100).toFixed(1)}%)`);
        console.log(`- Assigned to multiple boroughs: ${multiAssignedCount}`);
        
        // Log NDVI data per borough
        Object.keys(this.boroughNDVIData).forEach(boroughName => {
            const values = this.boroughNDVIData[boroughName];
            if (values.length > 0) {
                const avg = values.reduce((a, b) => a + b, 0) / values.length;
                const min = Math.min(...values);
                const max = Math.max(...values);
                console.log(`${boroughName}: ${values.length} pixels, NDVI range: [${min.toFixed(3)}, ${max.toFixed(3)}], avg: ${avg.toFixed(3)}`);
            }
        });
    }

    isPointInPolygon(point, geometry) {
        // Simple point-in-polygon algorithm (ray casting)
        const [lng, lat] = point;
        
        if (geometry.type === 'Polygon') {
            return this.pointInPolygonRing(lng, lat, geometry.coordinates[0]);
        } else if (geometry.type === 'MultiPolygon') {
            // Check if point is in any of the polygons
            return geometry.coordinates.some(polygon => 
                this.pointInPolygonRing(lng, lat, polygon[0])
            );
        }
        
        return false;
    }

    pointInPolygonRing(lng, lat, ring) {
        // Ray casting algorithm
        let inside = false;
        
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            
            const intersect = ((yi > lat) !== (yj > lat)) &&
                (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
            
            if (intersect) inside = !inside;
        }
        
        return inside;
    }

    initializeBoroughPlot() {
        const width = 800;
        const height = 400;
        
        const plotContainer = d3.select("#boroughPlot");
        
        // Create SVG for the plot
        this.plotSvg = plotContainer
            .append("svg")
            .attr("width", width)
            .attr("height", height)
            .style("background", "#f9f9f9")
            .style("border", "1px solid #ddd")
            .style("border-radius", "5px")
            .style("margin-top", "20px");

        // Add placeholder text
        this.plotSvg.append("text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .style("font-size", "18px")
            .style("fill", "#999")
            .attr("class", "placeholder-text")
            .text("Click on a borough to view details");

        // Add placeholder text box under the SVG
        plotContainer
            .append("div")
            .attr("class", "borough-info-placeholder")
            .style("width", width + "px")
            .style("height", "60px")
            .style("background", "#f0f0f0")
            .style("border", "1px solid #ccc")
            .style("border-radius", "4px")
            .style("margin-top", "10px")
            .style("display", "flex")
            .style("align-items", "center")
            .style("justify-content", "center")
            .style("font-size", "13px")
            .style("color", "#666")
            .style("font-style", "italic")
            .text("This needs a little work, but I'm going to go from all of London histogram --> specific borough histogram. I will highlight different districts (e.g. business/farming/...)");
    }

    displayBoroughDetails(properties) {
        if (!this.plotSvg) {
            console.warn('Borough plot not initialized');
            return;
        }

        // Extract borough name (already normalized in createBoroughsLayer)
        const name = properties.name;
        
        // Debug: Log all available borough names in the data
        console.log('Available boroughs in NDVI data:', Object.keys(this.boroughNDVIData));
        console.log('Looking for borough:', name);
        console.log('Properties object:', properties);
        
        // Get NDVI values for this borough
        const ndviValues = this.boroughNDVIData[name] || [];
        
        console.log(`Displaying details for ${name}: ${ndviValues.length} pixels`);

        // Clear previous content
        this.plotSvg.selectAll("*").remove();

        const width = 800;
        const height = 400;
        const margin = { top: 60, right: 40, bottom: 60, left: 60 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

        // Add borough name as title
        this.plotSvg.append("text")
            .attr("x", width / 2)
            .attr("y", 25)
            .attr("text-anchor", "middle")
            .style("font-size", "24px")
            .style("font-weight", "bold")
            .style("fill", "#333")
            .text(name);

        // Check if we have data
        const pixelCount = ndviValues.length;
        
        if (pixelCount === 0) {
            this.plotSvg.append("text")
                .attr("x", width / 2)
                .attr("y", height / 2)
                .attr("text-anchor", "middle")
                .style("font-size", "18px")
                .style("fill", "#666")
                .text("No NDVI data available for this borough");
            return;
        }

        // Calculate statistics
        const mean = d3.mean(ndviValues);
        const min = d3.min(ndviValues);
        const max = d3.max(ndviValues);
        
        // Add statistics subtitle
        this.plotSvg.append("text")
            .attr("x", width / 2)
            .attr("y", 50)
            .attr("text-anchor", "middle")
            .style("font-size", "13px")
            .style("fill", "#666")
            .text(`Pixels: ${pixelCount} | Mean: ${mean.toFixed(3)} | Range: [${min.toFixed(3)}, ${max.toFixed(3)}]`);

        // Create histogram using d3.bin()
        const histogram = d3.bin()
            .domain([min, max])
            .thresholds(25); // 25 bins for good granularity
        
        const bins = histogram(ndviValues);
        
        console.log(`Created ${bins.length} histogram bins for ${name}`);

        // Create chart group
        const g = this.plotSvg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Create scales
        const x = d3.scaleLinear()
            .domain([bins[0].x0, bins[bins.length - 1].x1])
            .range([0, plotWidth]);
        
        const y = d3.scaleLinear()
            .domain([0, d3.max(bins, d => d.length)])
            .nice()
            .range([plotHeight, 0]);
        
        // Create binned NDVI color function matching the map
        const ndviBins = [
            { min: -1.0, max: -0.1, color: '#ffffff' },
            { min: -0.1, max: 0.0, color: '#ce7e45' },
            { min: 0.0, max: 0.1, color: '#df923d' },
            { min: 0.1, max: 0.2, color: '#f1b555' },
            { min: 0.2, max: 0.3, color: '#fcd163' },
            { min: 0.3, max: 0.4, color: '#99b718' },
            { min: 0.4, max: 0.5, color: '#74a901' },
            { min: 0.5, max: 0.6, color: '#66a000' },
            { min: 0.6, max: 0.7, color: '#529400' },
            { min: 0.7, max: 0.8, color: '#207401' },
            { min: 0.8, max: 0.9, color: '#056201' },
            { min: 0.9, max: 1.0, color: '#004c00' }
        ];
        
        function getColorForValue(value) {
            if (isNaN(value)) return '#000000';
            for (let i = 0; i < ndviBins.length; i++) {
                if (value >= ndviBins[i].min && (i === ndviBins.length - 1 ? value <= ndviBins[i].max : value < ndviBins[i].max)) {
                    return ndviBins[i].color;
                }
            }
            return '#808080';
        }
        
        const colorScale = getColorForValue;

        // Draw bars
        g.selectAll(".bar")
            .data(bins)
            .enter()
            .append("rect")
            .attr("class", "bar")
            .attr("x", d => x(d.x0) + 1)
            .attr("y", d => y(d.length))
            .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 2))
            .attr("height", d => plotHeight - y(d.length))
            .attr("fill", d => colorScale((d.x0 + d.x1) / 2))
            .attr("stroke", "#333")
            .attr("stroke-width", 0.5)
            .style("opacity", 0.85)
            .style("cursor", "pointer")
            .on("mouseover", function(event, d) {
                d3.select(this).style("opacity", 1);
            })
            .on("mouseout", function(event, d) {
                d3.select(this).style("opacity", 0.85);
            })
            .append("title")
            .text(d => `NDVI: [${d.x0.toFixed(3)}, ${d.x1.toFixed(3)})\nPixels: ${d.length}`);

        // Add x-axis
        g.append("g")
            .attr("transform", `translate(0,${plotHeight})`)
            .call(d3.axisBottom(x).ticks(10))
            .selectAll("text")
            .style("font-size", "11px");
        
        // Add x-axis label
        g.append("text")
            .attr("x", plotWidth / 2)
            .attr("y", plotHeight + 45)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .style("fill", "#333")
            .text("NDVI Value");

        // Add y-axis
        g.append("g")
            .call(d3.axisLeft(y).ticks(8))
            .selectAll("text")
            .style("font-size", "11px");
        
        // Add y-axis label
        g.append("text")
            .attr("transform", "rotate(-90)")
            .attr("x", -plotHeight / 2)
            .attr("y", -45)
            .attr("text-anchor", "middle")
            .style("font-size", "14px")
            .style("fill", "#333")
            .text("Pixel Count");
    }
}

// Add CSS for the legend
const style = document.createElement('style');
style.textContent = `
    .info.legend {
        background: rgba(255,255,255,0.9);
        box-shadow: 0 0 15px rgba(0,0,0,0.2);
        border-radius: 5px;
        padding: 10px;
        font-size: 12px;
        line-height: 18px;
        color: #555;
    }
    .info.legend h4 {
        margin: 0 0 5px;
        color: #777;
    }
    .info.legend i {
        width: 18px;
        height: 18px;
        float: left;
        margin-right: 8px;
        opacity: 0.7;
    }
    .info.ndvi-legend {
        background: rgba(255,255,255,0.9);
        box-shadow: 0 0 15px rgba(0,0,0,0.2);
        border-radius: 5px;
        padding: 10px;
        font-size: 12px;
        line-height: 18px;
        color: #555;
    }
    .info.ndvi-legend h4 {
        margin: 0 0 5px;
        color: #777;
    }
    .ndvi-tooltip {
        font-family: Arial, sans-serif;
    }
    .borough-tooltip {
        font-family: Arial, sans-serif;
    }
    .ndvi-overlay {
        z-index: 200 !important;
    }
    .leaflet-overlay-pane svg {
        z-index: 200 !important;
    }
    #londonViz {
        height: 400px;
        width: 100%;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
`;
document.head.appendChild(style);

// Initialize the map when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    const boroughsMap = new LondonBoroughsMap();
    boroughsMap.init();
});
