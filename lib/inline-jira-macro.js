/**
 * Extends the AsciiDoc syntax to add support for the inline jira macro.
 *
 * Usage:
 *
 *  jira:DOC-1234[]
 *  jira:DOC-1234[Optional link text]
 *
 * @author Hakim Cassimally <hakim.cassimally@couchbase.com>
 */
function initInlineJiraMacro ({ file, mapping }) {
  return function () {
    this.parseContentAs('text')
    this.process((parent, ref, attrs) => {
      let [handle, id] = ref.split('-')
      if (!id) {
        id = handle
        if ((handle = mapping.__DEFAULT_HANDLE__)) ref = handle + '-' + id
      }
      const url = (mapping[handle] || mapping.__DEFAULT_URL__) + '/' + ref
      const text = attrs['text'] || ref
      return this.createInline(parent, 'anchor', text, { type: 'link', target: url })
    })
  }
}

function register (registry, context) {
  const { config: { attributes } } = context
  const mapping = Object.entries(attributes).reduce((accum, [name, val]) => {
    if ((name + '-').startsWith('url-issues-')) {
      const handle = ((name + '-').slice(11, name.length) || '__default_url__').toUpperCase()
      if (!accum.__DEFAULT_HANDLE__ && handle !== '__DEFAULT_URL__') accum.__DEFAULT_HANDLE__ = handle
      accum[handle] = val
    }
    return accum
  }, { __DEFAULT_URL__: 'https://issues.couchbase.com/browse' })
  registry.inlineMacro('jira', initInlineJiraMacro(Object.assign({ mapping }, context)))
}

module.exports.register = register
