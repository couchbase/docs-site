// Format config section of openapi property definitions.
// We pass in a data structure from an openapi Schema.
//
//     Table of Contents (of the tree of this Schema, in HTML, linked to below)
//
//     The Asciidoc template is called for each node of the tree
//
// see extensions-template.adoc for motivating example.


module.exports = function(context, options) {
    
    // setup some helper variables
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
    // NOTE: we are building up HTML here, because Asciidoc is hard to generate for something that's 
    // richly marked up and whitespace dependent.
    function process_toc (node) {
        
        // the Left of the JSON expression (except at the Root) is `key: `
        // IF the related node has a Description, then link to it.
        
        const left = (node, path) =>
            path.length ?
                node.description ?
                    `<a href="#${path.join('-')}">${path[path.length-1]}</a>: `
                    : `${path[path.length-1]}: `
                : ''

        const level = (path) => indent.repeat(path.length)
        
        const internal = (node, path, children) => 
            level(path) + left(node, path) + '{\n' +
            children.join(',\n') + '\n' +
            level(path) + '}'

        const leaf = (node, path) =>
            level(path) + left(node, path) + format_type(node)
    
        return iterate_properties(node, leaf, internal)
    }

    // recursive function to flatten the tree into a flat list like [root, a, a.a1, a.a1.a2, a.b1, a.b1.b2, ...]
    // TODO refactor (the iteration is identical to above, but this version *flattens* the result into a list)
    // Looks like we just need to parametrize `leaf` and `internal` functions.
    function iterate_properties (node, leaf, internal) {
        
        function recurse(node, path) {
            if (node.type == 'object') {
                if (node.properties) {
                    const children = 
                        Object.entries(node.properties)
                        .filter(([_,child]) => ! child.deprecated)
                        .sort()
                            .map(
                                ([child_key,child]) => recurse(child, [...path, child_key]))
                    return internal(node, path, children)
                } else {
                    // something something additionalProperties
                }
            }
            else {
                return leaf(node, path)
            }
        }
        
        return recurse(node, [])
    }
    
    function get_items(node) {
        const leaf = (node, path) => [{node, path}]
        const internal = (node, path, children) => [{node, path}, ...children.flat()]
        
        return iterate_properties(node, leaf, internal)
    }
    
        
    // Generate Table of Contents HTML, and wrap the whole thing in a passthrough block (++++)
    const table_of_contents = [
        '++++',
        '<pre>',
        process_toc(context),
        '</pre>',
        '++++'
    ].join('\n')
    
    // Now generate the body
    const body_text =
            get_items(context)
            .slice(1) // remove the wrapper Root node
            .map(item => options.fn( // call the Handlebars template with our data
                item,
                // pass @path_id and @path_id_href to Handlebars template
                { data:    {
                    path_id: item?.path?.join('.'),
                    path_id_href: item?.path?.join('-')
                }}))
            .join('\n\n')

    return new global.handlebars.SafeString(table_of_contents + '\n\n' + body_text)
}
