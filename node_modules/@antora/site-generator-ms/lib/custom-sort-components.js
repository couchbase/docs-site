'use strict'

function customSortComponents (components, sortOrder = undefined) {
  let sortedComponents = [...components].sort((a, b) => a.title.localeCompare(b.title))
  if (sortOrder) {
    sortOrder = Array.isArray(sortOrder)
      ? [...sortOrder]
      : sortOrder.split(',').map((componentName) => componentName.trim())
    const restIdx = sortOrder.indexOf('*')
    if (~restIdx) sortOrder.splice(restIdx, 1)
    const sortedComponentMap = sortedComponents.reduce((accum, component) => {
      accum[component.name] = component
      return accum
    }, {})
    sortedComponents = sortOrder.reduce((accum, componentName) => {
      if (componentName in sortedComponentMap) {
        accum.push(sortedComponentMap[componentName])
        delete sortedComponentMap[componentName]
      }
      return accum
    }, [])
    if (~restIdx) sortedComponents.splice(restIdx, 0, ...Object.values(sortedComponentMap))
  }
  return sortedComponents
}

module.exports = customSortComponents
