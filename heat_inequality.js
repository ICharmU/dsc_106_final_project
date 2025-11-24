// Load and display multiple TIF files using GeoTIFF and D3.js
console.log('Loading TIF images...');

// Get containers only if they exist (optional individual containers)
const lcContainer = document.getElementById('map-landcover');
const lstContainer = document.getElementById('map-lst');
const ndviContainer = document.getElementById('map-ndvi');

// Set loading messages only if containers exist
if (lcContainer) lcContainer.innerHTML = '<h3>Loading libraries...</h3>';
if (lstContainer) lstContainer.innerHTML = '<h3>Loading libraries...</h3>';
if (ndviContainer) ndviContainer.innerHTML = '<h3>Loading libraries...</h3>';

// Load D3.js first
const d3Script = document.createElement('script');
d3Script.src = 'https://d3js.org/d3.v7.min.js';

d3Script.onload = function() {
  console.log('D3.js v7 loaded');
  
  // Then load GeoTIFF
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/geotiff@2.0.7/dist-browser/geotiff.js';

  script.onload = function() {
    console.log('GeoTIFF library loaded from JSDelivr');
    
    // Wait a moment for library to initialize
    setTimeout(() => {
      if (typeof GeoTIFF !== 'undefined') {
        console.log('Both D3.js and GeoTIFF are available!');
        
        // Update containers only if they exist
        if (lcContainer) lcContainer.innerHTML = '<h3>Libraries loaded! Loading Land Cover...</h3>';
        if (lstContainer) lstContainer.innerHTML = '<h3>Libraries loaded! Loading LST...</h3>';
        if (ndviContainer) ndviContainer.innerHTML = '<h3>Libraries loaded! Loading NDVI...</h3>';
        
        // Load all three TIF files
        loadAllTIFFiles();
      } else {
        console.log('GeoTIFF not available, trying alternative...');
        tryAlternativeLibrary();
      }
    }, 500);
  };

  script.onerror = function() {
    console.log('JSDelivr failed, trying alternative...');
    tryAlternativeLibrary();
  };

  document.head.appendChild(script);
};

d3Script.onerror = function() {
  console.log('D3.js loading failed');
  tryAlternativeLibrary();
};

document.head.appendChild(d3Script);

// Fallback function for library loading failures
function tryAlternativeLibrary() {
  console.log('All libraries failed to load');
  [lcContainer, lstContainer, ndviContainer].forEach(container => {
    if (container) container.innerHTML = '<h3 style="color: red;">Error: Required libraries could not be loaded</h3>';
  });
}

// Load all three TIF files
async function loadAllTIFFiles() {
  console.log('Starting to load all TIF files...'); 
  
  // Load them in parallel for better performance
  const promises = [
    loadLandCoverTIF(),
    loadLSTTIF(), 
    loadNDVITIF()
  ];
  
  try {
    await Promise.all(promises);
    console.log('All TIF files loaded successfully!');
  } catch (error) {
    console.error('Error loading TIF files:', error);
  }
}

// Land Cover TIF loader
async function loadLandCoverTIF() {
  const container = lcContainer;
  if (container) container.innerHTML = '<h3>Loading london_LC_2020.tif...</h3>';
  
  try {
    const response = await fetch('data/london/london_LC_2020.tif');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log(`Land Cover TIF loaded: ${arrayBuffer.byteLength} bytes`);
    
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const data = rasters[0];
    
    createLandCoverVisualization(data, image.getWidth(), image.getHeight(), image.getBoundingBox(), container);
    
  } catch (error) {
    console.error('Error loading Land Cover TIF:', error);
    if (container) container.innerHTML = `<h3 style="color: red;">Error: ${error.message}</h3>`;
  }
}

// LST TIF loader  
async function loadLSTTIF() {
  const container = lstContainer;
  if (container) container.innerHTML = '<h3>Loading london_LST_2020_summer.tif...</h3>';
  
  try {
    const response = await fetch('data/london/london_LST_2020_summer.tif');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log(`LST TIF loaded: ${arrayBuffer.byteLength} bytes`);
    
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const rawData = rasters[0];
    
    // Convert MODIS LST values to Celsius
    // MODIS LST is stored as: Kelvin * 50 (scale factor 0.02)
    // Formula: Celsius = (raw_value * 0.02) - 273.15
    const data = rawData.map(value => {
      if (value === null || value === undefined || isNaN(value) || value === 0) {
        return NaN; // No data values
      }
      const kelvin = value * 0.02; // Apply scale factor
      const celsius = kelvin - 273.15; // Convert to Celsius
      // Reasonable temperature range check (-50°C to 70°C)
      return (celsius >= -50 && celsius <= 70) ? celsius : NaN;
    });
    
    console.log('LST converted to Celsius:', {
      rawSample: rawData.slice(0, 10),
      convertedSample: data.slice(0, 10),
      validCount: data.filter(v => !isNaN(v)).length,
      nanCount: data.filter(v => isNaN(v)).length
    });
    
    createLSTVisualization(data, image.getWidth(), image.getHeight(), image.getBoundingBox(), container);
    
  } catch (error) {
    console.error('Error loading LST TIF:', error);
    if (container) container.innerHTML = `<h3 style="color: red;">Error: ${error.message}</h3>`;
  }
}

