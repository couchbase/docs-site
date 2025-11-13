'use strict'

module.exports = {
    format_type,
    process_toc,
    iterate_properties,
    child_entries,
    get_items,
    main
}

// setup some helper variables
const path_id_href = (path) => path.map(v=>v.replace(/\./g, '')).join('-')
const indent = "   " 
const types = {
    integer: { fallback: '0', format: parseInt },
    number: { fallback: '0.0', format: parseFloat },
    string: { fallback: 'string', format: (val => `"${val}"`) },
    boolean: { fallback: 'true' },
    array: { fallback: '', format: (val => `[${val}]`) },
}

function main(context, ...schemas) {
    const options = schemas.pop()

    // workaround for displaying e.g. Role + User schemas
    if (schemas.length) {
        const root = { properties: {}, type: "object" }
        for (var schema of schemas) {
            root.properties[schema] = context[schema]
        } 
        context = root
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
                    path_id_href: path_id_href(item?.path || [])
                }}))
            .join('\n\n')

    return new global.handlebars.SafeString(table_of_contents + '\n\n' + body_text)
}


// We try to display the parameter as the best possible value,
// e.g.
//     example -> default -> fallback for the type
//
// Then, whether we used a fallback like "string" or an example like "Bob",
// we format it depending on its type (e.g. surrounding it in quotes etc.)

function format_type (node) {
    if (node.type === 'object') return

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
    // IF the related node has a Description OR Title, then link to it.
    
    const left = (node, path) =>
        path.length ?
            (node.description || node.title) ?
                `<a href="#${path_id_href(path)}">${path[path.length-1]}</a>: `
                : `${path[path.length-1]}: `
            : ''

    const level = (path) => indent.repeat(path.length)
    
    const handleObject = (node, path, children) =>
        level(path) + left(node, path) + '{\n' +
        children.join(',\n') + '\n' +
        level(path) + '}'

    const handleArray = (node, path, children) =>
        level(path) + left(node, path) + '[' +
        (children.length > 1 ?
            '\n' + children.join(',\n') + '\n' + level(path) :
            children[0])
        + ']'

    const handleLeaf = (node, path) =>
        level(path) + left(node, path) + format_type(node)

    return iterate_properties(node, handleLeaf, handleObject, handleArray)
}
    
// The usual path to get to child objects is `properties` which includes specific, *named* properties.
//
// `additionalProperties` are unrestrained collections.
// They can also be specified as a boolean, which is a shorthand for a default object.

function child_entries(node) {
    const via_properties = 
        node.properties ? 
            Object.entries(node.properties) : []
    
    function format_additionalProperties (ap) {
        if (typeof(ap) === 'boolean') ap = {}
        return { type: "object", ...ap }
    }
    
    const via_additionalProperties =
        node.additionalProperties ?
            [[
                `{${node.additionalProperties["x-additionalPropertiesName"] || "additionalProperties"}...}`,
                format_additionalProperties(node.additionalProperties) ]]
            : []

    // allOf can be nested, so call child_entries recursively
    const via_allOf = (node.allOf || []).flatMap(subNode =>
      child_entries(subNode)
    )

    return [...via_properties, ...via_additionalProperties, ...via_allOf]
}

// recursive function to walk the tree.
// pass in callbacks for:
//   `handleLeaf`
//   `handleObject`
//   `handleArray`
// to handle the tree as appropriate
// this can be used to:
//    * generate a tree (as per process_toc)
//    * flatten the tree into a list (as per get_items)
function iterate_properties (node, handleLeaf, handleObject, handleArray) {
    

    function recurse(node, path) {

        if (! node.type) {
            node.type = 'object'
            // If type is not specified on a schema object, assume it is an object. 
            // This behavior seems to match redocly behavior.
            // It is necessary to explicitly set the type as format_type function uses this.
        }

        const get_children = (node) =>
            child_entries(node)
                .filter(([_,child]) => ! child.deprecated)
                .sort()
                    .map(
                        ([child_key,child]) => recurse(child, [...path, child_key]))

        if (node.type === 'object') {
            return handleObject(node, path, get_children(node))
        }
        else if (node.type == 'array') {
            let children = get_children(node.items)
            if (! children.length) {
                children = [ `${format_type(node.items)}...` ]
            }
            return handleArray(node, path, children)
        }
        else {
            return handleLeaf(node, path)
        }
    }
    
    return recurse(node, [])
}

function get_items(node) {
    const handleLeaf = (node, path) => [{node, path}]
    const handleObject = (node, path, children) => [{node, path}, ...children.flat()]
    const handleArray = (node, path, children) => [{node, path}, ...children.flat()]
    
    return iterate_properties(node, handleLeaf, handleObject, handleArray)
}
