/**
 * Extends the AsciiDoc syntax to add support for the inline jira macro.
 *
 * Usage:
 *
 *  jira:DOC-1234[]
 *
 * @author Hakim Cassimally <hakim.cassimally@couchbase.com>
 */

function initInlineJiraMacro ({ file }) {
  return function () {
    this.process((parent, ticket, attrs) => {

      const sigil = ticket.split('-')[0]
      
      const attributes = {}
      
      const jira = {
        "https://issues.couchbase.com/browse/": ["JSCBC", "default"],
        "https://couchbasecloud.atlassian.net/browse/": ["AV"]
      }

      const lookup =
        Object.fromEntries(
          Object.entries(jira)
            .flatMap(([url, sigils]) =>
              sigils.map( sigil => [sigil, url])))
        
      const base = lookup[sigil] ?? lookup["default"]
          
      const url = base + ticket

      return this.createInline(
          parent,
          'anchor',
          ticket,
          { type: 'link',
            target: url,
            attributes })
    })
  }
}

function register (registry, context) {
  registry.inlineMacro('jira', initInlineJiraMacro(context))
}

module.exports.register = register
