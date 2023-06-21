// A component with an empty version (defined as `~` in the playbook.yml) 
// or named 'master' is considered to be "versionless", so the URL generated
// will be simply e.g. https://docs.couchbase.com/cloud/
// whereas a "versioned" component might have /current/ or /7.1/ appended.

const versioned = (components) => components.filter(
    ({ latest }) =>
        latest != 'master'
        && latest != '')

module.exports.register = (hbs) => hbs.registerHelper('versioned', versioned)
