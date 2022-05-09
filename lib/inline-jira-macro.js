/**
 * Extends the AsciiDoc syntax to add support for the inline jira macro.
 *
 * Usage:
 *
 *  jira:DOC-1234[]
 *
 * @author Hakim Cassimally <hakim.cassimally@couchbase.com>
 */

function initInlineJiraMacro ({ file }, config) {
  return function () {
    this.process((parent, ticket, attrs) => {

      const sigil = ticket.split('-')[0]
      
      const attributes = {}
      const text=attrs["$positional"]?.[0] ?? ticket
      
      const lookup =
        Object.fromEntries(
          Object.entries(config)
            .flatMap(([url, sigils]) =>
              sigils.map( sigil => [sigil, url])))
        
      const base = lookup[sigil] ?? lookup["default"]
          
      const url = base + ticket

      return this.createInline(
          parent,
          'anchor',
          text,
          { type: 'link',
            target: url,
            attributes })
    })
  }
}

const defaultConfig = {
  "https://issues.couchbase.com/browse/": ["JSCBC", "default"],
  "https://couchbasecloud.atlassian.net/browse/": ["AV"]
}

function register (registry, context) {
  registry.inlineMacro('jira', initInlineJiraMacro(context, config=defaultConfig))
}

module.exports.register = register
