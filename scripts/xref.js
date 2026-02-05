const fs = require('fs')
const manifest = JSON.parse(fs.readFileSync("./site-manifest.json"))

for (const component of manifest.components) {
    // console.dir(component, { depth: 1 })
    // console.dir(component.versions[0].pages, { depth: 1 })
    const version = component.latest && `(${component.latest})`
    const componentName = component.name
    const componentVersion = version + componentName
    for (const page of component.versions[0].pages) {
        const module = page.module == 'ROOT' ? '' : page.module
        if (!page.alias) {
            console.log(`${page.title} ${version} •xref:${componentName}:${module}:${page.path}`)        }
    }
}