// NDVI TIF loader
async function loadNDVITIF() {
  const container = ndviContainer;
  if (container) container.innerHTML = '<h3>Loading london_NDVI_2020_summer.tif...</h3>';
  
  try {
    const response = await fetch('data/london/london_NDVI_2020_summer.tif');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    console.log(`NDVI TIF loaded: ${arrayBuffer.byteLength} bytes`);
    
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const rawData = rasters[0];
    
    // Convert MODIS NDVI values to proper scale
    // MODIS NDVI is typically stored with scale factor (often 0.0001 and range 0-10000)
    const data = rawData.map(value => {
      if (value === null || value === undefined || isNaN(value) || value < -1000 || value > 10000) {
        return NaN; // No data values
      }
      // Convert from MODIS scale (0-10000) to standard NDVI (-1 to 1)
      const ndvi = value * 0.0001;
      // Clamp to valid NDVI range
      return Math.max(-1, Math.min(1, ndvi));
    });
    
    console.log('NDVI converted to standard scale:', {
      rawSample: rawData.slice(0, 10),
      convertedSample: data.slice(0, 10),
      rawRange: [Math.min(...rawData.filter(v => v !== null && !isNaN(v))), Math.max(...rawData.filter(v => v !== null && !isNaN(v)))],
      convertedRange: [Math.min(...data.filter(v => !isNaN(v))), Math.max(...data.filter(v => !isNaN(v)))],
      validCount: data.filter(v => !isNaN(v)).length,
      nanCount: data.filter(v => isNaN(v)).length
    });
    
    createNDVIVisualization(data, image.getWidth(), image.getHeight(), image.getBoundingBox(), container);
    
  } catch (error) {
    console.error('Error loading NDVI TIF:', error);
    if (container) container.innerHTML = `<h3 style="color: red;">Error: ${error.message}</h3>`;
  }
}

// Helper function to calculate display dimensions
function calculateDisplayDimensions(width, height, maxWidth = 800, maxHeight = 400) {
  const aspectRatio = width / height;
  let displayWidth, displayHeight;
  
  if (aspectRatio > maxWidth / maxHeight) {
    displayWidth = maxWidth;
    displayHeight = maxWidth / aspectRatio;
  } else {
    displayHeight = maxHeight;
    displayWidth = maxHeight * aspectRatio;
  }
  
  return { displayWidth, displayHeight };
}

// Land Cover visualization
function createLandCoverVisualization(data, width, height, boundingBox, container) {
  const { displayWidth, displayHeight } = calculateDisplayDimensions(width, height);
  
  // Official Google Earth Engine IGBP Land Cover colors
  const landCoverColors = {
    0: '#000000',    // No data - black
    1: '#05450a',    // Evergreen Needleleaf Forests
    2: '#086a10',    // Evergreen Broadleaf Forests  
    3: '#54a708',    // Deciduous Needleleaf Forests
    4: '#78d203',    // Deciduous Broadleaf Forests
    5: '#009900',    // Mixed Forests
    6: '#c6b044',    // Closed Shrublands
    7: '#dcd159',    // Open Shrublands
    8: '#dade48',    // Woody Savannas
    9: '#fbff13',    // Savannas
    10: '#b6ff05',   // Grasslands
    11: '#27ff87',   // Permanent Wetlands
    12: '#c24f44',   // Croplands
    13: '#a5a5a5',   // Urban and Built-up Lands
    14: '#ff6d4c',   // Cropland/Natural Vegetation Mosaics
    15: '#69fff8',   // Permanent Snow and Ice
    16: '#f9ffa4',   // Barren
    17: '#1c0dff'    // Water Bodies
  };
  
  // Add NaN handling to land cover colors
  const landCoverColorsWithNaN = { ...landCoverColors };
  landCoverColorsWithNaN[NaN] = '#000000'; // Black for NaN/no data
  landCoverColorsWithNaN[null] = '#000000';
  landCoverColorsWithNaN[undefined] = '#000000';
  
  // Land cover type lookup for tooltips
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
  
  createD3Visualization(data, width, height, boundingBox, container, landCoverColorsWithNaN, 'Land Cover', displayWidth, displayHeight, landCoverTypes);
}

