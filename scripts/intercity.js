const container = d3.select("#cityCompare");
container.selectAll("*").remove();
const node = container.node();
const width = node.clientWidth;
const height = node.clientHeight;
let bottom_margin = height-60;
let left_margin = 25;

const vars = d3.select("#cityCompare")
    .append("div")
    .attr("id", "vars");

//Create array of options to be added
var array = ["NDVI","Daytime LST","Nighttime LST"];

d3.select('#vars')
    .append("label")
    .attr("id", "varX")
    .text("X-axis: ");

var selectListx = d3.select("#vars")
    .append("select")
    .attr("id", "mySelectx");

d3.select('#vars')
    .append("label")
    .attr("id", "varY")
    .text("     Y-axis: ");

//Create and append select list

var selectListy = d3.select("#vars")
    .append("select")
    .attr("id", "mySelecty");

var optionsX = selectListx.selectAll("option")
  .data(array)
  .enter()
  .append("option")
  .attr("value", (d) => d) // Set the value attribute of the option
  .text((d) => d);

var optionsY = selectListy.selectAll("option")
  .data(array)
  .enter()
  .append("option")
  .attr("value", (d) => d) // Set the value attribute of the option
  .text((d) => d);

optionsY.property("selected", function(d) {
  return d === "Daytime LST";
});

const svg = d3.select("#cityCompare")
    .append("svg")
    .attr("width", width)
    .attr("height", height-40)
    .append("g");

let selectX = document.getElementById("mySelectx");
let selectY = document.getElementById("mySelecty");

let activeVars = ['NDVI', 'Daytime LST'];

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

async function renderPlot(x, y) {
    svg.selectAll("circle").remove();
    svg.selectAll("g").remove();
    activeVars = [x, y];
    let axisMap = {
        "NDVI": "ndvi_median",
        "Daytime LST": "lst_day_median",
        "Nighttime LST": "lst_night_median"
    }
    let xScale;
    if (x == 'NDVI') {
        xScale = d3.scaleLinear()
            .domain([-1, 1])
            .range([left_margin, width-10]);
    }
    else {
        xScale = d3.scaleLinear()
            .domain([0, 40])
            .range([left_margin, width-10]);
    }

    let yScale;
    if (y == 'NDVI') {
        yScale = d3.scaleLinear()
            .domain([-1, 1])
            .range([bottom_margin, 10]);
    }
    else {
        yScale = d3.scaleLinear()
            .domain([0, 40])
            .range([bottom_margin, 10]);
    }

    // Add X axis
    svg.append("g")
        .attr("transform", `translate(0,${bottom_margin})`)
        .call(d3.axisBottom(xScale));

    // Add Y axis
    svg.append("g")
        .attr("transform", `translate(${left_margin},0)`)
        .call(d3.axisLeft(yScale));

    let places = [
        {place: 'Tokyo', path:'data/tokyo/tokyo_wards.json', subunit:'Ward'},
        {place: 'London', path:'data/london/london_boroughs.json', subunit: 'Borough'},
        {place: 'New York City', path:'data/nyc/nyc_boroughs.json', subunit: 'Borough'},
        {place: 'San Diego County', path:'data/san-diego/sandiego_boroughs.json', subunit: 'City'}
    ];
    const defaultTooltipFormatter = ({ place, ward, ndvi, dlst, nlst, lc, subunit}) => {
        const wardLine = `${subunit}: ${ward}<br>`;
        let rows = "";
        let allLayers = {'NDVI': parseFloat(ndvi).toFixed(2), 'Daytime LST': parseFloat(dlst).toFixed(2)+' °C', 'Nighttime LST': parseFloat(nlst).toFixed(2)+' °C', 'Land Cover Type': lc};
        for (const layer in allLayers)  {
            let val=allLayers[layer];
            rows += `<span style="color:${activeVars.includes(layer) ? "#fff" : "#ccc"}">` +
                    `${layer}: `+ val + `</span><br>`;
        }

        return (
            `<strong>${place}</strong><br>` +
            wardLine +
            rows
        );
    };
    const categories = places.map(d => d.category);
    const colorScale = d3.scaleOrdinal()
        .domain(categories) // Set the domain to your unique categories
        .range(d3.schemeAccent);
    for (const placePath of places) {
        let path = placePath.path;
        let wardMeta = null;
        if (path) {
            const wardResp = await fetch(path);
            wardMeta = await wardResp.json();
        }
        svg.selectAll("fake")
        .data(wardMeta.wards)
        .enter()
        .append("circle")
        .attr("cx", d => xScale(d[axisMap[x]]))
        .attr("cy", d => yScale(d[axisMap[y]]))
        .attr("r", 5)
        .attr("id", placePath.place)
        .style("fill", colorScale(placePath.place))
        .on("mouseover", function(event, d) {
            d3.select(this)
                .attr("stroke", "#000")
                .attr("stroke-width", 0.5);
            let name = d['name'];
            let ndvi = d['ndvi_median'];
            let dlst = d['lst_day_median'];
            let nlst = d['lst_night_median'];
            let lc = d['lc_mode'];
            tooltip.style("opacity", 1) // Make tooltip visible
            .html(defaultTooltipFormatter({
                place: placePath.place,
                ward: name,
                ndvi,
                dlst,
                nlst,
                lc,
                subunit: placePath.subunit
            }))
            .style("left", (event.pageX + 10) + "px") // Position near mouse
            .style("top", (event.pageY - 20) + "px");
        })
        .on("mouseout", function() {
            tooltip.style("opacity", 0); // Hide tooltip
            d3.select(this).attr("stroke", null);
        }); // Customize circle color
    }
}

renderPlot(selectX.value, selectY.value);

selectX.addEventListener("change", function() {
    renderPlot(selectX.value, selectY.value);
});

selectY.addEventListener("change", function() {
    renderPlot(selectX.value, selectY.value);
});