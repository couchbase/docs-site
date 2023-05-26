// A component with an empty version (defined as `~` in the playbook.yml) 
// or named 'master' is considered to be "versionless", so the URL generated
// will be simply e.g. https://docs.couchbase.com/cloud/
// whereas a "versioned" component might have /current/ or /7.1/ appended.
//
// Note that 'home' and 'tutorials' are special-cased elsewhere in the template,
// and therefore excluded from this filter.

const versionless = (components) => components.filter(
    ({ name, latest }) =>
        name !== 'home' 
        && name !== 'tutorials'
        && (
            latest === 'master'
            || latest === ''))

module.exports.register = (hbs) => hbs.registerHelper('versionless', versionless)