// LST visualization with temperature color scale
function createLSTVisualization(data, width, height, boundingBox, container) {
  const { displayWidth, displayHeight } = calculateDisplayDimensions(width, height);
  
  // Calculate temperature range (excluding NaN values)
  const validTemps = data.filter(v => !isNaN(v));
  const minTemp = Math.min(...validTemps);
  const maxTemp = Math.max(...validTemps);
  console.log(`LST range: ${minTemp.toFixed(1)} to ${maxTemp.toFixed(1)}`);
  
  // Create binned temperature ranges with official colors
  const tempRange = maxTemp - minTemp;
  const binSize = tempRange / 10; // Create 10 temperature bins
  
  const lstBins = [
    { min: minTemp, max: minTemp + binSize * 1, color: '#040274', label: 'Very Cold' },
    { min: minTemp + binSize * 1, max: minTemp + binSize * 2, color: '#0502a3', label: 'Cold' },
    { min: minTemp + binSize * 2, max: minTemp + binSize * 3, color: '#0602ff', label: 'Cool' },
    { min: minTemp + binSize * 3, max: minTemp + binSize * 4, color: '#307ef3', label: 'Mild Cool' },
    { min: minTemp + binSize * 4, max: minTemp + binSize * 5, color: '#32d3ef', label: 'Moderate' },
    { min: minTemp + binSize * 5, max: minTemp + binSize * 6, color: '#3be285', label: 'Mild Warm' },
    { min: minTemp + binSize * 6, max: minTemp + binSize * 7, color: '#b5e22e', label: 'Warm' },
    { min: minTemp + binSize * 7, max: minTemp + binSize * 8, color: '#fff705', label: 'Hot' },
    { min: minTemp + binSize * 8, max: minTemp + binSize * 9, color: '#ff8b13', label: 'Very Hot' },
    { min: minTemp + binSize * 9, max: maxTemp, color: '#ff0000', label: 'Extreme Hot' }
  ];
  
  // Create function to get color for any temperature value
  function getTemperatureColor(value) {
    if (isNaN(value) || value === null || value === undefined) {
      return '#000000'; // Black for NaN/no data
    }
    
    // Find which bin this temperature falls into
    for (let i = 0; i < lstBins.length; i++) {
      if (value >= lstBins[i].min && (i === lstBins.length - 1 ? value <= lstBins[i].max : value < lstBins[i].max)) {
        return lstBins[i].color;
      }
    }
    
    // Fallback for out-of-range values
    if (value < lstBins[0].min) return lstBins[0].color;
    if (value > lstBins[lstBins.length - 1].max) return lstBins[lstBins.length - 1].color;
    
    return '#FF00FF'; // Magenta for unexpected cases
  }
  
  // Pre-populate color mapping for unique values (for performance)
  const tempColors = {};
  const uniqueValues = [...new Set(data)];
  uniqueValues.forEach(value => {
    tempColors[value] = getTemperatureColor(value);
  });
  
  // Temperature classification function for tooltips
  function getTemperatureClass(value) {
    if (isNaN(value) || value === null || value === undefined) {
      return 'No Data';
    }
    
    for (let i = 0; i < lstBins.length; i++) {
      if (value >= lstBins[i].min && (i === lstBins.length - 1 ? value <= lstBins[i].max : value < lstBins[i].max)) {
        return `${lstBins[i].label} (${lstBins[i].min.toFixed(1)}-${lstBins[i].max.toFixed(1)}°C)`;
      }
    }
    return 'Out of Range';
  }
  
  createD3Visualization(data, width, height, boundingBox, container, tempColors, 'Land Surface Temperature (°C)', displayWidth, displayHeight, getTemperatureClass);
}

// NDVI visualization with vegetation color scale
function createNDVIVisualization(data, width, height, boundingBox, container) {
  const { displayWidth, displayHeight } = calculateDisplayDimensions(width, height);
  
  // Calculate NDVI range (typically -1 to 1)
  const minNDVI = Math.min(...data);
  const maxNDVI = Math.max(...data);
  console.log(`NDVI range: ${minNDVI} to ${maxNDVI}`);
  
  // Create binned NDVI classes based on vegetation interpretation
  const ndviBins = [
    { min: -1.0, max: -0.1, color: '#ffffff', label: 'Water/Snow/Clouds' },
    { min: -0.1, max: 0.0, color: '#ce7e45', label: 'Non-vegetated' },
    { min: 0.0, max: 0.1, color: '#df923d', label: 'Bare Soil/Rock' },
    { min: 0.1, max: 0.2, color: '#f1b555', label: 'Very Sparse Vegetation' },
    { min: 0.2, max: 0.3, color: '#fcd163', label: 'Sparse Vegetation' },
    { min: 0.3, max: 0.4, color: '#99b718', label: 'Moderate Vegetation' },
    { min: 0.4, max: 0.5, color: '#74a901', label: 'Healthy Vegetation' },
    { min: 0.5, max: 0.6, color: '#66a000', label: 'Dense Vegetation' },
    { min: 0.6, max: 0.7, color: '#529400', label: 'Very Dense Vegetation' },
    { min: 0.7, max: 0.8, color: '#207401', label: 'Forest/Dense Canopy' },
    { min: 0.8, max: 0.9, color: '#056201', label: 'Very Dense Forest' },
    { min: 0.9, max: 1.0, color: '#004c00', label: 'Extremely Dense Forest' }
  ];
  
  // Adjust bins to actual data range
  const actualBins = ndviBins.filter(bin => 
    (bin.max >= minNDVI && bin.min <= maxNDVI)
  );
  
  // Create function to get color for any NDVI value
  function getNDVIColor(value) {
    if (isNaN(value) || value === null || value === undefined) {
      return '#000000'; // Black for NaN/no data
    }
    
    // Find which bin this NDVI value falls into
    for (let i = 0; i < actualBins.length; i++) {
      if (value >= actualBins[i].min && (i === actualBins.length - 1 ? value <= actualBins[i].max : value < actualBins[i].max)) {
        return actualBins[i].color;
      }
    }
    
    // Fallback for out-of-range values
    if (actualBins.length > 0) {
      if (value < actualBins[0].min) return actualBins[0].color;
      if (value > actualBins[actualBins.length - 1].max) return actualBins[actualBins.length - 1].color;
    }
    
    return '#808080'; // Gray for out-of-range values
  }
  
  // Pre-populate color mapping for unique values (for performance)
  const ndviColors = {};
  const uniqueValues = [...new Set(data)];
  uniqueValues.forEach(value => {
    ndviColors[value] = getNDVIColor(value);
  });
  
  // NDVI classification function for tooltips
  function getNDVIClass(value) {
    if (isNaN(value) || value === null || value === undefined) {
      return 'No Data';
    }
    
    for (let i = 0; i < actualBins.length; i++) {
      if (value >= actualBins[i].min && (i === actualBins.length - 1 ? value <= actualBins[i].max : value < actualBins[i].max)) {
        return `${actualBins[i].label} (${actualBins[i].min.toFixed(1)}-${actualBins[i].max.toFixed(1)})`;
      }
    }
    return 'Out of Range';
  }
  
  createD3Visualization(data, width, height, boundingBox, container, ndviColors, 'NDVI', displayWidth, displayHeight, getNDVIClass);
}



