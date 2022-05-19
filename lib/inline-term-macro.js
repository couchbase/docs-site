/* 
 *
 * @author Hakim Cassimally <hakim.cassimally@couchbase.com>
 */



const capitalize = (string) => string.charAt(0).toUpperCase() + string.slice(1)
const compose = (f1, f2) => (arg) => f1(f2(arg))

const _indefinite = (term) => term.indefinite || term.term.match(/^[aeiou]/i) ? 'an' : 'a'

// prefix handlers
const normal = (prefix) => (term) => prefix ? `${prefix} ${term.term}` : term.term
const indefinite = (term) => `${_indefinite(term)} ${term.term}`

const prefix_handlers = {
  a: indefinite,
  an: indefinite,
  A: compose(capitalize, indefinite),
  An: compose(capitalize, indefinite),
}

function initInlineTermMacro ({ mapping }) {
  return function () {
    
    this.parseContentAs('text')
    this.matchFormat('short')
    
    this.process((parent, _, attrs) => {
      
      const text = attrs.text
      
      const knownTerms = Object.keys(mapping).join('|')
      
      const match = 
        text.match(new RegExp(`^(?<term>${knownTerms})$`)) || 
        text.match(/^(?<prefix>[Aa]n?|[Tt]he) (?<term>.*)$/) ||
        text.match(/^(?<term>.*)$/)
        
      const {term, prefix} = match.groups
      
      const item = mapping[term] || { term: term }
      
      const handler = prefix_handlers[prefix] || normal(prefix)
      
      const output = handler(item)

      return this.createInlinePass(parent, output)
    })
  }
}

function register (registry, context) {
  const { config: { attributes } } = context

  const mapping = Object.entries(attributes).reduce((accum, [name, value]) => {
    /*
     * parse out entries like:
     *     term-App Service
     *     term-App Service-indefinite
     *     term-App Service-plural
     *
     */
    console.log(name)
    const match = name.match(/^term(-(?<term>.*?))(-(?<type>indefinite|plural))?$/)
    if (match) {
      const term = match.groups.term
      const type = match.groups.type || 'term'
      accum[term] ||= {}
      accum[term][type] = value
    }
    return accum
  }, {})

  console.log(mapping)
  const contextWithMapping = Object.assign({ mapping }, context)
  registry.inlineMacro('term', initInlineTermMacro(contextWithMapping))
}

module.exports.register = register
