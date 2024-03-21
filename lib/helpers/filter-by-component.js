'use strict'

module.exports = filterByComponent

function filterByComponent(arr, ...rest) {
    const components = rest.slice(0,-1) // last item is Handlebars context 
    return arr.filter(item => intersects(item["Component/s"], components))
}

function intersects(a, b) {
    const setB = new Set(b);
    return a.some(x => setB.has(x));
}