// Generic D3 visualization function
function createD3Visualization(data, width, height, boundingBox, container, colorMap, title, displayWidth, displayHeight, legendClassifier) {
  const rectWidth = displayWidth / width;
  const rectHeight = displayHeight / height;
  
  // Skip creating individual container content, just create a hidden SVG for cloning
  const hiddenDiv = d3.select('body')
    .append('div')
    .style('display', 'none')
    .attr('id', `hidden-${title.replace(/\s+/g, '-')}`);
  
  // Create SVG (hidden, only for cloning to combined container)
  const svg = hiddenDiv
    .append('svg')
    .attr('width', displayWidth)
    .attr('height', displayHeight)
    .attr('data-title', title)
    .style('border', '2px solid #333')
    .style('background', '#f9f9f9');
  
  // Convert raster data to D3 format
  const d3Data = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const value = data[index];
      
      let color;
      if (isNaN(value) || value === null || value === undefined) {
        color = '#000000'; // Black for NaN/no data
      } else {
        color = colorMap[value] || '#FF00FF'; // Magenta for unknown valid values
      }
      
      d3Data.push({
        x: x * rectWidth,
        y: y * rectHeight,
        value: value,
        color: color,
        pixelX: x,
        pixelY: y
      });
    }
  }
  
  // Create rectangles
  svg.selectAll('.pixel')
    .data(d3Data)
    .enter()
    .append('rect')
    .attr('class', 'pixel')
    .attr('x', d => d.x)
    .attr('y', d => d.y)
    .attr('width', rectWidth)
    .attr('height', rectHeight)
    .attr('fill', d => d.color)
    .attr('stroke', 'none')
    .on('mouseover', function(event, d) {
      // Get legend classification if available
      let classification = '';
      if (legendClassifier) {
        if (typeof legendClassifier === 'function') {
          classification = legendClassifier(d.value);
        } else if (typeof legendClassifier === 'object') {
          classification = legendClassifier[d.value] || 'Unknown';
        }
      }
      
      const tooltip = d3.select('body')
        .append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('background', 'rgba(0,0,0,0.9)')
        .style('color', 'white')
        .style('padding', '10px')
        .style('border-radius', '6px')
        .style('pointer-events', 'none')
        .style('font-size', '13px')
        .style('z-index', '1000')
        .style('box-shadow', '0 4px 8px rgba(0,0,0,0.3)')
        .html(`
          <strong>Pixel:</strong> (${d.pixelX}, ${d.pixelY})<br>
          <strong>Value:</strong> ${typeof d.value === 'number' && !isNaN(d.value) ? d.value.toFixed(2) : d.value}<br>
          ${classification ? `<strong>Classification:</strong> <span style="display: inline-block; width: 12px; height: 12px; background-color: ${d.color}; border: 1px solid #fff; margin-right: 5px; vertical-align: middle;"></span>${classification}` : ''}
        `)
        .style('left', (event.pageX + 15) + 'px')
        .style('top', (event.pageY - 10) + 'px');
      
      d3.select(this).attr('stroke', '#333').attr('stroke-width', 1);
    })
    .on('mouseout', function() {
      d3.selectAll('.tooltip').remove();
      d3.select(this).attr('stroke', 'none');
    });
  
  console.log(`${title} visualization created with ${d3Data.length} rectangles`);
  
  // Store data for combined container (independent of individual containers)
  storeSVGDataForCombined(data, width, height, boundingBox, colorMap, title, displayWidth, displayHeight, legendClassifier);
}

