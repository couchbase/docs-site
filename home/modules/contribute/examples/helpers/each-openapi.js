// iterate openapi property definitions


module.exports = function(context, options) {
    var ret = ""
    
    // data frame to add @variables for template
    var data = options.data ? global.handlebars.createFrame(options.data) : {}
    options.data = data

    console.dir(data, {depth:0})
    
    const types = 
    {
        object: '{',
        integer: '0',
        number: '0.0',
        string: 'string',
        boolean: 'true'
    }
    function format_type (node) {
        if (node.type == 'object') return '{'
                                            
        const type = Object.hasOwn(node, 'default') ?
            node.default
            : types[node.type] || node.type
    
        if (node.type == 'string') {
            return `"${type}"`
        }
        else {
            return type
        }
    }
    
    function process (node, path, first, last) {
        data.path = path.join('.')
        data.key = path[path.length -1]
        data.indent = '   '.repeat(path.length)
        data.isobject = (node.type == 'object')
        data.last = last
        data.type = format_type(node)
        
        ret = ret + options.fn(node, { data: data });

        // TODO handle additionalProperties
        if (node.properties) {
            const children = Object.keys(node.properties).sort()
            
            const first = children[0]
            const last = children[children.length -1]
            
            for (var key of children) {
                const child = node.properties[key]        
                process(child, [...path, key], key == first, key == last)
            }
        }
    }
    
    process(context, [], false)

    return ret;
}
