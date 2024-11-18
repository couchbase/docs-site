/**
 * Extends the AsciiDoc syntax to add support for the inline jira macro.
 *
 * Usage:
 *
 *  jira:DOC-1234[]
 *  jira:DOC-1234[Optional link text]
 *
 * @author Hakim Cassimally <hakim.cassimally@couchbase.com>
 *         Dan Allen <dan@opendevise.com>
 */

function initInlineJiraMacro ({ mapping }) {
  return function () {
    this.parseContentAs('text')
    this.process((parent, ref, attrs) => {
      let [handle, id] = ref.split('-')

      const url = (mapping[handle] || mapping.__DEFAULT__) + '/' + ref
      const text = attrs['text'] || ref

      return this.createInline(parent, 'anchor', text, { type: 'link', target: url })
    })
  }
}

function register (registry, context) {
  const { config: { attributes } } = context

  const mapping = Object.entries(attributes).reduce((accum, [name, url]) => {
    /*
     * parse out entries like:
     *     url-issues
     *     url-issues-<some JIRA handle>
     *
     * We then add these to the accumulated mapping like { handle: url }
     */
    const match = name.match(/^url-issues(-(?<handle>.*))?$/)
    if (match) {
      const handle = match.groups.handle || '__DEFAULT__'
      accum[handle] = url
    }
    return accum
  }, { __DEFAULT__: 'https://issues.couchbase.com/browse' })

  const contextWithMapping = Object.assign({ mapping }, context)
  registry.inlineMacro('jira', initInlineJiraMacro(contextWithMapping))
}

module.exports.register = register