// Global object to store data for independent SVG rendering
const svgDataStorage = {
  'Land Cover Type': null,
  'Land Surface Temperature (°C)': null,
  'Vegetation Levels (NDVI)': null
};

// Track which SVG is currently selected (enlarged)
let selectedSVG = null;

// Function to store data for independent combined container
function storeSVGDataForCombined(data, width, height, boundingBox, colorMap, title, displayWidth, displayHeight, legendClassifier) {
  const combinedContainer = document.getElementById('combined-svgs');
  if (!combinedContainer) return;
  
  // Map internal titles to display titles
  const titleMapping = {
    'Land Cover': 'Land Cover Type',
    'NDVI': 'Vegetation Levels (NDVI)'
  };
  const displayTitle = titleMapping[title] || title;
  
  // Store all the data needed to create independent SVGs
  svgDataStorage[displayTitle] = {
    data, width, height, boundingBox, colorMap, title: displayTitle, displayWidth, displayHeight, legendClassifier
  };
  
  // Check if all data is loaded and render independent SVGs
  if (svgDataStorage['Land Cover Type'] && svgDataStorage['Land Surface Temperature (°C)'] && svgDataStorage['Vegetation Levels (NDVI)']) {
    renderIndependentSVGsInOrder(combinedContainer);
  }
}

// Function to render independent SVGs in the correct order
function renderIndependentSVGsInOrder(combinedContainer) {
  // Clear the container
  combinedContainer.innerHTML = '';
  
  // Define the correct order
  const orderedTitles = ['Land Cover Type', 'Land Surface Temperature (°C)', 'Vegetation Levels (NDVI)'];
  
  // Create each SVG independently from stored data
  orderedTitles.forEach(title => {
    const svgData = svgDataStorage[title];
    if (svgData) {
      createIndependentSVGContainer(svgData, combinedContainer);
    }
  });
  
  // Add text below all SVGs
  const textElement = document.createElement('div');
  textElement.style.textAlign = 'center';
  textElement.style.marginTop = '20px';
  textElement.style.fontSize = '16px';
  textElement.style.color = '#444';
  textElement.style.width = '100%';
  textElement.style.clear = 'both';
  textElement.textContent = `
  Downtown London (grey) has warmer temperatures than the
  more natural land surrounding it. Even the farmlands (red) 
  have warmer temperatures than the higher vegetation areas (dark green).
  [
  My goal here is to add insights from each plot to say something about how 
  each map is related. The Land Cover and Temperature maps are obviously
  similar, but if you look closely the Vegetation plot can show the other
  side of this trend with lower temperatures. The plots are complementary.
  ]
  
  `;
  combinedContainer.appendChild(textElement);
}

// Function to create an ordered SVG container
// Function to create independent SVG from raw data
function createIndependentSVGContainer(svgData, combinedContainer) {
  const { data, width, height, boundingBox, colorMap, title, displayWidth, displayHeight, legendClassifier } = svgData;
  
  // Create container for this SVG
  const svgContainer = document.createElement('div');
  svgContainer.className = 'svg-container';
  svgContainer.style.textAlign = 'center';
  
  // Create label
  const label = document.createElement('h4');
  label.style.margin = '5px 0';
  label.textContent = title;
  
  // Create SVG using D3
  const svg = d3.create('svg')
    .attr('width', displayWidth * 0.4)  // Scale down like the original
    .attr('height', displayHeight * 0.4)
    .attr('data-title', title)
    .style('border', '2px solid #333')
    .style('background', '#f9f9f9');
  
  // Calculate rectangle dimensions
  const rectWidth = (displayWidth * 0.4) / width;
  const rectHeight = (displayHeight * 0.4) / height;
  
  // Create pixel data
  const d3Data = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const value = data[index];
      
      let color;
      if (isNaN(value) || value === null || value === undefined) {
        color = '#000000';
      } else {
        color = colorMap[value] || '#FF00FF';
      }
      
      d3Data.push({
        x: x * rectWidth,
        y: y * rectHeight,
        value: value,
        color: color,
        pixelX: x,
        pixelY: y
      });
    }
  }
  
  // Create rectangles
  svg.selectAll('.pixel')
    .data(d3Data)
    .enter()
    .append('rect')
    .attr('class', 'pixel')
    .attr('x', d => d.x)
    .attr('y', d => d.y)
    .attr('width', rectWidth)
    .attr('height', rectHeight)
    .attr('fill', d => d.color)
    .attr('stroke', 'none')
    .attr('data-original-x', d => d.x / 0.4)  // Store original coordinates
    .attr('data-original-y', d => d.y / 0.4)
    .attr('data-original-width', rectWidth / 0.4)
    .attr('data-original-height', rectHeight / 0.4)
    .attr('data-pixel-x', d => d.pixelX)
    .attr('data-pixel-y', d => d.pixelY)
    .attr('data-value', d => d.value);
  
  // Get the SVG DOM element
  const svgElement = svg.node();
  
  // Add hover functionality
  addHoverToClonedSVG(svgElement, title);
  
  // Add styling
  svgElement.style.margin = '5px';
  svgElement.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
  svgElement.style.borderRadius = '4px';
  svgElement.style.cursor = 'pointer';
  
  // Store base dimensions
  const baseWidth = displayWidth * 0.4;
  const baseHeight = displayHeight * 0.4;
  svgElement.setAttribute('data-base-width', baseWidth);
  svgElement.setAttribute('data-base-height', baseHeight);
  
  // Add click event listener
  svgElement.addEventListener('click', function() {
    toggleSVGSize(svgElement, title, combinedContainer);
  });
  
  // Append to container
  svgContainer.appendChild(label);
  svgContainer.appendChild(svgElement);
  combinedContainer.appendChild(svgContainer);
}

