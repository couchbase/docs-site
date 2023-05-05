// iterate openapi property definitions


module.exports = function(context, options) {    
    const indent = "   "
    
    const types = 
    {
        integer: { fallback: '0', format: parseInt },
        number: { fallback: '0.0', format: parseFloat },
        string: { fallback: 'string', format: (val => `"${val}"`) },
        boolean: { fallback: 'true' },
        array: { fallback: '', format: (val => `[${val}]`) },
    }
    
    // We try to display the parameter as the best possible value,
    // e.g.
    //     example -> default -> fallback for the type
    //
    // Then, whether we used a fallback like "string" or an example like "Bob",
    // we format it depending on its type (e.g. surrounding it in quotes etc.)

    function format_type (node) {
        if (node.type == 'object') return

        const type = 
            node.example ??
            node.default ??
            types[node.type]?.fallback ??
            node.type ??
            '(unknown)'
    
        const format = types[node.type]?.format ?? (val => val)
        return format(type) 
    }
    
    // recursive function to walk the Table of Contents
    function process_toc (node, path) {
        
        const path_id = path.join('.')
        const left = path.length ? 
            `<a href="#${path_id}">${path[path.length-1]}</a>: ` 
            : ''
        const level = indent.repeat(path.length)
        
        if (node.type == 'object') {
            if (node.properties) {
                const children = 
                    Object.entries(node.properties)
                        .sort()
                        .map(
                            ([child_key,child]) => process_toc(child, [...path, child_key]))
                        
                return `${level}${left}{\n` +
                        children.join(',\n') +
                    `\n${level}}`               
            }
            else {
                // TODO handle additionalProperties
                return `${level}(TODO additionalProperties)`
            }
        }
        else {
            const right = format_type(node)
            return `${level}${left}${right}`
        }
    }
    
    const table_of_contents = [
        '++++',
        '<pre>',
        process_toc(context, []),
        '</pre>',
    ].join('\n')

    console.log(table_of_contents)
    return new global.handlebars.SafeString(table_of_contents)
}
