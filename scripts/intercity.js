const margin = { top: 20, right: 20, bottom: 30, left: 40 };
const width = 600 - margin.left - margin.right;
const height = 400 - margin.top - margin.bottom;

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

//Create and append the options
for (var i = 0; i < array.length; i++) {
    d3.select("#mySelectx")
        .append("option")
        .text(array[i]);
    d3.select("#mySelecty")
        .append("option")
        .text(array[i]);
}

const svg = d3.select("#cityCompare")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);


function renderPlot(x, y) {
    // Define scales
    const xScale = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.x)])
        .range([0, width]);

    const yScale = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.y)])
        .range([height, 0]);

    // Add X axis
    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(xScale));

    // Add Y axis
    svg.append("g")
        .call(d3.axisLeft(yScale));

    // Add dots for the scatterplot
    svg.selectAll(".dot")
        .data(data)
        .enter().append("circle")
        .attr("class", "dot")
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .attr("r", 5);
}