function createOrderedSVGContainer(originalSVG, title, combinedContainer) {
  // Create a container for this SVG and label
  const svgContainer = document.createElement('div');
  svgContainer.className = 'svg-container';
  
  // Create a label for this SVG
  const label = document.createElement('div');
  label.className = 'svg-label';
  label.textContent = title;
  
  // Clone the SVG
  const clonedSVG = originalSVG.cloneNode(true);
  
  // Resize the SVG for the combined view
  const originalWidth = parseFloat(clonedSVG.getAttribute('width'));
  const originalHeight = parseFloat(clonedSVG.getAttribute('height'));
  const scaleFactor = 0.4; // Scale down to 40% of original size
  
  clonedSVG.setAttribute('width', originalWidth * scaleFactor);
  clonedSVG.setAttribute('height', originalHeight * scaleFactor);
  
  // Scale down all the pixel rectangles inside the cloned SVG and preserve data
  const originalPixelRects = originalSVG.querySelectorAll('.pixel');
  const pixelRects = clonedSVG.querySelectorAll('.pixel');
  
  pixelRects.forEach((rect, index) => {
    // Scale position and dimensions
    const x = parseFloat(rect.getAttribute('x')) * scaleFactor;
    const y = parseFloat(rect.getAttribute('y')) * scaleFactor;
    const width = parseFloat(rect.getAttribute('width')) * scaleFactor;
    const height = parseFloat(rect.getAttribute('height')) * scaleFactor;
    
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', width);
    rect.setAttribute('height', height);
    
    // Preserve original pixel coordinates and value from D3 data
    if (originalPixelRects[index]) {
      const originalRect = originalPixelRects[index];
      const originalX = parseFloat(originalRect.getAttribute('x'));
      const originalY = parseFloat(originalRect.getAttribute('y'));
      const originalWidth = parseFloat(originalRect.getAttribute('width'));
      const originalHeight = parseFloat(originalRect.getAttribute('height'));
      
      // Copy the pixel coordinates directly from the original rect's bound data
      // The pixel coordinates should remain constant regardless of scaling
      const boundData = originalRect.__data__;
      let pixelX, pixelY;
      
      if (boundData) {
        // If D3 data is available, use the exact pixel coordinates
        pixelX = boundData.pixelX;
        pixelY = boundData.pixelY;
      } else {
        // Fallback: calculate from the original rect dimensions and SVG size
        const svgWidth = parseFloat(originalSVG.getAttribute('width'));
        const svgHeight = parseFloat(originalSVG.getAttribute('height'));
        const rectWidth = parseFloat(originalRect.getAttribute('width'));
        const rectHeight = parseFloat(originalRect.getAttribute('height'));
        
        pixelX = Math.round(originalX / rectWidth);
        pixelY = Math.round(originalY / rectHeight);
      }
      
      rect.setAttribute('data-pixel-x', pixelX);
      rect.setAttribute('data-pixel-y', pixelY);
      rect.setAttribute('data-original-x', originalX);
      rect.setAttribute('data-original-y', originalY);
      rect.setAttribute('data-original-width', originalWidth);
      rect.setAttribute('data-original-height', originalHeight);
    }
  });
  
  // Re-attach hover functionality to cloned SVG
  addHoverToClonedSVG(clonedSVG, title);
  
  // Add styling to distinguish it in the combined view
  clonedSVG.style.margin = '5px';
  clonedSVG.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
  clonedSVG.style.borderRadius = '4px';
  clonedSVG.style.cursor = 'pointer';
  
  // Store original dimensions for scaling
  const baseWidth = originalWidth * scaleFactor;
  const baseHeight = originalHeight * scaleFactor;
  clonedSVG.setAttribute('data-base-width', baseWidth);
  clonedSVG.setAttribute('data-base-height', baseHeight);
  clonedSVG.setAttribute('data-title', title);
  
  // Add click event listener for enlarging/shrinking
  clonedSVG.addEventListener('click', function() {
    toggleSVGSize(clonedSVG, title, combinedContainer);
  });
  
  // Append label and cloned SVG to the container
  svgContainer.appendChild(label);
  svgContainer.appendChild(clonedSVG);
  
  // Append the container to the combined container
  combinedContainer.appendChild(svgContainer);
}

// Function to toggle SVG size with absolute states: 0.5x, 1.0x, 2.0x
function toggleSVGSize(clickedSVG, clickedTitle, combinedContainer) {
  const allSVGs = combinedContainer.querySelectorAll('svg[data-title]');
  
  // Check if the clicked SVG is currently selected (enlarged)
  const isCurrentlySelected = (selectedSVG === clickedSVG);
  
  if (isCurrentlySelected) {
    // If clicking the already selected SVG, reset all to state 1.0
    selectedSVG = null;
    setSVGState(allSVGs, null);
  } else {
    // If clicking a different SVG, select it (state 2.0) and shrink others (state 0.5)
    selectedSVG = clickedSVG;
    setSVGState(allSVGs, clickedSVG);
  }
}

// Function to set SVG states based on selection
function setSVGState(allSVGs, selectedSVG) {
  allSVGs.forEach(svg => {
    const baseWidth = parseFloat(svg.getAttribute('data-base-width'));
    const baseHeight = parseFloat(svg.getAttribute('data-base-height'));
    
    let sizeMultiplier;
    
    if (selectedSVG === null) {
      // No selection: all SVGs at state 1.0
      sizeMultiplier = 1.0;
    } else if (svg === selectedSVG) {
      // Selected SVG: state 2.0
      sizeMultiplier = 2.0;
    } else {
      // Non-selected SVGs: state 0.5
      sizeMultiplier = 0.5;
    }
    
    // Keep container at base size and use only CSS transform for scaling
    svg.setAttribute('width', baseWidth);
    svg.setAttribute('height', baseHeight);
    
    // Calculate the appropriate transform scale
    let transformScale = sizeMultiplier;
    if (sizeMultiplier === 2.0) {
      transformScale = sizeMultiplier * (2/3);
    }
    
    // Use CSS transform for smooth, hardware-accelerated scaling
    // Scale from center horizontally but from top vertically to avoid overlapping title
    svg.style.transform = `scale(${transformScale})`;
    svg.style.transformOrigin = 'center top';
    svg.style.transition = 'transform 0.3s ease-in-out';
    
    // Ensure the SVG container has proper overflow handling for scaled content
    const svgContainer = svg.parentElement;
    if (svgContainer) {
      svgContainer.style.display = 'flex';
      svgContainer.style.flexDirection = 'column';
      svgContainer.style.alignItems = 'center';
      svgContainer.style.overflow = 'visible';
      svgContainer.style.margin = '10px';
      
      // Add smooth transition to margin changes
      svgContainer.style.transition = 'margin-bottom 0.3s ease-in-out';
      
      // Add extra bottom margin when scaled up to prevent overlapping text below
      const bottomMargin = transformScale > 1.0 ? `${(transformScale - 1.0) * 100}px` : '10px';
      svgContainer.style.marginBottom = bottomMargin;
    }
  });
}

// Function to get meaningful color names based on dataset and color
function getColorName(title, color) {
  // Convert color to lowercase for consistent matching
  const colorLower = color.toLowerCase();
  
  if (title === 'Land Cover' || title === 'Land Cover Type') {
    const landCoverColorMap = {
      '#000000': 'No Data',
      '#05450a': 'Evergreen Needleleaf Forests',
      '#086a10': 'Evergreen Broadleaf Forests',
      '#54a708': 'Deciduous Needleleaf Forests',
      '#78d203': 'Deciduous Broadleaf Forests',
      '#009900': 'Mixed Forests',
      '#c6b044': 'Closed Shrublands',
      '#dcd159': 'Open Shrublands',
      '#dade48': 'Woody Savannas',
      '#fbff13': 'Savannas',
      '#b6ff05': 'Grasslands',
      '#27ff87': 'Permanent Wetlands',
      '#c24f44': 'Croplands',
      '#a5a5a5': 'Urban and Built-up Lands',
      '#ff6d4c': 'Cropland/Natural Vegetation Mosaics',
      '#69fff8': 'Permanent Snow and Ice',
      '#f9ffa4': 'Barren',
      '#1c0dff': 'Water Bodies'
    };
    return landCoverColorMap[colorLower] || 'Unknown Land Cover';
  }
  
  else if (title === 'Land Surface Temperature (°C)') {
    const tempColorMap = {
      '#040274': 'Very Cold',
      '#0502a3': 'Cold',
      '#0602ff': 'Cool',
      '#307ef3': 'Mild Cool',
      '#32d3ef': 'Moderate',
      '#3be285': 'Mild Warm',
      '#b5e22e': 'Warm',
      '#fff705': 'Hot',
      '#ff8b13': 'Very Hot',
      '#ff0000': 'Extreme Hot',
      '#000000': 'No Data'
    };
    return tempColorMap[colorLower] || 'Temperature Range';
  }
  
  else if (title === 'NDVI' || title === 'Vegetation Levels (NDVI)') {
    const ndviColorMap = {
      '#ffffff': 'Water/Snow/Clouds',
      '#ce7e45': 'Non-vegetated',
      '#df923d': 'Bare Soil/Rock',
      '#f1b555': 'Very Sparse Vegetation',
      '#fcd163': 'Sparse Vegetation',
      '#99b718': 'Moderate Vegetation',
      '#74a901': 'Healthy Vegetation',
      '#66a000': 'Dense Vegetation',
      '#529400': 'Very Dense Vegetation',
      '#207401': 'Forest/Dense Canopy',
      '#056201': 'Very Dense Forest',
      '#004c00': 'Extremely Dense Forest',
      '#000000': 'No Data',
      '#808080': 'Out of Range'
    };
    return ndviColorMap[colorLower] || 'Vegetation Type';
  }
  
  return 'Unknown'; // Fallback without hex code
}

// Function to add hover functionality to cloned SVGs
function addHoverToClonedSVG(clonedSVG, title) {
  const pixelRects = clonedSVG.querySelectorAll('.pixel');
  
  // Determine the legend classifier based on the title
  let legendClassifier;
  if (title === 'Land Cover') {
    legendClassifier = {
      0: 'No Data', 1: 'Evergreen Needleleaf Forests', 2: 'Evergreen Broadleaf Forests',
      3: 'Deciduous Needleleaf Forests', 4: 'Deciduous Broadleaf Forests', 5: 'Mixed Forests',
      6: 'Closed Shrublands', 7: 'Open Shrublands', 8: 'Woody Savannas', 9: 'Savannas',
      10: 'Grasslands', 11: 'Permanent Wetlands', 12: 'Croplands', 13: 'Urban and Built-up Lands',
      14: 'Cropland/Natural Vegetation Mosaics', 15: 'Permanent Snow and Ice', 16: 'Barren', 17: 'Water Bodies'
    };
  } else if (title === 'Land Surface Temperature (°C)') {
    legendClassifier = function(value) {
      if (isNaN(value) || value === null || value === undefined) return 'No Data';
      if (value < 10) return 'Very Cold';
      if (value < 15) return 'Cold';
      if (value < 20) return 'Cool';
      if (value < 25) return 'Moderate';
      if (value < 30) return 'Warm';
      if (value < 35) return 'Hot';
      return 'Very Hot';
    };
  } else if (title === 'NDVI') {
    legendClassifier = function(value) {
      if (isNaN(value) || value === null || value === undefined) return 'No Data';
      if (value < 0) return 'Water/Non-vegetated';
      if (value < 0.2) return 'Sparse Vegetation';
      if (value < 0.4) return 'Moderate Vegetation';
      if (value < 0.6) return 'Dense Vegetation';
      return 'Very Dense Vegetation';
    };
  }
  
  pixelRects.forEach(rect => {
    rect.addEventListener('mouseover', function(event) {
      // Get pixel data from preserved attributes
      const pixelX = rect.getAttribute('data-pixel-x') || 'N/A';
      const pixelY = rect.getAttribute('data-pixel-y') || 'N/A';
      const value = rect.getAttribute('data-value');
      const color = rect.getAttribute('fill');
      
      // Get meaningful color name based on dataset type and color
      let colorName = getColorName(title, color);
      
      // Format the value based on dataset type
      let formattedValue;
      if (value === null || value === 'null' || value === 'undefined' || isNaN(value)) {
        formattedValue = 'No Data';
      } else {
        const numValue = parseFloat(value);
        if (title.includes('Land Cover')) {
          formattedValue = colorName;
        } else if (title.includes('Temperature')) {
          formattedValue = `${numValue.toFixed(1)}°C (${colorName})`;
        } else if (title.includes('NDVI') || title.includes('Vegetation')) {
          formattedValue = colorName;
        } else {
          formattedValue = `${numValue.toFixed(2)} (${colorName})`;
        }
      }
      
      // Create tooltip
      const tooltip = document.createElement('div');
      tooltip.className = 'tooltip';
      tooltip.style.position = 'absolute';
      tooltip.style.background = 'rgba(0,0,0,0.9)';
      tooltip.style.color = 'white';
      tooltip.style.padding = '10px';
      tooltip.style.borderRadius = '6px';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.fontSize = '12px';
      tooltip.style.zIndex = '1000';
      tooltip.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
      tooltip.innerHTML = `
        <strong>Dataset:</strong> ${title}<br>
        <strong>Pixel:</strong> (${pixelX}, ${pixelY})<br>
        <strong>Value:</strong> <span style="display: inline-block; width: 12px; height: 12px; background-color: ${color}; border: 1px solid #fff; margin-right: 5px; vertical-align: middle;"></span>${formattedValue}
      `;
      tooltip.style.left = (event.pageX + 15) + 'px';
      tooltip.style.top = (event.pageY - 10) + 'px';
      
      document.body.appendChild(tooltip);
      
      // Add stroke highlight
      rect.setAttribute('stroke', '#fff');
      rect.setAttribute('stroke-width', '1');
    });
    
    rect.addEventListener('mouseout', function() {
      // Remove tooltip
      const tooltips = document.querySelectorAll('.tooltip');
      tooltips.forEach(tooltip => tooltip.remove());
      
      // Remove stroke highlight
      rect.setAttribute('stroke', 'none');
    });
  });
}



function getLandCoverName(value) {
  const names = {
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
  return names[value] || 'Unknown';
}

